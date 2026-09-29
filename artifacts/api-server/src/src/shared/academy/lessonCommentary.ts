/** Comentários verificáveis das jogadas dos exemplos da Sala de Lições. */
import { Chess, type PieceSymbol, type Square } from 'chess.js';
import { parseUci } from './puzzleSolver.js';
import type { LessonThemeId } from './LessonShapes.js';
import type { LessonExample } from './lessonExamples.js';

const pieces: Record<PieceSymbol, string> = { k: 'Rei', q: 'Dama', r: 'Torre', b: 'Bispo', n: 'Cavalo', p: 'Peão' };
const values: Record<PieceSymbol, number> = { k: 100, q: 9, r: 5, b: 3, n: 3, p: 1 };
const article: Record<PieceSymbol, string> = { k: 'o rei', q: 'a dama', r: 'a torre', b: 'o bispo', n: 'o cavalo', p: 'o peão' };
const enemyColor = (c: 'w' | 'b'): 'w' | 'b' => c === 'w' ? 'b' : 'w';

/** Peças na mesma linha do lance, em ordem da casa do atacante para fora. */
function rays(chess: Chess, from: Square): { direction: string; pieces: { type: PieceSymbol; color: 'w' | 'b'; square: Square }[] }[] {
  const result: { direction: string; pieces: { type: PieceSymbol; color: 'w' | 'b'; square: Square }[] }[] = [];
  for (const [dx, dy] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    const seen: { type: PieceSymbol; color: 'w' | 'b'; square: Square }[] = [];
    for (let f = from.charCodeAt(0) - 97 + dx, r = Number(from[1]) + dy; f >= 0 && f < 8 && r >= 1 && r <= 8; f += dx, r += dy) {
      const sq = `${String.fromCharCode(f + 97)}${r}` as Square;
      const piece = chess.get(sq);
      if (piece) seen.push({ ...piece, square: sq });
    }
    result.push({ direction: Math.abs(dx) === Math.abs(dy) ? 'diagonal' : 'reta', pieces: seen });
  }
  return result;
}
const themeNotes: Partial<Record<LessonThemeId, string>> = {
  mate_in_1: 'O objetivo é encerrar a partida em um lance.',
  mate_in_2: 'Cada resposta precisa ser considerada antes do mate.',
  mate_in_3: 'A sequência restringe as defesas do rei.',
  back_rank_mate: 'Observe as casas de fuga do rei na última fileira.',
  smothered_mate: 'O cavalo dá xeque mesmo com as casas próximas ocupadas.',
  fork: 'Procure as ameaças simultâneas criadas pelo lance.',
  pin: 'Verifique a peça alinhada atrás do alvo atacado.',
  skewer: 'A peça na frente pode deixar exposto o alvo atrás.',
  discovered_attack: 'O movimento pode liberar uma linha de ataque.',
  double_check: 'Confira se duas peças atacam o rei ao mesmo tempo.',
  hanging_piece: 'Confira se a peça atacada tem defensores.',
  trapped_piece: 'Considere as casas de fuga da peça atacada.',
  sacrifice: 'Calcule a compensação antes de entregar material.',
  deflection: 'Observe a função defensiva da peça deslocada.',
  attraction: 'A casa de destino pode expor a peça a outra ameaça.',
  interference: 'Uma linha de defesa pode ser interrompida.',
  x_ray_attack: 'Observe as peças alinhadas na mesma linha.',
  zugzwang: 'A obrigação de jogar pode piorar a posição.',
  advanced_pawn: 'Um peão próximo da última fileira ameaça promover.',
  promotion: 'O peão pode escolher uma nova peça na última fileira.',
  underpromotion: 'Uma peça diferente da dama pode ser decisiva.',
  pawn_endgame: 'Conte os tempos da corrida dos peões.',
  rook_endgame: 'Atividade da torre e posição do rei são decisivas.',
  queen_endgame: 'Procure os xeques disponíveis para ambas as damas.',
  knight_endgame: 'O cavalo pode criar garfos em poucas jogadas.',
  bishop_endgame: 'Observe as diagonais abertas e a cor das casas.',
};

/** Descreve apenas fatos conferidos na posição; lança erro em lances ilegais. */
export function describeMove(fenBefore: string, uci: string, opts: { theme: LessonThemeId; ply: number; isPlayerMove: boolean; isLast: boolean }): string {
  const chess = new Chess(fenBefore);
  const before = new Chess(fenBefore);
  const parsed = parseUci(uci);
  if (!parsed) throw new Error(`Lance UCI inválido: ${uci}`);
  const move = chess.move(parsed);
  const color = move.color;
  if (opts.ply === 0) return `O adversário joga ${move.san}. Agora é a vez das ${chess.turn() === 'w' ? 'brancas' : 'pretas'}.`;
  const target = move.isEnPassant() ? `${move.to[0]}${move.from[1]}` : move.to;
  let action: string;
  if (move.isKingsideCastle() || move.isQueensideCastle()) action = `Roque ${move.isKingsideCastle() ? 'pequeno' : 'grande'}`;
  else if (move.isEnPassant()) action = `O peão captura en passant em ${move.to}`;
  else if (move.captured) action = `${article[move.piece][0].toUpperCase()}${article[move.piece].slice(1)} captura ${article[move.captured]} de ${target}`;
  else if (move.piece === 'n') action = `O cavalo salta para ${move.to}`;
  else if (move.piece === 'p') action = `O peão avança até ${move.to}`;
  else action = `${article[move.piece][0].toUpperCase()}${article[move.piece].slice(1)} vai a ${move.to}`;
  if (move.promotion) action += `. Promoção a ${pieces[move.promotion].toLowerCase()}`;
  if (chess.isCheckmate() && !opts.isLast) action += ' e dá mate';
  else if (chess.isCheck() && !chess.isCheckmate()) action += ' com xeque';
  let clause = `${action}.`;

  const opponent = enemyColor(color);
  if (opts.isPlayerMove && chess.isCheckmate()) {
    const king = chess.board().flat().find((p) => p?.type === 'k' && p.color === opponent);
    if (king && opts.theme === 'back_rank_mate' && ['1', '8'].includes(king.square[1])) {
      const innerRank = king.square[1] === '1' ? '2' : '7';
      const ownPawns = [-1, 0, 1].some((offset) => {
        const file = king.square.charCodeAt(0) + offset;
        if (file < 97 || file > 104) return false;
        const p = chess.get(`${String.fromCharCode(file)}${innerRank}` as Square);
        return p?.color === opponent && p.type === 'p';
      });
      clause += ownPawns ? ' Na última fileira, os próprios peões fecham a saída do rei.' : ' Na última fileira, o rei não encontra casa de fuga.';
    } else if (opts.theme === 'smothered_mate' && move.piece === 'n') {
      clause += ' O cavalo dá mate e o rei não encontra casa de fuga.';
    }
  }
  const threatened: { type: PieceSymbol; square: Square }[] = [];
  for (const row of chess.board()) for (const piece of row) {
    if (!piece || piece.color === color || piece.square === move.to) continue;
    const sq = piece.square as Square;
    if (!chess.attackers(sq, color).includes(move.to as Square)) continue;
    if (piece.type === 'k' || values[piece.type] > values[move.piece] || chess.attackers(sq, opponent).length === 0)
      threatened.push({ type: piece.type, square: sq });
  }
  if (opts.isPlayerMove && !chess.isCheckmate()) {
    const lines = rays(chess, move.to as Square)
      .filter((ray) => move.piece === 'q' || (move.piece === 'r' && ray.direction === 'reta') || (move.piece === 'b' && ray.direction === 'diagonal'))
      .filter((ray) => ray.pieces.length >= 2 && ray.pieces[0].color === opponent && ray.pieces[1].color === opponent);
    const pin = lines.find((ray) => ['k', 'q'].includes(ray.pieces[1].type));
    const skewer = lines.find((ray) => ['k', 'q'].includes(ray.pieces[0].type));
    if (opts.theme === 'fork' && threatened.length >= 2) {
      clause += ` Garfo: ataca ao mesmo tempo ${article[threatened[0].type]} de ${threatened[0].square} e ${article[threatened[1].type]} de ${threatened[1].square}.`;
    } else if (opts.theme === 'pin' && pin) {
      clause += ` ${pieces[pin.pieces[0].type]} em ${pin.pieces[0].square} fica alinhado à frente ${article[pin.pieces[1].type]} de ${pin.pieces[1].square}.`;
    } else if (opts.theme === 'skewer' && skewer) {
      clause += ` ${pieces[skewer.pieces[0].type]} em ${skewer.pieces[0].square} está à frente ${article[skewer.pieces[1].type]} de ${skewer.pieces[1].square}.`;
    } else if (opts.theme === 'discovered_attack') {
      const revealed = chess.board().flat().find((p) => p && p.color === color && p.square !== move.to && ['q', 'r', 'b'].includes(p.type)
        && chess.board().flat().some((target) => target && target.color === opponent
          && chess.attackers(target.square as Square, color).includes(p.square as Square)
          && !before.attackers(target.square as Square, color).includes(p.square as Square)));
      if (revealed) {
        const target = chess.board().flat().find((p) => p && p.color === opponent
          && chess.attackers(p.square as Square, color).includes(revealed.square as Square)
          && !before.attackers(p.square as Square, color).includes(revealed.square as Square));
        if (target) clause += ` A saída libera ${article[revealed.type]} de ${revealed.square}, que ataca ${article[target.type]} de ${target.square}.`;
      }
    } else if (opts.theme === 'double_check' && chess.isCheck()) {
      const king = chess.board().flat().find((p) => p?.type === 'k' && p.color === opponent);
      const checkers = king ? chess.attackers(king.square as Square, color) : [];
      if (checkers.length >= 2) clause += ` Duas peças dão xeque: ${checkers.slice(0, 2).map((sq) => `${article[chess.get(sq)!.type]} de ${sq}`).join(' e ')}.`;
    } else if (opts.theme === 'back_rank_mate' && chess.isCheckmate()) {
      const king = chess.board().flat().find((p) => p?.type === 'k' && p.color === opponent);
      if (king && ['1', '8'].includes(king.square[1])) clause += ' O rei na última fileira não tem casa de fuga.';
    } else if (opts.theme === 'smothered_mate' && chess.isCheckmate() && move.piece === 'n') {
      clause += ' O cavalo dá mate enquanto as casas de fuga do rei estão bloqueadas.';
    } else if (opts.theme === 'sacrifice' && chess.attackers(move.to as Square, opponent).length) {
      clause += ` ${pieces[move.piece]} em ${move.to} fica ao alcance do adversário.`;
    } else if (threatened.length) {
      clause += ` Ameaça ${threatened.slice(0, 2).map((p) => `${article[p.type]} de ${p.square}`).join(' e ')}.`;
    } else if (!opts.isLast) {
      clause += ` ${themeNotes[opts.theme]}`;
    }
  }
  if (opts.isLast && chess.isCheckmate()) clause += ' Mate!';
  return clause;
}

/** Reconstrói todos os comentários de um exemplo, incluindo o lance preparatório. */
export function describeExample(example: LessonExample): string[] {
  const chess = new Chess(example.fen);
  return example.moves.map((uci, ply) => {
    const comment = describeMove(chess.fen(), uci, { theme: example.theme, ply, isPlayerMove: ply % 2 === 1, isLast: ply === example.moves.length - 1 });
    const parsed = parseUci(uci);
    if (!parsed) throw new Error(`Lance UCI inválido: ${uci}`);
    chess.move(parsed);
    return comment;
  });
}