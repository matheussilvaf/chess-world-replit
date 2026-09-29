import { describe, expect, it } from 'vitest';
import { parseUciInfo } from './StockfishBot';

describe('parseUciInfo', () => {
  it('extrai profundidade, índice MultiPV e o primeiro lance UCI', () => {
    expect(parseUciInfo('info depth 12 seldepth 17 multipv 3 score cp 20 pv e7e8q a7a6')).toEqual({
      depth: 12, multipv: 3, move: 'e7e8q',
    });
    expect(parseUciInfo('info depth 5 score cp 0 pv e2e4 e7e5')).toEqual({
      depth: 5, multipv: 1, move: 'e2e4',
    });
    expect(parseUciInfo('info string initializing')).toBeNull();
    expect(parseUciInfo('bestmove e2e4')).toBeNull();
  });
});