import { create } from 'zustand';
import { Chess } from 'chess.js';
import { parseUci } from '../shared/academy/puzzleSolver';
import type { PuzzleFeedbackPayload, PuzzleStartedPayload } from '../shared/academy/PuzzleShapes';

/**
 * Estado do puzzle em resolução NA MESA do mapa (diário e batalha usam o mesmo
 * fluxo). O tabuleiro (PuzzleTableOverlay) e o HUD (PuzzleHUD) leem daqui; a
 * rede (puzzleHandlers/battleHandlers) escreve.
 *
 * Fases: setup (anima o lance de preparação) → ready (vez do jogador) →
 * waiting (lance enviado) → reply (anima a resposta) → ready … → solved |
 * wrong (pisca vermelho) → solution (replay da solução, sem vidas) | over
 * (batalha: puzzle encerrado por erro/tempo/adversário).
 */
export type PuzzlePhase = 'setup' | 'ready' | 'waiting' | 'reply' | 'wrong' | 'solved' | 'solution' | 'over';

export interface Squares { from: string; to: string }
export interface MoveAnimation extends Squares { key: number }

/** Duração do piscar vermelho do lance errado (ms). */
export const WRONG_MOVE_BLINK_MS = 720;
/** Intervalo entre lances no replay automático da solução (ms). */
export const SOLUTION_STEP_MS = 700;

export function applyUci(fen: string, uci: string): string {
  const move = parseUci(uci);
  if (!move) return fen;
  try {
    const chess = new Chess(fen);
    chess.move(move);
    return chess.fen();
  } catch { return fen; }
}

interface PuzzleSessionState {
  puzzle: PuzzleStartedPayload | null;
  /** Último feedback desta sessão (solução, recompensa, motivo do fim). */
  feedback: PuzzleFeedbackPayload | null;
  /** Posição exibida, sem contar a animação pendente. */
  fen: string;
  /** Posição após o lance de preparação (base do replay da solução). */
  setupFen: string;
  phase: PuzzlePhase;
  moveNumber: number;
  last: Squares | null;
  animation: MoveAnimation | null;
  /** Casas do lance errado (piscam em vermelho). */
  error: Squares | null;
  solutionStep: number;
  manualSolution: boolean;
  /** Próxima sessão recebida enquanto o lance errado ainda piscava. */
  pending: PuzzleStartedPayload | null;

  start: (puzzle: PuzzleStartedPayload) => void;
  showExample: (example: { boardId: string; seat: 'top' | 'bottom'; fen: string; moves: string[]; playerColor: 'w' | 'b' }) => void;
  applyFeedback: (feedback: PuzzleFeedbackPayload) => void;
  animationDone: () => void;
  /** Lance do jogador: aplica localmente e entra em `waiting`. false = ilegal/fora de hora. */
  playerMove: (uci: string) => boolean;
  /** Passo do replay vindo do autoplay (não muda `manualSolution`). */
  setSolutionStep: (step: number) => void;
  /** Navegação feita pelo jogador: desliga o autoplay até `setSolutionAutoplay(true)`. */
  navigateSolution: (step: number) => void;
  setSolutionAutoplay: (on: boolean) => void;
  clear: () => void;
}

let blinkTimer: number | null = null;

function fresh(puzzle: PuzzleStartedPayload) {
  const m = parseUci(puzzle.setupMove);
  return {
    puzzle, feedback: null, fen: puzzle.fen, setupFen: applyUci(puzzle.fen, puzzle.setupMove),
    phase: 'setup' as PuzzlePhase, moveNumber: 1, last: null,
    animation: m ? { from: m.from, to: m.to, key: 0 } : null, error: null, solutionStep: 0, manualSolution: false, pending: null,
  };
}

export const usePuzzleSessionStore = create<PuzzleSessionState>((set, get) => ({
  puzzle: null, feedback: null, fen: '', setupFen: '', phase: 'setup', moveNumber: 1, last: null,
  animation: null, error: null, solutionStep: 0, manualSolution: false, pending: null,
  showExample: ({ boardId, seat, fen, moves, playerColor }) => set({
    puzzle: { sessionId: 'lesson-example', context: { kind: 'lesson', theme: 'fork', difficulty: 'iniciante', index: 0, total: 10 },
      puzzleId: 'lesson-example', boardId, seat, rating: 0, themes: [], fen, setupMove: '',
      playerColor, solutionLength: Math.ceil(moves.length / 2) },
    feedback: { sessionId: 'lesson-example', ok: true, solved: false, moveIndex: 0, solutionMoves: moves },
    fen, setupFen: fen, phase: 'solution', animation: null, error: null, last: null,
    solutionStep: 0, manualSolution: true, moveNumber: 1, pending: null,
  }),

  start: (puzzle) => {
    // O servidor manda o reinício logo após o erro: segura até o piscar terminar.
    if (blinkTimer !== null && get().phase === 'wrong') { set({ pending: puzzle }); return; }
    set(fresh(puzzle));
    // Sem lance de preparação legível: libera direto.
    if (!get().animation) set({ phase: 'ready' });
  },

  applyFeedback: (feedback) => {
    const { puzzle, last, setupFen } = get();
    if (!puzzle || feedback.sessionId !== puzzle.sessionId) return;
    if (feedback.puzzleOver && feedback.puzzleOverReason !== 'wrong') { set({ feedback, animation: null, phase: 'over' }); return; }
    if (!feedback.ok) {
      set({ feedback, animation: null, phase: 'wrong', error: last });
      if (blinkTimer !== null) window.clearTimeout(blinkTimer);
      blinkTimer = window.setTimeout(() => {
        blinkTimer = null;
        const state = get();
        if (state.puzzle?.sessionId !== feedback.sessionId) return;
        if (state.pending) { const next = state.pending; set({ pending: null }); state.start(next); return; }
        if (feedback.solutionMoves) set({ fen: setupFen, solutionStep: 0, phase: 'solution', error: null });
        else if (feedback.puzzleOver) set({ phase: 'over', error: null });
        else set({ error: null });
      }, WRONG_MOVE_BLINK_MS);
      return;
    }
    if (feedback.solved) { set({ feedback, phase: 'solved', error: null }); return; }
    const reply = feedback.reply ? parseUci(feedback.reply) : null;
    if (reply) set({ feedback, animation: { from: reply.from, to: reply.to, key: feedback.moveIndex + 1 }, phase: 'reply' });
    else set({ feedback, moveNumber: feedback.moveIndex + 2, phase: 'ready' });
  },

  animationDone: () => {
    const { animation, phase, puzzle, feedback, fen, moveNumber } = get();
    if (!animation || !puzzle) return;
    const uci = phase === 'setup' ? puzzle.setupMove : phase === 'reply' ? feedback?.reply : undefined;
    set({
      fen: uci ? applyUci(fen, uci) : fen, last: { from: animation.from, to: animation.to }, animation: null,
      moveNumber: phase === 'reply' ? moveNumber + 1 : moveNumber, phase: 'ready',
    });
  },

  playerMove: (uci) => {
    const { phase, fen } = get();
    if (phase !== 'ready') return false;
    const next = applyUci(fen, uci);
    if (next === fen) return false;
    set({ fen: next, last: { from: uci.slice(0, 2), to: uci.slice(2, 4) }, phase: 'waiting', error: null });
    return true;
  },

  setSolutionStep: (solutionStep) => set({ solutionStep }),
  navigateSolution: (solutionStep) => set({ solutionStep, manualSolution: true }),
  setSolutionAutoplay: (on) => set({ manualSolution: !on }),

  clear: () => {
    if (blinkTimer !== null) { window.clearTimeout(blinkTimer); blinkTimer = null; }
    set({ puzzle: null, feedback: null, fen: '', setupFen: '', phase: 'setup', moveNumber: 1, last: null,
      animation: null, error: null, solutionStep: 0, manualSolution: false, pending: null });
  },
}));

/**
 * FEN exibida agora (durante o replay da solução, a posição do passo atual).
 * Não use como seletor do hook: derive com useMemo (ver PuzzleTableOverlay).
 */
export function shownFen(state: Pick<PuzzleSessionState, 'phase' | 'feedback' | 'solutionStep' | 'setupFen' | 'fen'>): string {
  const solution = state.feedback?.solutionMoves;
  if (state.phase === 'solution' && solution) {
    return solution.slice(0, state.solutionStep).reduce((position, uci) => applyUci(position, uci), state.setupFen);
  }
  return state.fen;
}

/** Lance destacado agora (no replay, o último lance reproduzido). Idem: não é seletor. */
export function shownLast(state: Pick<PuzzleSessionState, 'phase' | 'feedback' | 'solutionStep' | 'last'>): Squares | null {
  const solution = state.feedback?.solutionMoves;
  if (state.phase === 'solution' && solution) {
    const uci = solution[state.solutionStep - 1];
    return uci ? { from: uci.slice(0, 2), to: uci.slice(2, 4) } : null;
  }
  return state.last;
}
