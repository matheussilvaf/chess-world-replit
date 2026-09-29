import { describe, expect, it } from 'vitest';
import { evaluatePlayerMove, isValidPuzzle, puzzlePlayerMoveCount, puzzleSetup, puzzleSolutionMoves } from './puzzleSolver';

// Puzzles reais do banco (lichess_puzzles).
const mateIn3 = { fen: '2k5/1pp2ppp/1q2p3/7n/5r2/2N2Q2/PPP2PPP/1R4K1 w - - 7 20', moves: ['f3h5', 'b6f2', 'g1h1', 'f2f1', 'b1f1', 'f4f1'] };
const endgame = { fen: '4n3/p5k1/4P1p1/1PbK1P2/6PB/8/8/8 b - - 2 51', moves: ['c5b6', 'd5c6', 'g6f5', 'c6d7'] };

describe('puzzleSolver', () => {
  it('valida e prepara o puzzle (setup = moves[0], jogador = lado a jogar depois)', () => {
    expect(isValidPuzzle(mateIn3)).toBe(true);
    expect(isValidPuzzle({ fen: mateIn3.fen, moves: ['f3h5'] })).toBe(false);
    const setup = puzzleSetup(mateIn3);
    expect(setup.setupMove).toBe('f3h5');
    expect(setup.playerColor).toBe('b');
    expect(setup.solutionLength).toBe(3);
    expect(puzzlePlayerMoveCount(endgame.moves)).toBe(2);
    expect(puzzleSetup(endgame).playerColor).toBe('w');
  });

  it('aceita a sequência esperada e devolve só a resposta imediata', () => {
    const first = evaluatePlayerMove(mateIn3, 0, 'b6f2');
    expect(first).toMatchObject({ ok: true, legal: true, solved: false, reply: 'g1h1' });
    const second = evaluatePlayerMove(mateIn3, 1, 'f2f1');
    expect(second).toMatchObject({ ok: true, solved: false, reply: 'b1f1' });
    const last = evaluatePlayerMove(mateIn3, 2, 'f4f1');
    expect(last).toMatchObject({ ok: true, solved: true });
    expect(last.reply).toBeUndefined();
  });

  it('recusa lance errado (legal) e lance ilegal', () => {
    expect(evaluatePlayerMove(mateIn3, 0, 'b6b2')).toMatchObject({ ok: false, legal: true, solved: false });
    expect(evaluatePlayerMove(mateIn3, 0, 'e1e2')).toMatchObject({ ok: false, legal: false });
    expect(evaluatePlayerMove(mateIn3, 0, 'xyz')).toMatchObject({ ok: false, legal: false });
    expect(evaluatePlayerMove(mateIn3, 5, 'b6f2').ok).toBe(false);
  });

  it('aceita mate alternativo e conclui o último lance de puzzle sem mate', () => {
    // Brancas: Ta1, Rg1, Dd1; pretas: Rg8, peões f7 g7 h7. Esperado Ta8#; Dd8# também é mate → aceito.
    const alt = { fen: '6k1/5ppp/8/8/8/8/5PPP/R2Q2K1 b - - 0 1', moves: ['g8h8', 'a1a8'] };
    const setup = puzzleSetup(alt);
    expect(setup.playerColor).toBe('w');
    expect(evaluatePlayerMove(alt, 0, 'a1a8')).toMatchObject({ ok: true, solved: true });
    expect(evaluatePlayerMove(alt, 0, 'd1d8')).toMatchObject({ ok: true, solved: true });
    expect(evaluatePlayerMove(alt, 0, 'd1d7')).toMatchObject({ ok: false, legal: true });
    expect(evaluatePlayerMove(endgame, 1, 'c6d7')).toMatchObject({ ok: true, solved: true });
    expect(puzzleSolutionMoves(endgame)).toEqual(['d5c6', 'g6f5', 'c6d7']);
  });
});
