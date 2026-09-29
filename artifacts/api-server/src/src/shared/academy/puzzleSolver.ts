/**
 * Lógica PURA de resolução de puzzles no formato Lichess (compartilhada).
 *
 * `moves` em UCI: moves[0] = lance de preparação do adversário (aplicado
 * automaticamente sobre `fen`); moves[1], moves[3], … = lances do jogador;
 * moves[2], moves[4], … = respostas automáticas do adversário.
 *
 * Regra do Lichess adotada: qualquer lance que dê MATE é aceito como correto,
 * mesmo que diferente do lance esperado.
 *
 * O servidor usa isto para validar lance a lance sem revelar a solução; o
 * cliente só a usa em bancadas locais (/dev) com puzzles embutidos.
 */
import { Chess } from 'chess.js';

export interface PuzzleMoves {
  fen: string;
  moves: readonly string[];
}

export interface UciMove {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

export function parseUci(uci: string): UciMove | null {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(uci.trim());
  if (!m) return null;
  const promo = m[3]?.toLowerCase() as UciMove['promotion'] | undefined;
  return promo ? { from: m[1].toLowerCase(), to: m[2].toLowerCase(), promotion: promo } : { from: m[1].toLowerCase(), to: m[2].toLowerCase() };
}

export function toUci(move: { from: string; to: string; promotion?: string | null }): string {
  return `${move.from}${move.to}${move.promotion ? move.promotion.toLowerCase() : ''}`;
}

/** Nº de lances que o jogador precisa acertar. */
export function puzzlePlayerMoveCount(moves: readonly string[]): number {
  return Math.max(0, Math.ceil((moves.length - 1) / 2));
}

/** Índice em `moves` do k-ésimo lance do jogador (0-based). */
export function playerMoveIndex(k: number): number {
  return 1 + 2 * k;
}

export function isValidPuzzle(puzzle: PuzzleMoves): boolean {
  if (!puzzle || typeof puzzle.fen !== 'string' || !Array.isArray(puzzle.moves) || puzzle.moves.length < 2) return false;
  try {
    const chess = new Chess(puzzle.fen);
    for (const uci of puzzle.moves) {
      const move = parseUci(uci);
      if (!move) return false;
      chess.move(move);
    }
    return true;
  } catch {
    return false;
  }
}

/** Posição após aplicar `moves[0 .. count-1]` sobre `fen`. Lança se algum lance for ilegal. */
export function fenAfterMoves(puzzle: PuzzleMoves, count: number): string {
  const chess = new Chess(puzzle.fen);
  for (let i = 0; i < count; i += 1) {
    const move = parseUci(puzzle.moves[i]);
    if (!move) throw new Error(`Lance UCI inválido no puzzle: ${puzzle.moves[i]}`);
    chess.move(move);
  }
  return chess.fen();
}

export interface PuzzleSetup {
  /** Posição ANTES do lance de preparação (a `fen` original). */
  fen: string;
  /** Posição depois do lance de preparação — onde o jogador começa a jogar. */
  fenAfterSetup: string;
  setupMove: string;
  playerColor: 'w' | 'b';
  solutionLength: number;
}

export function puzzleSetup(puzzle: PuzzleMoves): PuzzleSetup {
  const chess = new Chess(puzzle.fen);
  const setup = parseUci(puzzle.moves[0]);
  if (!setup) throw new Error(`Lance de preparação inválido: ${puzzle.moves[0]}`);
  chess.move(setup);
  return {
    fen: puzzle.fen,
    fenAfterSetup: chess.fen(),
    setupMove: toUci(setup),
    playerColor: chess.turn(),
    solutionLength: puzzlePlayerMoveCount(puzzle.moves),
  };
}

/** Posição em que o jogador deve jogar seu k-ésimo lance (0-based). */
export function fenBeforePlayerMove(puzzle: PuzzleMoves, k: number): string {
  return fenAfterMoves(puzzle, playerMoveIndex(k));
}

export interface PuzzleMoveEvaluation {
  /** Lance aceito (igual ao esperado ou dá mate). */
  ok: boolean;
  /** Lance sequer legal na posição. */
  legal: boolean;
  /** Puzzle completo após este lance. */
  solved: boolean;
  /** Resposta automática do adversário (UCI), quando `ok && !solved`. */
  reply?: string;
  /** Posição após o lance do jogador (e após a resposta, em `fenAfterReply`). */
  fenAfterMove?: string;
  fenAfterReply?: string;
}

/**
 * Avalia o k-ésimo lance do jogador (0-based) na sequência do puzzle.
 * Nunca revela lances futuros além da resposta imediata do adversário.
 */
export function evaluatePlayerMove(puzzle: PuzzleMoves, k: number, uci: string): PuzzleMoveEvaluation {
  const total = puzzlePlayerMoveCount(puzzle.moves);
  if (k < 0 || k >= total) return { ok: false, legal: false, solved: false };
  const move = parseUci(uci);
  if (!move) return { ok: false, legal: false, solved: false };
  const chess = new Chess(fenBeforePlayerMove(puzzle, k));
  let played: { from: string; to: string; promotion?: string } | null = null;
  try {
    played = chess.move(move);
  } catch {
    played = null;
  }
  if (!played) return { ok: false, legal: false, solved: false };
  const expected = puzzle.moves[playerMoveIndex(k)].toLowerCase();
  const playedUci = toUci(played);
  const ok = playedUci === expected || chess.isCheckmate();
  if (!ok) return { ok: false, legal: true, solved: false, fenAfterMove: chess.fen() };
  const solved = k === total - 1 || chess.isCheckmate();
  if (solved) return { ok: true, legal: true, solved: true, fenAfterMove: chess.fen() };
  const replyIndex = playerMoveIndex(k) + 1;
  const replyUci = puzzle.moves[replyIndex];
  const reply = parseUci(replyUci);
  const fenAfterMove = chess.fen();
  if (!reply) return { ok: true, legal: true, solved: true, fenAfterMove };
  chess.move(reply);
  return { ok: true, legal: true, solved: false, reply: toUci(reply), fenAfterMove, fenAfterReply: chess.fen() };
}

/** Solução completa do ponto de vista do jogador (a partir de moves[1]), para exibir após reprovar. */
export function puzzleSolutionMoves(puzzle: PuzzleMoves): string[] {
  return puzzle.moves.slice(1).map((uci) => uci.toLowerCase());
}
