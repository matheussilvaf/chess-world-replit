import { randomUUID } from 'node:crypto';
import type { Client } from '@colyseus/core';
import type { WorldState } from '../../schemas/WorldState.js';
import type { BoardState } from '../../schemas/BoardState.js';
import { ACADEMY_MSG, academyTableKind } from '../../shared/academy/AcademyShapes.js';
import {
  LESSON_DIFFICULTIES, LESSON_HISTORY_WINDOW, LESSON_MSG, LESSON_PRACTICE_SIZE,
  LESSON_THEMES, PROBLEM_DIFFICULTIES, isLessonDifficultyId, isLessonThemeId, isProblemFilters,
  problemFilterThemes,
  type LessonDifficultyId, type LessonThemeId, type ProblemFilters, type LessonSessionEndPayload,
} from '../../shared/academy/LessonShapes.js';
import { PUZZLE_MSG, puzzleMainThemes, type PuzzleContext, type PuzzleSeat } from '../../shared/academy/PuzzleShapes.js';
import { evaluatePlayerMove, puzzleSetup, puzzleSolutionMoves } from '../../shared/academy/puzzleSolver.js';
import { drawPuzzle, PuzzleStorageError, type PuzzleRow, type PuzzleFilter } from '../puzzles/puzzleRepository.js';
import { buildLessonState, insertPuzzleHistory, recentPuzzleIds, saveLessonProgress } from './lessonRepository.js';

interface Context {
  state: WorldState; clients: Client[];
  findSessionByPlayerId(id: string): string | null;
  resetBoard(board: BoardState): void;
}
interface Session {
  userId: string; boardId: string; kind: 'lesson' | 'problem'; theme?: LessonThemeId;
  difficulty?: LessonDifficultyId; filters?: ProblemFilters; history: string[];
  used: Set<string>; index: number; solved: number; attempted: number;
  current?: { id: string; puzzle: PuzzleRow; k: number; seat: PuzzleSeat };
}

export class LessonManager {
  private sessions = new Map<string, Session>();
  private byPuzzle = new Map<string, Session>();
  private busy = new Map<string, Promise<void>>();
  /** Cresce a cada Parar/levantar: um `start` que ainda sorteava não pode instalar sessão depois. */
  private generation = new Map<string, number>();
  constructor(private readonly room: Context) {}

  private player(client: Client) { return this.room.state.players.get(client.sessionId); }
  private client(id: string): Client | undefined {
    const sid = this.room.findSessionByPlayerId(id);
    return this.room.clients.find((c) => c.sessionId === sid);
  }
  private seat(board: BoardState, id: string): PuzzleSeat | null {
    return board.whitePlayerId === id ? 'bottom' : board.blackPlayerId === id ? 'top' : null;
  }
  private error(client: Client, code: string, message: string) { client.send(ACADEMY_MSG.error, { code, message }); }
  private failure(client: Client, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[academy-lessons]', message);
    if (error instanceof PuzzleStorageError && error.schemaMissing) {
      this.error(client, 'schema_missing', 'Sala de lições ainda não instalada no banco (rode server/supabase/tactics_academy_phase3.sql).');
      return;
    }
    this.error(client, 'daily_unavailable', message);
  }
  private async guarded(client: Client, task: () => Promise<void>) {
    const previous = this.busy.get(client.sessionId);
    const run = (async () => {
      if (previous) await previous;
      if (!this.player(client)) return;
      try { await task(); } catch (error) { this.failure(client, error); }
    })();
    this.busy.set(client.sessionId, run);
    try { await run; } finally { if (this.busy.get(client.sessionId) === run) this.busy.delete(client.sessionId); }
  }
  private board(client: Client, boardId: unknown): BoardState | null {
    const board = typeof boardId === 'string' ? this.room.state.boards.get(boardId) : undefined;
    if (!board || !/^academy_lesson_[1-5]$/.test(board.id) || academyTableKind(board.id) !== 'lesson') {
      this.error(client, 'board_missing', 'Carteira da sala de lições não encontrada.'); return null;
    }
    return board;
  }
  sit(client: Client, payload: unknown) {
    const user = this.player(client);
    if (!user || user.id.startsWith('anon:')) { this.error(client, 'daily_unavailable', 'Entre na sua conta para estudar.'); return; }
    const board = this.board(client, (payload as { boardId?: unknown } | null)?.boardId);
    if (!board) return;
    let seat = this.seat(board, user.id);
    if (user.currentBoardId && user.currentBoardId !== board.id) {
      this.error(client, 'already_seated', 'Você já está em outra mesa.'); return;
    }
    if (!seat) {
      if (user.currentBoardId || [...this.room.state.boards.values()].some((b) => b.status === 'waiting' && b.waitingPlayerId === user.id)) {
        this.error(client, 'already_seated', 'Você já está em outra mesa.'); return;
      }
      if (!board.whitePlayerId) seat = 'bottom';
      else if (!board.blackPlayerId) seat = 'top';
      else { this.error(client, 'board_busy', 'Carteira cheia — aguarde uma cadeira vagar.'); return; }
      if (seat === 'bottom') board.whitePlayerId = user.id; else board.blackPlayerId = user.id;
    }
    board.status = 'playing';
    user.currentBoardId = board.id;
    client.send(LESSON_MSG.seated, { boardId: board.id, seat });
    void this.open(client);
  }
  async open(client: Client) {
    await this.guarded(client, async () => {
      const user = this.player(client);
      // Anônimos recebem o `open` automático ao entrar na sala: sem aviso, só sem estado.
      if (!user || user.id.startsWith('anon:')) return;
      client.send(LESSON_MSG.state, await buildLessonState(user.id));
    });
  }
  private seated(client: Client, boardId: unknown): BoardState | null {
    const board = this.board(client, boardId);
    if (!board) return null;
    const user = this.player(client);
    if (!user || !this.seat(board, user.id) || user.currentBoardId !== board.id) {
      this.error(client, 'not_seated', 'Sente-se na carteira primeiro.'); return null;
    }
    return board;
  }
  async practiceStart(client: Client, payload: unknown) {
    await this.guarded(client, async () => {
      const input = payload as { boardId?: unknown; theme?: unknown; difficulty?: unknown } | null;
      if (!isLessonThemeId(input?.theme) || !isLessonDifficultyId(input?.difficulty)) {
        this.error(client, 'invalid_payload', 'Tema ou dificuldade inválidos.'); return;
      }
      const board = this.seated(client, input?.boardId);
      if (!board) return;
      await this.start(client, board, { kind: 'lesson', theme: input.theme, difficulty: input.difficulty });
    });
  }
  async problemStart(client: Client, payload: unknown) {
    await this.guarded(client, async () => {
      const input = payload as { boardId?: unknown; filters?: unknown } | null;
      if (!isProblemFilters(input?.filters)) { this.error(client, 'invalid_payload', 'Filtros de problemas inválidos.'); return; }
      const board = this.seated(client, input?.boardId);
      if (board) await this.start(client, board, { kind: 'problem', filters: input.filters });
    });
  }
  private async start(client: Client, board: BoardState, choice: { kind: 'lesson'; theme: LessonThemeId; difficulty: LessonDifficultyId } | { kind: 'problem'; filters: ProblemFilters }) {
    const user = this.player(client)!;
    const generation = this.generation.get(user.id) ?? 0;
    const still = () => this.seat(board, user.id) && user.currentBoardId === board.id && this.client(user.id) === client
      && (this.generation.get(user.id) ?? 0) === generation;
    const history = await recentPuzzleIds(user.id, LESSON_HISTORY_WINDOW);
    if (!still()) return;
    const session: Session = { userId: user.id, boardId: board.id, ...choice, history, used: new Set(), index: 0, solved: 0, attempted: 0 };
    // Primeiro sorteia: falha de filtros não deve destruir uma sessão ativa.
    const puzzle = await this.draw(session);
    if (!still()) return;
    if (!puzzle) { this.error(client, 'no_puzzles', 'Nenhum puzzle disponível para estes filtros.'); return; }
    const previous = this.sessions.get(user.id);
    if (previous) this.end(previous, 'stopped');
    this.sessions.set(user.id, session);
    this.sendPuzzle(session, puzzle, client);
  }
  private async draw(session: Session): Promise<PuzzleRow | null> {
    const range = session.kind === 'lesson' ? LESSON_DIFFICULTIES[session.difficulty!] : PROBLEM_DIFFICULTIES[session.filters!.difficulty];
    const filter: PuzzleFilter = session.kind === 'lesson'
      ? { ratingMin: range.min, ratingMax: range.max, theme: LESSON_THEMES[session.theme!].lichessThemes[0] }
      : { ratingMin: range.min, ratingMax: range.max, themes: problemFilterThemes(session.filters!), opening: session.filters!.opening };
    // Sem repetir o histórico recente; se o tema esgotar, aceita repetição antiga e por fim
    // alarga o rating (temas raros como subpromoção têm poucas posições por faixa).
    const used = [...session.used];
    for (const attempt of [
      { ...filter, excludeIds: [...used, ...session.history] },
      { ...filter, excludeIds: used },
      { ...filter, ratingMin: 0, ratingMax: 4000, excludeIds: used },
    ]) {
      const puzzle = await drawPuzzle(attempt);
      if (puzzle) return puzzle;
    }
    return null;
  }
  private sendPuzzle(session: Session, puzzle: PuzzleRow, client: Client) {
    const board = this.room.state.boards.get(session.boardId);
    const seat = board && this.seat(board, session.userId);
    if (!seat || this.sessions.get(session.userId) !== session || this.client(session.userId) !== client) return;
    session.used.add(puzzle.puzzleId);
    const id = randomUUID();
    session.current = { id, puzzle, k: 0, seat };
    this.byPuzzle.set(id, session);
    const context: PuzzleContext = session.kind === 'lesson'
      ? { kind: 'lesson', theme: session.theme!, difficulty: session.difficulty!, index: session.index, total: LESSON_PRACTICE_SIZE }
      : { kind: 'problem', index: session.index, filters: session.filters! };
    const setup = puzzleSetup(puzzle);
    client.send(PUZZLE_MSG.puzzleStarted, {
      sessionId: id, context, puzzleId: puzzle.puzzleId, rating: puzzle.rating,
      boardId: board.id, seat, themes: [], fen: puzzle.fen, setupMove: setup.setupMove,
      playerColor: setup.playerColor, solutionLength: setup.solutionLength,
    });
  }
  ownsSession(id: unknown): boolean { return typeof id === 'string' && this.byPuzzle.has(id); }
  async puzzleMove(client: Client, payload: unknown) {
    await this.guarded(client, async () => {
      const input = payload as { sessionId?: unknown; uci?: unknown } | null;
      const session = typeof input?.sessionId === 'string' ? this.byPuzzle.get(input.sessionId) : undefined;
      const user = this.player(client);
      const current = session?.current;
      if (!session || !user || user.id !== session.userId || !current || current.id !== input?.sessionId ||
        typeof input?.uci !== 'string' || user.currentBoardId !== session.boardId) {
        this.error(client, 'session_invalid', 'Sessão de puzzle inválida.'); return;
      }
      const evaluation = evaluatePlayerMove(current.puzzle, current.k, input.uci);
      if (!evaluation.legal) { this.error(client, 'illegal_move', 'Lance ilegal nesta posição.'); return; }
      const feedback: Record<string, unknown> = { sessionId: current.id, ok: evaluation.ok, moveIndex: current.k, solved: evaluation.solved };
      if (evaluation.ok && !evaluation.solved) {
        current.k++;
        feedback.reply = evaluation.reply;
        client.send(PUZZLE_MSG.puzzleFeedback, feedback);
        return;
      }
      this.byPuzzle.delete(current.id);
      session.current = undefined;
      session.attempted++;
      if (evaluation.solved) session.solved++;
      else feedback.solutionMoves = puzzleSolutionMoves(current.puzzle);
      client.send(PUZZLE_MSG.puzzleFeedback, feedback);
      await insertPuzzleHistory(user.id, {
        puzzleId: current.puzzle.puzzleId, mode: session.kind,
        theme: session.kind === 'lesson' ? session.theme! : puzzleMainThemes(current.puzzle.themes)[0] ?? null,
        solved: evaluation.solved, firstTry: evaluation.solved, rating: current.puzzle.rating,
      });
      if (this.sessions.get(user.id) !== session) return;
      client.send(LESSON_MSG.state, await buildLessonState(user.id));
      if (session.kind === 'lesson' && session.attempted >= LESSON_PRACTICE_SIZE) await this.end(session, 'finished');
    });
  }
  async next(client: Client, payload: unknown) {
    await this.guarded(client, async () => {
      const board = this.seated(client, (payload as { boardId?: unknown } | null)?.boardId);
      if (!board) return;
      const session = this.sessions.get(this.player(client)!.id);
      if (!session || session.boardId !== board.id || session.current) {
        this.error(client, 'session_invalid', 'Conclua o puzzle atual antes de avançar.'); return;
      }
      if (session.kind === 'lesson' && session.attempted >= LESSON_PRACTICE_SIZE) { await this.end(session, 'finished'); return; }
      const puzzle = await this.draw(session);
      if (this.sessions.get(session.userId) !== session || this.client(session.userId) !== client) return;
      if (!puzzle) { this.error(client, 'no_puzzles', 'Nenhum puzzle disponível para estes filtros.'); return; }
      session.index++;
      this.sendPuzzle(session, puzzle, client);
    });
  }
  private async end(session: Session, reason: 'finished' | 'stopped' | 'left') {
    if (this.sessions.get(session.userId) !== session) return;
    this.sessions.delete(session.userId);
    if (session.current) this.byPuzzle.delete(session.current.id);
    const client = this.client(session.userId);
    const result: LessonSessionEndPayload = {
      kind: session.kind, solved: session.solved, attempted: session.attempted, reason,
      ...(session.kind === 'lesson' ? { theme: session.theme, total: LESSON_PRACTICE_SIZE } : {}),
    };
    try {
      if (reason === 'finished' && session.kind === 'lesson') {
        const saved = await saveLessonProgress(session.userId, session.theme!, session.solved);
        result.completed = saved.completed;
        result.newlyCompleted = saved.newlyCompleted;
      }
      if (client) {
        client.send(LESSON_MSG.sessionEnd, result);
        client.send(LESSON_MSG.state, await buildLessonState(session.userId));
      }
    } catch (error) { if (client) this.failure(client, error); else console.warn('[academy-lessons] fim:', error); }
  }
  stop(client: Client) {
    const id = this.player(client)?.id;
    if (!id) return;
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1);
    const session = this.sessions.get(id);
    if (session) void this.end(session, 'stopped');
  }
  leave(client: Client) {
    const user = this.player(client);
    if (user) this.release(user.id);
  }
  onJoin(client: Client) {
    const user = this.player(client);
    if (!user) return;
    for (const board of this.room.state.boards.values()) if (academyTableKind(board.id) === 'lesson') {
      const seat = this.seat(board, user.id);
      if (seat) {
        if (user.currentBoardId && user.currentBoardId !== board.id) { this.release(user.id); return; }
        user.currentBoardId = board.id;
        client.send(LESSON_MSG.seated, { boardId: board.id, seat });
        void this.open(client);
        return;
      }
    }
  }
  onLeave(client: Client) {
    const id = this.player(client)?.id;
    if (id) this.release(id);
  }
  onStaleSession(id: string) { this.release(id); }
  private release(id: string) {
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1);
    const session = this.sessions.get(id);
    if (session) void this.end(session, 'left');
    for (const board of this.room.state.boards.values()) if (academyTableKind(board.id) === 'lesson') {
      if (board.whitePlayerId === id) board.whitePlayerId = '';
      if (board.blackPlayerId === id) board.blackPlayerId = '';
      if (!board.whitePlayerId && !board.blackPlayerId && board.status !== 'idle') this.room.resetBoard(board);
    }
    const client = this.client(id);
    const player = client && this.player(client);
    if (player && academyTableKind(player.currentBoardId) === 'lesson') player.currentBoardId = '';
  }
}