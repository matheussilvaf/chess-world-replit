import { randomUUID } from 'node:crypto';
import type { Client } from '@colyseus/core';
import type { WorldState } from '../../schemas/WorldState.js';
import type { BoardState } from '../../schemas/BoardState.js';
import { ACADEMY_MSG, academyTableKind } from '../../shared/academy/AcademyShapes.js';
import { BattleEngine, type BattleEngineEvent } from '../../shared/academy/battleEngine.js';
import { evaluatePlayerMove, puzzleSetup, puzzleSolutionMoves } from '../../shared/academy/puzzleSolver.js';
import {
  BATTLE_CHALLENGE_TTL_MS, PUZZLE_MSG, dailyPuzzleDate, dailyPuzzleNextReset, isBattleMode, isBattleTheme, isDailySlot, isPuzzleBand,
  puzzleMainThemes, type BattleCreatePayload, type PuzzleContext, type PuzzleErrorCode, type PuzzleSeat,
} from '../../shared/academy/PuzzleShapes.js';
import { resolveDailyConfigFor } from './puzzleConfigRepository.js';
import { getRatingConfigCached } from '../../rating/ratingConfigRepository.js';
import { awardGambitsAtomic } from '../../rating/ratingRepository.js';
import { gambitDayStart } from '../../shared/rating/RatingShapes.js';
import { getBattleRewards } from './puzzleConfigRepository.js';
import { buildDailyState, getDailyPuzzles, registerSolved, registerWrongMove, startAttempt } from './dailyPuzzleService.js';
import { checkPuzzleError, drawPuzzle, puzzleClient, PuzzleStorageError, type PuzzleRow } from './puzzleRepository.js';

interface Session { id: string; userId: string; context: PuzzleContext; puzzle: PuzzleRow; k: number; date?: string; boardId: string; seat: PuzzleSeat }
interface Battle {
  id: string; boardId: string; engine: BattleEngine; players: [string, string]; names: [string, string];
  showThemes: boolean; theme: string | null; startedAt: string; puzzles: Map<number, PuzzleRow>; fallbackIndices: Set<number>; loading: Map<number, Promise<PuzzleRow>>;
  rewards: Map<string, { amount: number; balance: number | null }>; offlineSince: number | null;
}
interface Context {
  state: WorldState; clients: Client[];
  findSessionByPlayerId(id: string): string | null;
  resetBoard(board: BoardState): void;
  updateRoomHold(): void;
}
export class AcademyPuzzleManager {
  private sessions = new Map<string, Session>();
  private battles = new Map<string, Battle>();
  private busy = new Set<string>();
  private lastTick = 0;
  constructor(private readonly room: Context) {}

  // -------------------------------------------------------------------------
  // Mesa do puzzle diário: duas cadeiras físicas (bottom = whitePlayerId,
  // top = blackPlayerId no BoardState, como nas partidas normais, para os
  // outros clientes sentarem o sprite). O puzzle em si é por jogador.
  // -------------------------------------------------------------------------
  private dailyBoard(): BoardState | undefined {
    for (const board of this.room.state.boards.values()) if (academyTableKind(board.id) === 'puzzle_day') return board;
    return undefined;
  }
  private dailySeatOf(userId: string): PuzzleSeat | null {
    const board = this.dailyBoard();
    if (!board) return null;
    return board.whitePlayerId === userId ? 'bottom' : board.blackPlayerId === userId ? 'top' : null;
  }
  dailySit(client: Client, payload: unknown) {
    const user = this.player(client);
    const boardId = (payload as { boardId?: unknown } | null)?.boardId;
    if (!user || user.id.startsWith('anon:')) { this.error(client, 'daily_unavailable', 'Entre na sua conta para resolver puzzles.'); return; }
    const board = this.dailyBoard();
    if (!board || board.id !== boardId) { this.error(client, 'board_missing', 'Mesa do puzzle diário não encontrada.'); return; }
    let seat = this.dailySeatOf(user.id);
    if (!seat) {
      if (user.currentBoardId) { this.error(client, 'already_seated', 'Você já está em outra mesa.'); return; }
      if (!board.whitePlayerId) seat = 'bottom';
      else if (!board.blackPlayerId) seat = 'top';
      else { this.error(client, 'board_busy', 'Mesa cheia — aguarde uma cadeira vagar.'); return; }
      if (seat === 'bottom') board.whitePlayerId = user.id; else board.blackPlayerId = user.id;
      board.status = 'playing';
    }
    // Reconexão com a cadeira ainda ocupada por este jogador: o PlayerState novo
    // nasce sem mesa — restaura o vínculo para não sentar em duas mesas.
    user.currentBoardId = board.id;
    client.send(PUZZLE_MSG.dailySeated, { boardId: board.id, seat });
    void this.dailyOpen(client);
  }
  private freeDailySeat(userId: string) {
    const board = this.dailyBoard();
    if (!board) return;
    if (board.whitePlayerId === userId) board.whitePlayerId = '';
    if (board.blackPlayerId === userId) board.blackPlayerId = '';
    if (!board.whitePlayerId && !board.blackPlayerId) this.room.resetBoard(board);
    for (const [key, s] of this.sessions) if (s.userId === userId && s.context.kind === 'daily') this.sessions.delete(key);
  }
  dailyLeave(client: Client) {
    const user = this.player(client);
    if (!user) return;
    const board = this.dailyBoard();
    if (user.currentBoardId && board && user.currentBoardId === board.id) user.currentBoardId = '';
    this.freeDailySeat(user.id);
  }

  private player(client: Client) { return this.room.state.players.get(client.sessionId); }
  private client(id: string): Client | undefined {
    const sid = this.room.findSessionByPlayerId(id);
    return this.room.clients.find((c) => c.sessionId === sid);
  }
  private error(client: Client, code: PuzzleErrorCode, message: string) { client.send(ACADEMY_MSG.error, { code, message }); }
  private failure(client: Client, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[academy-puzzles]', message);
    this.error(client, error instanceof PuzzleStorageError && error.schemaMissing ? 'schema_missing' :
      message === 'daily_done' ? 'daily_done' : message.includes('Nenhum puzzle') ? 'no_puzzles' : 'daily_unavailable',
    message === 'daily_done' ? 'Este puzzle diário já foi encerrado.' : message);
  }
  /**
   * Um comando por vez por cliente (o segundo é descartado). A leitura de estado
   * (`dailyOpen`) usa uma pista própria: o `open` automático ao entrar/sentar não
   * pode engolir um "Resolver" clicado logo em seguida.
   */
  private async guarded(client: Client, task: () => Promise<void>, lane = '') {
    const key = client.sessionId + lane;
    if (this.busy.has(key)) return;
    this.busy.add(key);
    try { await task(); } catch (e) { this.failure(client, e); }
    finally { this.busy.delete(key); }
  }
  async dailyOpen(client: Client) {
    await this.guarded(client, async () => {
      const user = this.player(client);
      if (!user || user.id.startsWith('anon:')) { this.error(client, 'daily_unavailable', 'Entre na sua conta para resolver puzzles.'); return; }
      try { client.send(PUZZLE_MSG.dailyState, await buildDailyState(user.id)); }
      catch (e) {
        if (!(e instanceof PuzzleStorageError) || !e.schemaMissing) throw e;
        const now = Date.now();
        client.send(PUZZLE_MSG.dailyState, { date: dailyPuzzleDate(now), nextResetAt: dailyPuzzleNextReset(now),
          serverNow: now, slots: [], schemaMissing: true });
      }
    }, ':open');
  }
  async dailyStart(client: Client, payload: unknown) {
    await this.guarded(client, async () => {
      const slot = (payload as { slot?: unknown } | null)?.slot;
      const user = this.player(client);
      if (!isDailySlot(slot) || !user || user.id.startsWith('anon:')) { this.error(client, 'invalid_payload', 'Selecione um slot diário válido.'); return; }
      const board = this.dailyBoard();
      const seat = this.dailySeatOf(user.id);
      if (!board || !seat) { this.error(client, 'not_seated', 'Sente-se na mesa do puzzle diário primeiro.'); return; }
      const date = dailyPuzzleDate();
      const draw = (await getDailyPuzzles(date)).find((d) => d.slot === slot);
      if (!draw) { this.error(client, 'no_puzzles', 'Puzzle diário não encontrado.'); return; }
      const attempt = await startAttempt(user.id, date, slot, draw.puzzle.puzzleId);
      await this.startSession(user.id, { kind: 'daily', slot }, draw.puzzle, attempt.livesLeft, date);
    });
  }
  private async startSession(userId: string, context: PuzzleContext, puzzle: PuzzleRow, livesLeft?: number, date?: string, deadlineAt?: number) {
    let seatInfo: { boardId: string; seat: PuzzleSeat } | undefined;
    let showThemes = false;
    let themeFallback = false;
    if (context.kind === 'daily') {
      showThemes = (await resolveDailyConfigFor(date ?? dailyPuzzleDate())).showThemes;
      // A cadeira é lida DEPOIS do await: dailyLeave/desconexão podem ter
      // liberado (ou outro jogador ocupado) a mesa enquanto a config carregava.
      const board = this.dailyBoard();
      const seat = this.dailySeatOf(userId);
      if (board && seat) seatInfo = { boardId: board.id, seat };
    } else if (context.kind === 'battle') {
      const battle = this.battles.get(context.battleId);
      showThemes = !!battle?.showThemes;
      themeFallback = !!battle?.fallbackIndices.has(context.index);
      if (battle && battle.engine.phase === 'running' && battle.engine.currentIndex(userId) === context.index &&
        !battle.engine.view(userId, Date.now()).me.done) {
        seatInfo = { boardId: battle.boardId, seat: this.battleSeat(battle, userId) };
      }
    }
    // Cliente resolvido só agora: quem desconectou durante o await não recebe sessão órfã.
    const client = this.client(userId);
    if (!seatInfo || !client) return;
    for (const [key, s] of this.sessions) if (s.userId === userId && s.context.kind === context.kind) this.sessions.delete(key);
    const id = randomUUID();
    this.sessions.set(id, { id, userId, context, puzzle, k: 0, date, boardId: seatInfo.boardId, seat: seatInfo.seat });
    const setup = puzzleSetup(puzzle);
    if (context.kind === 'battle') {
      const battle = this.battles.get(context.battleId);
      if (battle) {
        battle.engine.setPuzzleColor(userId, context.index, setup.playerColor);
        this.sendState(battle);
      }
    }
    client.send(PUZZLE_MSG.puzzleStarted, {
      sessionId: id, context, puzzleId: puzzle.puzzleId, rating: puzzle.rating,
      boardId: seatInfo.boardId, seat: seatInfo.seat,
      themes: showThemes ? puzzleMainThemes(puzzle.themes) : [],
      ...(themeFallback ? { themeFallback: true } : {}),
      fen: puzzle.fen, setupMove: setup.setupMove, playerColor: setup.playerColor,
      solutionLength: setup.solutionLength, ...(livesLeft !== undefined ? { livesLeft } : {}),
      ...(deadlineAt ? { deadlineAt } : {}),
    });
  }
  async puzzleMove(client: Client, payload: unknown) {
    await this.guarded(client, async () => {
      const input = payload as { sessionId?: string; uci?: string } | null;
      const user = this.player(client);
      const session = input?.sessionId && this.sessions.get(input.sessionId);
      if (!user || !session || session.userId !== user.id || typeof input?.uci !== 'string') {
        this.error(client, 'session_invalid', 'Sessão de puzzle inválida.'); return;
      }
      // Instante de chegada do lance: validação do prazo e pontuação usam o MESMO relógio.
      const now = Date.now();
      if (session.context.kind === 'battle') {
        // Prazos vencidos (melhor de N, pressão, tempo) são aplicados ANTES de aceitar o lance: um lance que chega
        // depois do prazo, ou durante o intervalo de resultado da rodada (jogador `done`), não conta em puzzle nenhum.
        const battle = this.battles.get(session.context.battleId);
        if (battle) { const timed = battle.engine.tick(now); if (timed.length) await this.events(battle, timed); }
        if (!battle || battle.engine.phase !== 'running' || battle.engine.currentIndex(user.id) !== session.context.index ||
          battle.engine.view(user.id, now).me.done || !this.sessions.has(session.id)) {
          this.sessions.delete(session.id);
          this.error(client, 'session_invalid', 'Este puzzle já foi encerrado.'); return;
        }
      }
      if (session.context.kind === 'daily' && dailyPuzzleDate() !== session.date) {
        this.sessions.delete(session.id); this.error(client, 'daily_unavailable', 'O dia mudou. Abra os puzzles do novo dia.');
        client.send(PUZZLE_MSG.dailyState, await buildDailyState(user.id)); return;
      }
      const evaluation = evaluatePlayerMove(session.puzzle, session.k, input.uci);
      if (!evaluation.legal) { this.error(client, 'illegal_move', 'Lance ilegal nesta posição.'); return; }
      const feedback: Record<string, unknown> = { sessionId: session.id, ok: evaluation.ok, moveIndex: session.k, solved: evaluation.solved };
      if (evaluation.ok && !evaluation.solved) {
        feedback.reply = evaluation.reply; session.k++;
        client.send(PUZZLE_MSG.puzzleFeedback, feedback); return;
      }
      this.sessions.delete(session.id);
      if (session.context.kind === 'daily') {
        const slot = session.context.slot;
        const date = session.date!;
        if (evaluation.solved) {
          const draw = (await getDailyPuzzles(date)).find((d) => d.slot === slot)!;
          const reward = await registerSolved(user.id, date, slot, draw.rewardGambits);
          Object.assign(feedback, reward, { dailyStatus: 'solved' });
        } else {
          const attempt = await registerWrongMove(user.id, date, slot);
          feedback.livesLeft = attempt.livesLeft;
          if (attempt.livesLeft) feedback.restart = true;
          else Object.assign(feedback, { solutionMoves: puzzleSolutionMoves(session.puzzle), dailyStatus: 'failed' });
        }
        client.send(PUZZLE_MSG.puzzleFeedback, feedback);
        if (feedback.restart) await this.startSession(user.id, { kind: 'daily', slot }, session.puzzle, feedback.livesLeft as number, date);
        else client.send(PUZZLE_MSG.dailyState, await buildDailyState(user.id));
        return;
      }
      // Lições/problemas têm o próprio gerente de sessões (LessonManager); aqui só diário e batalha.
      if (session.context.kind !== 'battle') return;
      // Batalha validada acima com este mesmo `now` (sem await desde então): o `playerMove` não pode descartar
      // o lance por prazo, então o feedback enviado antes dele bate com os pontos concedidos.
      const battle = this.battles.get(session.context.battleId)!;
      if (!evaluation.ok) Object.assign(feedback, { puzzleOver: true, puzzleOverReason: 'wrong' });
      client.send(PUZZLE_MSG.puzzleFeedback, feedback);
      await this.events(battle, battle.engine.playerMove(user.id, { ok: evaluation.ok, solved: evaluation.solved }, now, session.context.index));
    });
  }
  battleCreate(client: Client, data: unknown) {
    const input = data as BattleCreatePayload | null;
    const user = this.player(client);
    if (!user || user.id.startsWith('anon:') || !input || typeof input.boardId !== 'string' ||
      academyTableKind(input.boardId) !== 'puzzle_battle' || !isBattleMode(input.mode) ||
      !isPuzzleBand(input.band) || typeof input.showThemes !== 'boolean' || (input.theme !== undefined && input.theme !== '' && !isBattleTheme(input.theme))) {
      this.error(client, 'invalid_payload', 'Mesa, modo, dificuldade ou tema inválidos.'); return;
    }
    const board = this.room.state.boards.get(input.boardId);
    if (!board) { this.error(client, 'board_missing', 'Mesa não encontrada.'); return; }
    if (board.status !== 'idle') { this.error(client, 'board_busy', 'Esta mesa está ocupada.'); return; }
    if (user.currentBoardId || [...this.room.state.boards.values()].some((b) => b.status === 'waiting' && b.waitingPlayerId === user.id)) {
      this.error(client, 'already_seated', 'Você já está em outra mesa.'); return;
    }
    board.status = 'waiting'; board.waitingPlayerId = user.id; board.waitingPlayerName = user.username;
    board.battleMode = input.mode; board.battleBand = input.band; board.battleShowThemes = input.showThemes;
    board.battleTheme = input.theme ?? '';
    board.battleExpiresAt = Date.now() + BATTLE_CHALLENGE_TTL_MS;
    user.currentBoardId = board.id;
  }
  private closeChallenge(board: BoardState, reason: 'expired' | 'cancelled') {
    const client = this.client(board.waitingPlayerId);
    const user = client && this.player(client);
    if (user) user.currentBoardId = '';
    client?.send(PUZZLE_MSG.battleChallengeClosed, { boardId: board.id, reason });
    this.room.resetBoard(board);
  }
  battleCancel(client: Client, data: unknown) {
    const board = this.room.state.boards.get((data as { boardId?: string } | null)?.boardId ?? '');
    if (!board || board.status !== 'waiting' || academyTableKind(board.id) !== 'puzzle_battle' || board.waitingPlayerId !== this.player(client)?.id) {
      this.error(client, 'battle_not_yours', 'Você não criou este desafio.'); return;
    }
    this.closeChallenge(board, 'cancelled');
  }
  async battleAccept(client: Client, data: unknown) {
    await this.guarded(client, async () => {
      const board = this.room.state.boards.get((data as { boardId?: string } | null)?.boardId ?? '');
      const user = this.player(client);
      if (!board || academyTableKind(board.id) !== 'puzzle_battle' || board.status !== 'waiting') {
        this.error(client, 'board_busy', 'Desafio indisponível.'); return;
      }
      if (!user || user.id.startsWith('anon:') || user.currentBoardId) { this.error(client, 'already_seated', 'Você já está em outra mesa.'); return; }
      if (user.id === board.waitingPlayerId) { this.error(client, 'battle_self', 'Você não pode aceitar seu desafio.'); return; }
      if (board.battleExpiresAt <= Date.now()) { this.closeChallenge(board, 'expired'); this.error(client, 'battle_expired', 'Desafio expirado.'); return; }
      const creator = this.client(board.waitingPlayerId);
      if (!creator || !this.player(creator)) { this.closeChallenge(board, 'expired'); this.error(client, 'battle_missing', 'Criador desconectado.'); return; }
      const id = randomUUID();
      const players: [string, string] = [board.waitingPlayerId, user.id];
      const names: [string, string] = [board.waitingPlayerName, user.username];
      const engine = new BattleEngine({ mode: board.battleMode as BattleCreatePayload['mode'], band: board.battleBand as BattleCreatePayload['band'],
        players: [{ id: players[0], name: names[0] }, { id: players[1], name: names[1] }], now: Date.now() });
      const battle: Battle = { id, boardId: board.id, engine, players, names, showThemes: board.battleShowThemes, theme: board.battleTheme || null,
        startedAt: new Date().toISOString(), puzzles: new Map(), fallbackIndices: new Set(), loading: new Map(), rewards: new Map(), offlineSince: null };
      this.battles.set(id, battle);
      this.room.updateRoomHold();
      board.status = 'playing'; board.matchId = id; board.whitePlayerId = players[0]; board.blackPlayerId = players[1];
      this.player(creator)!.currentBoardId = board.id; user.currentBoardId = board.id;
      this.sendState(battle);
      void this.prefetch(battle).catch((e) => console.warn('[academy-puzzles] pré-carga:', e));
    });
  }
  private async puzzleAt(battle: Battle, index: number): Promise<PuzzleRow> {
    if (battle.puzzles.has(index)) return battle.puzzles.get(index)!;
    if (!battle.loading.has(index)) {
      battle.loading.set(index, (async () => {
        const range = battle.engine.targetRatingForIndex(index);
        const excludeIds = [...battle.puzzles.values()].map((p) => p.puzzleId);
        // Com filtro de tema: tenta na faixa; se o tema não tiver puzzle nessa
        // faixa (temas raros), amplia para qualquer tema em vez de travar a batalha.
        const themed = battle.theme ? await drawPuzzle({ ratingMin: range.min, ratingMax: range.max, theme: battle.theme, excludeIds }) : null;
        const puzzle = themed || await drawPuzzle({ ratingMin: range.min, ratingMax: range.max, excludeIds });
        if (!puzzle) throw new PuzzleStorageError('Nenhum puzzle disponível nesta faixa.');
        if (battle.theme && !themed) battle.fallbackIndices.add(index);
        battle.puzzles.set(index, puzzle);
        return puzzle;
      })().finally(() => battle.loading.delete(index)));
    }
    return battle.loading.get(index)!;
  }
  private async prefetch(battle: Battle) {
    for (let index = 0; index <= battle.engine.highestNeededIndex(); index++) await this.puzzleAt(battle, index);
  }
  /** Criador (whitePlayerId) senta embaixo; quem aceitou (blackPlayerId), em cima. */
  private battleSeat(battle: Battle, userId: string): PuzzleSeat {
    return battle.players[0] === userId ? 'bottom' : 'top';
  }
  private sendState(battle: Battle) {
    for (const id of battle.players) {
      const c = this.client(id);
      if (!c) continue;
      const view = battle.engine.view(id, Date.now());
      c.send(PUZZLE_MSG.battleState, {
        battleId: battle.id, boardId: battle.boardId, mySeat: this.battleSeat(battle, id), mode: battle.engine.mode, band: battle.engine.band,
        showThemes: battle.showThemes, ...(battle.theme ? { theme: battle.theme } : {}), serverNow: Date.now(), ...view,
        ...(battle.rewards.has(id) ? { result: { ...view.result, myRewardGambits: battle.rewards.get(id)!.amount, gambitsBalance: battle.rewards.get(id)!.balance } } : {}),
      });
    }
  }
  private async events(battle: Battle, events: BattleEngineEvent[]) {
    for (const event of events) {
      if (event.type === 'puzzle_over') {
        for (const [key, session] of this.sessions) if (session.userId === event.playerId &&
          session.context.kind === 'battle' && session.context.battleId === battle.id) {
          this.sessions.delete(key);
          this.client(event.playerId)?.send(PUZZLE_MSG.puzzleFeedback, {
            sessionId: key, ok: false, moveIndex: session.k, solved: false, puzzleOver: true, puzzleOverReason: event.reason,
          });
        }
      }
      if (event.type === 'puzzle_assigned' && battle.engine.phase === 'running') {
        const puzzle = await this.puzzleAt(battle, event.index);
        // Enquanto o puzzle carregava a batalha pode ter acabado ou a rodada avançado: não reabrir sessão obsoleta.
        if (battle.engine.phase !== 'running' || battle.engine.currentIndex(event.playerId) !== event.index ||
          battle.engine.view(event.playerId, Date.now()).me.done) continue;
        await this.startSession(event.playerId, { kind: 'battle', battleId: battle.id, index: event.index }, puzzle,
          battle.engine.view(event.playerId, Date.now()).me.lives, undefined,
          battle.engine.view(event.playerId, Date.now()).bestOf?.deadlineAt);
        void this.prefetch(battle).catch((e) => console.warn('[academy-puzzles] pré-carga:', e));
      }
      if (event.type === 'finished') await this.finish(battle, event.winnerId, event.reason);
      if (event.type === 'changed') this.sendState(battle);
    }
  }
  private async finish(battle: Battle, winnerId: string, reason: string) {
    const now = Date.now();
    // Recompensa e histórico nunca podem travar a liberação da mesa: falhas viram aviso.
    try {
      const rewards = await getBattleRewards();
      const config = await getRatingConfigCached();
      for (const id of battle.players) {
        const amount = reason === 'aborted' || !rewards.enabled ? 0 :
          !winnerId ? rewards.drawGambits : winnerId === id ? rewards.winGambits : rewards.lossGambits;
        if (amount <= 0) { battle.rewards.set(id, { amount: 0, balance: null }); continue; }
        const result = await awardGambitsAtomic({ matchId: `battle:${battle.id}`, playerId: id, amount,
          kind: 'puzzle_battle', dayStartIso: new Date(gambitDayStart(now, config.gambits.dayOffsetHours)).toISOString(),
          dailyCap: rewards.dailyCapGambits, awardedAtIso: new Date(now).toISOString() });
        if (result.error) console.warn('[academy-puzzles] recompensa:', result.error);
        battle.rewards.set(id, { amount: result.amount, balance: result.balance });
      }
    } catch (e) {
      console.warn('[academy-puzzles] recompensa da batalha falhou:', e instanceof Error ? e.message : e);
      for (const id of battle.players) if (!battle.rewards.has(id)) battle.rewards.set(id, { amount: 0, balance: null });
    }
    try {
      const stats = battle.engine.stats();
      const { error } = await puzzleClient().from('academy_puzzle_battles').insert({
        id: battle.id, mode: battle.engine.mode, band: battle.engine.band, show_themes: battle.showThemes,
        board_id: battle.boardId, player_a: battle.players[0], player_b: battle.players[1],
        player_a_name: battle.names[0], player_b_name: battle.names[1], winner_id: winnerId || null, reason,
        a_solved: stats[battle.players[0]].solved, b_solved: stats[battle.players[1]].solved,
        a_reward: battle.rewards.get(battle.players[0])?.amount ?? 0, b_reward: battle.rewards.get(battle.players[1])?.amount ?? 0,
        stats, started_at: battle.startedAt, finished_at: new Date(now).toISOString(),
      });
      checkPuzzleError(error);
    } catch (e) {
      console.warn('[academy-puzzles] histórico da batalha não salvo:', e instanceof Error ? e.message : e);
    }
    for (const id of battle.players) {
      const c = this.client(id);
      if (c && this.player(c)?.currentBoardId === battle.boardId) this.player(c)!.currentBoardId = '';
      for (const [key, s] of this.sessions) if (s.userId === id && s.context.kind === 'battle' && s.context.battleId === battle.id) this.sessions.delete(key);
    }
    const board = this.room.state.boards.get(battle.boardId);
    if (board) this.room.resetBoard(board);
    this.room.updateRoomHold();
  }
  battleLeave(client: Client, data: unknown) {
    const battle = this.battles.get((data as { battleId?: string } | null)?.battleId ?? '');
    const id = this.player(client)?.id;
    if (!battle || !id || !battle.players.includes(id)) { this.error(client, 'battle_not_yours', 'Batalha não encontrada.'); return; }
    void this.events(battle, battle.engine.forfeit(id, Date.now())).catch((e) => this.failure(client, e));
  }
  battleDismiss(client: Client) {
    const id = this.player(client)?.id;
    for (const [key, battle] of this.battles) if (id && battle.players.includes(id) && battle.engine.phase === 'finished') {
      // Keep final state for the opponent until they dismiss it too.
      battle.players = battle.players.map((p) => p === id ? '' : p) as [string, string];
      if (battle.players.every((p) => !p)) this.battles.delete(key);
    }
  }
  async onJoin(client: Client) {
    const id = this.player(client)?.id;
    if (!id) return;
    // Estado do dia para todo mundo logado: a mesa do diário mostra o progresso
    // ("1 de 3 concluídos") sem precisar clicar nela.
    if (!id.startsWith('anon:')) void this.dailyOpen(client);
    for (const battle of this.battles.values()) if (battle.players.includes(id) && battle.engine.phase !== 'finished') {
      battle.engine.setOffline(id, false); battle.offlineSince = null;
      this.sendState(battle);
      if (battle.engine.phase === 'running' && !battle.engine.view(id, Date.now()).me.done) {
        try {
          const index = battle.engine.currentIndex(id);
          const puzzle = await this.puzzleAt(battle, index);
          await this.startSession(id, { kind: 'battle', battleId: battle.id, index }, puzzle, battle.engine.view(id, Date.now()).me.lives,
            undefined, battle.engine.view(id, Date.now()).bestOf?.deadlineAt);
        } catch (e) { this.failure(client, e); }
      }
    }
  }
  onLeave(client: Client, consented: boolean) {
    const id = this.player(client)?.id;
    if (!id) return;
    this.release(id, consented, client);
  }
  /**
   * Conexão duplicada do mesmo jogador: a WorldRoom apaga o PlayerState antigo
   * antes do onLeave dele rodar, então a liberação é feita por id aqui (não
   * consentida: a batalha fica offline até o onJoin da nova conexão religar).
   */
  onStaleSession(playerId: string, staleClient: Client | undefined) {
    this.release(playerId, false, staleClient);
  }
  private release(id: string, consented: boolean, client: Client | undefined) {
    for (const [key, session] of this.sessions) if (session.userId === id) this.sessions.delete(key);
    this.freeDailySeat(id);
    for (const board of this.room.state.boards.values()) if (board.status === 'waiting' &&
      board.waitingPlayerId === id && academyTableKind(board.id) === 'puzzle_battle') this.closeChallenge(board, 'cancelled');
    for (const battle of this.battles.values()) if (battle.players.includes(id) && battle.engine.phase !== 'finished') {
      if (consented) void this.events(battle, battle.engine.forfeit(id, Date.now())).catch((e) => { if (client) this.failure(client, e); else console.warn('[academy-puzzles]', e); });
      else { battle.engine.setOffline(id, true); if (battle.players.every((p) => battle.engine.view(p, Date.now()).me.offline)) battle.offlineSince = Date.now(); this.sendState(battle); }
    }
  }
  tick(now: number) {
    if (now - this.lastTick < 250) return;
    this.lastTick = now;
    for (const board of this.room.state.boards.values()) if (board.status === 'waiting' &&
      academyTableKind(board.id) === 'puzzle_battle' && board.battleExpiresAt <= now) this.closeChallenge(board, 'expired');
    for (const battle of this.battles.values()) {
      if (battle.engine.phase === 'finished') continue;
      const events = battle.offlineSince && now - battle.offlineSince >= 60_000 ?
        battle.engine.abort(now) : battle.engine.tick(now);
      if (events.length) void this.events(battle, events).catch((e) => console.warn('[academy-puzzles] tick:', e));
    }
  }
  hasActiveBattles(): boolean {
    return [...this.battles.values()].some((battle) => battle.engine.phase !== 'finished');
  }
}