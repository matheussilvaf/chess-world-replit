import { useEffect, useRef, useState } from 'react';
import { BattleEngine, type BattleEngineEvent } from '../../shared/academy/battleEngine';
import { isValidPuzzle, evaluatePlayerMove, puzzleSetup, type PuzzleMoves } from '../../shared/academy/puzzleSolver';
import { BATTLE_MODES, BATTLE_MODE_INFO, PUZZLE_BANDS, PUZZLE_BAND_INFO, type BattleCreatePayload, type BattleStatePayload } from '../../shared/academy/PuzzleShapes';
import { useBattleStore } from '../../stores/battleStore';
import { useGameStore } from '../../stores/gameStore';
import { usePuzzleSessionStore } from '../../stores/puzzleSessionStore';
import { BattleChallengeModal } from '../academy/puzzles/BattleChallengeModal';
import { PuzzleHUD } from '../academy/puzzles/PuzzleHUD';
import { PuzzleTableOverlay } from '../academy/puzzles/PuzzleTableOverlay';
import { BenchTableFrame } from './BenchTableFrame';

const BOARD_ID = 'academy_challenge_1';
const PUZZLES = [
  { puzzle_id: 'l1Pgu', fen: '2k5/1pp2ppp/1q2p3/7n/5r2/2N2Q2/PPP2PPP/1R4K1 w - - 7 20', moves: ['f3h5', 'b6f2', 'g1h1', 'f2f1', 'b1f1', 'f4f1'], rating: 751, themes: ['backRankMate', 'mateIn3'] },
  { puzzle_id: 'wDpDn', fen: '4n3/p5k1/4P1p1/1PbK1P2/6PB/8/8/8 b - - 2 51', moves: ['c5b6', 'd5c6', 'g6f5', 'c6d7'], rating: 2732, themes: ['crushing', 'endgame'] },
  { puzzle_id: 'devMate', fen: '6k1/5ppp/8/8/8/8/5PPP/R2Q2K1 b - - 0 1', moves: ['g8h8', 'a1a8'], rating: 1200, themes: ['mateIn1'] },
  { puzzle_id: 'devOpening', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: ['d2d4', 'd7d5', 'g1f3'], rating: 900, themes: ['opening'] },
] as const;
const validPuzzles = PUZZLES.filter((p) => isValidPuzzle(p));
if (validPuzzles.length !== PUZZLES.length) throw new Error('Puzzle inválido na bancada de batalhas.');

export default function BattlesBenchPage() {
  const [mode, setMode] = useState<BattleCreatePayload['mode']>('race');
  const [band, setBand] = useState<BattleCreatePayload['band']>('beginner');
  const [simulateFallback, setSimulateFallback] = useState(false);
  const [modal, setModal] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const engine = useRef<BattleEngine | null>(null);
  const config = useRef<BattleCreatePayload | null>(null);
  const moveIndex = useRef(0);
  const botTimer = useRef<number | null>(null);
  const acceptTimer = useRef<number | null>(null);
  const board = (status: string, settings?: BattleCreatePayload) => {
    useGameStore.getState().setColyseusBoards([{
      id: BOARD_ID, name: 'Desafio 1', status, waitingPlayerId: status === 'waiting' ? 'bench-me' : '',
      waitingPlayerName: status === 'waiting' ? 'Você' : '',
      timeCategory: '', baseMinutes: 0, incrementSeconds: 0, timeLabel: '', matchId: '',
      battleMode: settings?.mode, battleBand: settings?.band, battleShowThemes: settings?.showThemes, battleTheme: settings?.theme,
      battleExpiresAt: status === 'waiting' ? Date.now() + 600_000 : undefined,
    }]);
  };
  const publish = () => {
    const current = engine.current, settings = config.current;
    if (!current || !settings) return;
    const now = Date.now(), view = current.view('bench-me', now);
    current.setPuzzleColor('bench-bot', view.opponent.index, puzzleSetup(validPuzzles[view.opponent.index % validPuzzles.length]).playerColor);
    const updated = current.view('bench-me', now);
    const snapshot: BattleStatePayload = {
      battleId: 'bench-battle', boardId: BOARD_ID, mySeat: 'bottom', mode: settings.mode, band: settings.band,
      showThemes: settings.showThemes, theme: settings.theme, serverNow: now, ...updated,
      result: updated.result ? { ...updated.result, myRewardGambits: 0, gambitsBalance: null } : undefined,
    };
    useBattleStore.getState().setBattle(snapshot);
    useBattleStore.getState().setScreenOpen(true);
  };
  const assign = (index: number) => {
    const p = validPuzzles[index % validPuzzles.length];
    const setup = puzzleSetup(p);
    engine.current?.setPuzzleColor('bench-me', index, setup.playerColor);
    const themeFallback = simulateFallback && !!config.current?.theme;
    moveIndex.current = 0;
    const started = {
      puzzleId: p.puzzle_id, rating: p.rating, themes: config.current?.showThemes || themeFallback ? [...p.themes] : [], themeFallback, boardId: BOARD_ID, seat: 'bottom' as const,
      sessionId: `bench-${index}-${Date.now()}`, context: { kind: 'battle' as const, battleId: 'bench-battle', index },
      fen: setup.fen, setupMove: setup.setupMove, playerColor: setup.playerColor, solutionLength: setup.solutionLength,
      livesLeft: engine.current?.view('bench-me', Date.now()).me.lives,
      deadlineAt: engine.current?.view('bench-me', Date.now()).bestOf?.deadlineAt,
    };
    useBattleStore.getState().setPuzzle(started);
    usePuzzleSessionStore.getState().start(started);
  };
  const applyEvents = (events: BattleEngineEvent[]) => {
    for (const event of events) {
      if (event.type === 'puzzle_over' && event.playerId === 'bench-me') {
        const p = useBattleStore.getState().puzzle;
        if (p) {
          const feedback = { sessionId: p.sessionId, ok: false, solved: false, moveIndex: moveIndex.current, puzzleOver: true, puzzleOverReason: event.reason };
          useBattleStore.getState().setFeedback(feedback);
          usePuzzleSessionStore.getState().applyFeedback(feedback);
        }
      }
      if (event.type === 'puzzle_assigned' && event.playerId === 'bench-me') assign(event.index);
    }
    if (events.length) publish();
  };
  const start = (settings: BattleCreatePayload) => {
    config.current = settings;
    board('waiting', settings);
    setWaiting(true);
    acceptTimer.current = window.setTimeout(() => {
      setModal(false);
      setWaiting(false);
      board('playing', settings);
      engine.current = new BattleEngine({
        mode: settings.mode, band: settings.band,
        players: [{ id: 'bench-me', name: 'Você' }, { id: 'bench-bot', name: 'Bot da bancada' }], now: Date.now(),
      });
      publish();
    }, 2000);
  };
  useEffect(() => {
    const ticker = window.setInterval(() => {
      if (engine.current) applyEvents(engine.current.tick(Date.now()));
    }, 250);
    return () => { window.clearInterval(ticker); if (botTimer.current) window.clearTimeout(botTimer.current); if (acceptTimer.current) window.clearTimeout(acceptTimer.current); useBattleStore.getState().clear(); usePuzzleSessionStore.getState().clear(); };
  }, []);
  useEffect(() => {
    if (!engine.current || engine.current.phase === 'finished') return;
    const bot = () => {
      if (!engine.current || engine.current.phase !== 'running') return;
      applyEvents(engine.current.playerMove('bench-bot', { ok: Math.random() > 0.28, solved: true }, Date.now()));
      botTimer.current = window.setTimeout(bot, 2000 + Math.random() * 4000);
    };
    botTimer.current = window.setTimeout(bot, 2000 + Math.random() * 4000);
    return () => { if (botTimer.current) window.clearTimeout(botTimer.current); };
  }, [waiting]);
  const move = (sessionId: string, uci: string) => {
    const active = useBattleStore.getState().puzzle;
    if (!active || active.sessionId !== sessionId || !engine.current || engine.current.phase !== 'running') return;
    const p = validPuzzles[active.context.kind === 'battle' ? active.context.index % validPuzzles.length : 0] as PuzzleMoves;
    const evaluation = evaluatePlayerMove(p, moveIndex.current, uci);
    if (!evaluation.legal) return;
    const feedback = {
      sessionId, ok: evaluation.ok, solved: evaluation.solved, moveIndex: moveIndex.current,
      reply: evaluation.reply, puzzleOver: !evaluation.ok, puzzleOverReason: evaluation.ok ? undefined : 'wrong' as const,
      livesLeft: engine.current.view('bench-me', Date.now()).me.lives,
    };
    useBattleStore.getState().setFeedback(feedback);
    usePuzzleSessionStore.getState().applyFeedback(feedback);
    if (evaluation.ok && !evaluation.solved) { moveIndex.current += 1; return; }
    // Deixa o tabuleiro animar o feedback (acerto/erro) antes do próximo puzzle.
    window.setTimeout(() => { if (engine.current) applyEvents(engine.current.playerMove('bench-me', evaluation, Date.now())); }, 850);
  };
  const battleOpen = useBattleStore((s) => s.screenOpen && !!s.battle);
  return <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
    {!battleOpen && <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-3xl font-bold text-amber-300">Bancada das batalhas de puzzles</h1>
      <p>Simulação local: sem login nem conexão com o servidor.</p>
      <div className="flex flex-wrap gap-3">
        <label>Modo <select data-testid="bench-mode" value={mode} onChange={(e) => setMode(e.target.value as BattleCreatePayload['mode'])} className="ml-2 bg-slate-800 p-2">{BATTLE_MODES.map((value) => <option key={value} value={value}>{BATTLE_MODE_INFO[value].label}</option>)}</select></label>
        <label>Faixa <select data-testid="bench-band" value={band} onChange={(e) => setBand(e.target.value as BattleCreatePayload['band'])} className="ml-2 bg-slate-800 p-2">{PUZZLE_BANDS.map((value) => <option key={value} value={value}>{PUZZLE_BAND_INFO[value].label}</option>)}</select></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="bench-theme-fallback" checked={simulateFallback} onChange={(e) => setSimulateFallback(e.target.checked)} />Simular tema indisponível (mostrar tema real)</label>
      <button data-testid="bench-create" onClick={() => { board('idle'); setModal(true); }} className="rounded-xl bg-amber-500 px-6 py-3 font-bold text-slate-950">Criar desafio</button>
      {waiting && <p data-testid="bench-waiting">O bot aceitará o desafio em 2 segundos…</p>}
    </div>}
    {modal && <BattleChallengeModal boardId={BOARD_ID} myId="bench-me" initialMode={mode} initialBand={band} onClose={() => setModal(false)} onCreate={(payload) => start(payload)}
      onCancel={() => { if (acceptTimer.current) window.clearTimeout(acceptTimer.current); board('idle'); setWaiting(false); setModal(false); }} />}
    {battleOpen && <BenchTableFrame>{(rect) => <>
      <PuzzleTableOverlay rectOverride={rect} onMove={move} />
      <PuzzleHUD onDismissBattle={() => { engine.current = null; board('idle'); useBattleStore.getState().clear(); usePuzzleSessionStore.getState().clear(); }}
        onForfeit={() => { if (engine.current) applyEvents(engine.current.forfeit('bench-me', Date.now())); }} />
    </>}</BenchTableFrame>}
  </main>;
}