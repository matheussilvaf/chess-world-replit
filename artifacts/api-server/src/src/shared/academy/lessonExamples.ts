/** Exemplos fixos, selecionados de public.lichess_puzzles; não consulta o banco em execução. */
import type { LessonThemeId } from './LessonShapes.js';
import { describeExample } from './lessonCommentary.js';

/** Posição resolvida lance a lance, inclusive o lance preparatório do Lichess. */
export interface LessonExample {
  puzzleId: string;
  fen: string;
  moves: string[];
  rating: number;
  playerColor: 'w' | 'b';
  theme: LessonThemeId;
  title: string;
  intro: string;
  comments: string[];
  outro: string;
}

// Dados originais: [puzzle_id, fen ANTES do setup, UCI, rating, cor,
// título específico, observação da posição inicial, conclusão pedagógica].
type Source = [string, string, string, number, 'w' | 'b', string, string, string];
const sources: Record<LessonThemeId, Source[]> = {
  mate_in_1: [
    ['6Uc8v','r1b2rk1/pp1p1ppp/8/2q1P3/1n3P2/8/PPPQ2PP/2KR1BNR w - - 0 13','d2d6 c5c2',1123,'b','Dama captura em c2: mate imediato','A dama preta está em c5 e o rei branco em c1; observe a segunda fileira.','A captura em c2 encerra a partida antes que as brancas possam organizar uma defesa.'],
    ['8yAUb','8/R4pk1/p5p1/1bp3Np/2n1P2P/2P2P1B/1K4P1/3r4 w - - 13 33','b2c2 b5a4',1620,'b','Bispo em a4: mate na diagonal','O rei branco se desloca para c2; acompanhe a diagonal do bispo preto em b5.','Um bispo pode dar mate à distância quando o rei já não dispõe de fuga.'],
  ],
  mate_in_2: [
    ['T0qht','4r1k1/1b3pp1/8/3N4/P6Q/4B3/1nq2PPP/1R4K1 w - - 0 28','b1c1 c2c1 e3c1 e8e1',1392,'b','Dama em c1 e torre em e1','A dama preta mira c1 e a torre preta ocupa e8; repare na primeira fileira branca.','Depois da troca em c1, a torre encontra a primeira fileira sem defesa contra o mate.'],
    ['RiQGr','5r1k/p5p1/3Q4/2P1Bqnp/P2Pp1p1/4P1P1/5P1P/5RK1 w - - 3 31','c5c6 g5h3 g1h1 f5f3',1305,'b','Cavalo dá xeque; dama encerra em f3','O rei branco está em g1 e a dama preta em f5; observe as casas h3 e f3.','O xeque de cavalo conduz o rei a uma posição onde a dama pode dar mate.'],
  ],
  mate_in_3: [
    ['AakOS','8/8/PR6/7k/6p1/r6P/6PK/8 w - - 0 52','b6c6 g4g3 h2g1 a3a1 c6c1 a1c1',1375,'b','Peão em g3 e torre na primeira fileira','A torre preta em a3 e o peão em g4 pressionam o rei branco em h2.','O peão força o rei a recuar e a torre decide a sequência na primeira fileira.'],
    ['ApE5k','6rk/1p6/2pQ1R2/p6p/3P1P2/2P3P1/P1P1q1KP/8 w - - 3 31','g2h3 e2f1 h3h4 g8g4 h4h5 f1h3',1546,'b','Dama preta conduz o rei a h5','A dama preta está em e2 e o rei branco em g2; siga os xeques em f1 e h3.','Uma sequência calculada de xeques limita as fugas do rei até o mate.'],
  ],
  back_rank_mate: [
    ['K3nXw','2k1r3/1p1brppp/8/3p4/3Nn3/2P2B2/PP3PPP/R3RK2 w - - 5 21','a1d1 e4d2 f1g1 e7e1 d1e1 e8e1',1350,'b','Torres pretas invadem e1','Duas torres pretas ocupam e7 e e8; o rei branco está perto da primeira fileira.','Mesmo depois de uma troca em e1, a segunda torre pode ocupar a casa decisiva.'],
    ['rCxf6','4rrk1/pp3pp1/7p/q1pR4/2P1Q3/1P6/P3RPPP/6K1 w - - 1 24','e4c2 a5e1 e2e1 e8e1',1149,'b','Dama em e1 abre passagem à torre','A dama preta em a5 está alinhada com e1 e o rei branco não dispõe de uma saída fácil.','A troca da dama em e1 abre a mesma casa para a torre dar mate.'],
  ],
  smothered_mate: [
    ['ysO50','r4r2/4b1pk/1qpp3p/1p2pP1n/8/P1NP2P1/1P1B1nBP/1RQ2R1K w - - 5 26','h1g1 f2h3 g1h1 b6g1 f1g1 h3f2',1671,'b','Dama oferecida e cavalo em f2','O rei branco está em h1 e o cavalo preto em f2; observe as casas g1 e h3.','A captura da dama em g1 deixa o rei sem fuga contra o salto final do cavalo.'],
    ['HxaOg','r2q1r1k/pppb2pp/6nN/8/4N3/PQbP3P/4B1P1/R4R1K b - - 3 21','c3a1 b3g8 f8g8 h6f7',1657,'w','Dama atrai torre; cavalo dá mate','O cavalo branco está em h6, próximo do rei preto em h8; a dama branca ocupa b3.','A troca em g8 deixa o cavalo alcançar f7 com mate.'],
  ],
  fork: [
    ['ZZGSQ','3q3r/4kp1p/p2p3Q/1p1Np3/1P6/3b4/P1r2PPP/R3K2R b KQ - 3 21','e7d7 h6h3 d7e8 h3d3',1551,'w','Dama branca ameaça em h3','A dama branca ocupa h6 e o bispo preto está em d3; acompanhe os xeques após o recuo do rei.','Ataques com ganho de tempo podem terminar na captura de uma peça exposta.'],
    ['MIXC4','5rrk/ppp3pp/8/5q2/B1b1pn2/2B3R1/PQ3PPP/4R1K1 b - - 1 26','f4d3 c3g7 g8g7 b2g7',993,'w','Bispo captura em g7 com xeque','Os bispos brancos em a4 e c3 apontam para a ala do rei preto.','Uma captura com xeque pode obrigar a torre a abandonar a defesa de uma casa crítica.'],
  ],
  pin: [
    ['HMNxm','r2q1rk1/ppp2p1p/2np1bp1/8/4P1n1/2N1B3/PPPQ3P/2KR1BNR w - - 2 12','h2h3 g4e3 d2e3 f6g5 e3g5 d8g5',1425,'b','Cavalo em e3 e bispo em g5','O cavalo preto parte de g4 e o bispo de f6; observe o alinhamento com a dama em d8.','Depois das capturas em e3 e g5, a dama preta recaptura na mesma diagonal.'],
    ['zWWcu','1r3rk1/2p1Qppp/8/2P5/3q4/p5P1/B4PKP/4R3 b - - 3 30','b8b2 e7f7 f8f7 e1e8',1543,'w','Torre branca entra em e8','A dama branca em e7 e a torre em e1 miram a região do rei preto em g8.','O xeque de dama provoca uma captura e abre a fileira para a torre.'],
  ],
  skewer: [
    ['SYiRx','6Q1/4b3/1p2k3/8/1P2pq2/P7/6P1/7K b - - 2 63','e6d6 g8b8 d6d5 b8f4',1277,'w','Dama em b8: rei na frente, dama atrás','O rei preto está em e6 e a dama preta em f4; procure uma linha que atinja os dois.','O xeque em b8 afasta o rei e permite capturar a dama em f4.'],
    ['OwEdF','r1b1k2N/ppp3pp/2n5/3pp3/3q4/6P1/PPPPK3/RNBQ3R w q - 0 12','h1h4 c8g4 e2f1 g4d1',1224,'b','Bispo preto alcança a dama em d1','O bispo preto em c8 vê uma diagonal que passa pela posição do rei branco.','O xeque obriga o rei a sair da diagonal antes da captura da dama.'],
  ],
  discovered_attack: [
    ['xUpRx','3r2k1/3qQpp1/pp1P3p/2p5/2P5/1P5P/P5P1/3R2K1 w - - 2 28','g1h1 d7e7 d6e7 d8d1 h1h2 d1e1',1171,'b','Dama sai de d7; torre invade d1','A dama preta está em d7, diante da torre em d8; observe a coluna d.','Quando a dama deixa a coluna, a torre pode penetrar em d1 com xeque.'],
    ['OhWCm','8/4kp2/1p2p2Q/p5rP/5qP1/P4B2/5PK1/4R3 w - - 3 35','e1e3 g5g4 f3g4 f4h6',1333,'b','Torre em g4 e dama em h6','A torre preta em g5 e a dama em f4 atacam perto do rei branco em g2.','Após a troca em g4, a dama pode capturar a dama branca em h6.'],
  ],
  double_check: [
    ['7uDPL','3k4/p1p3r1/1p1p2n1/3P3p/5P2/1PN3rP/1PP1Q1PK/8 w - - 9 35','e2h5 g3g2 h2g2 g6f4 g2f2 f4h5',1684,'b','Cavalo dá xeque e captura dama','O cavalo preto em g6 pode alcançar f4; a dama branca está em h5 após a preparação.','Os saltos com xeque dão tempo para o cavalo tomar a dama em h5.'],
    ['Ziech','3rk1r1/p4ppp/4p3/1q2P1Q1/1p1N4/5P2/PPP2P1P/3R2K1 b - - 0 22','b5c5 g5d8 e8d8 d4e6 d8e7 e6c5',1659,'w','Cavalo em e6 recupera a dama','A dama branca está em g5, perto da torre preta de d8, e o cavalo branco ocupa d4.','Depois da troca de dama e torre em d8, o cavalo dá xeque e alcança c5.'],
  ],
  hanging_piece: [
    ['5lwg6','2r3k1/p4ppp/3p4/2qB4/2p4B/P1P2P2/6PP/4Q2K w - - 1 27','d5f7 g8f7 e1e7 f7g8 e7e6 g8h8',1442,'b','Bispo é oferecido em f7','O bispo branco está em d5 e o rei preto em g8; acompanhe a resposta à captura em f7.','Antes de capturar uma peça aparentemente solta, examine os xeques que surgem depois.'],
    ['DJiHb','5rk1/1RrP1ppp/p7/4b3/p7/5Q2/P1q3PP/3N1R1K w - - 0 27','d7d8q f8d8 b7c7 c2c7',1574,'b','Dama preta captura a torre em c7','O peão branco está prestes a promover em d8, mas a torre branca permanece em b7.','Uma promoção não encerra o cálculo: observe a torre em c7 e a dama em c2.'],
  ],
  trapped_piece: [
    ['Yvw1W','1r3rk1/1p3pbp/p1npp1p1/5q2/2PP4/1P2N1P1/PB1Q1PKP/R1R5 b - - 1 18','f5e4 f2f3 e4d4 b2d4',1356,'w','Bispo branco captura dama em d4','A dama preta parte de f5 para e4; o bispo branco em b2 controla a diagonal até d4.','Antes de mover a dama para uma casa vizinha, verifique a diagonal do bispo adversário.'],
    ['PucDY','r6r/pp1n1pk1/2p1pp2/6p1/2PP3q/1P2R2P/P2Q1P2/R3N1K1 b - - 0 28','h8h5 e1g2 h4h3 e3h3',1512,'w','Torre branca captura a dama em h3','A dama preta está em h4 e a torre branca em e3; acompanhe sua passagem para h3.','Uma dama avançada pode ser capturada quando a torre chega à mesma fileira.'],
  ],
  sacrifice: [
    ['ekct2','8/8/2pK4/1kP3pp/1B1Pb2P/2P5/8/8 w - - 0 47','h4g5 h5h4 d6e5 h4h3 e5e4 h3h2',1604,'b','Peão h corre enquanto o rei recua','O rei branco está em d6 e o peão preto em h5; conte os lances até h2.','Em final de peões, o tempo do rei e a corrida de um peão podem valer mais que uma captura imediata.'],
    ['Zowqp','3r1rk1/pp3ppp/2p4P/5p2/8/Q3R3/PPq2PP1/4R1K1 b - - 0 26','d8d1 a3f8 g8f8 e3e8',1337,'w','Dama oferecida em f8; torre dá mate','A dama branca está em a3 e a torre em e3; observe a oitava fileira preta.','A entrega da dama força a captura pelo rei e abre e8 para a torre.'],
  ],
  deflection: [
    ['7oTz1','7B/p4k1p/1p1bp1p1/8/2b1PK2/P4PP1/1P4B1/8 w - - 6 30','h8e5 g6g5 f4g5 d6e5',1463,'b','Peão avança; bispo captura em e5','O bispo branco parte de h8 para e5 e o bispo preto está em d6.','Observe como a movimentação do rei branco até g5 permite ao bispo preto capturar em e5.'],
    ['3laRt','r6k/6R1/5PK1/8/8/8/8/8 w - - 7 65','f6f7 a8a6 g6f5 h8g7',1219,'b','Torre em a6 dá xeque no rei','O rei branco está em g6, a torre preta em a8 e o rei preto em h8.','O xeque de torre ganha um tempo para o rei preto capturar a torre branca em g7.'],
  ],
  attraction: [
    ['OiyUA','r2qr1k1/2p2p2/p1np2bp/1p1N2p1/3Pn3/PB3NB1/1P3PPP/3QR1K1 b - - 1 20','e4g3 e1e8 d8e8 d5f6 g8f8 f6e8',1505,'w','Torre é trocada; cavalo captura a dama','A torre branca em e1 e a dama preta em d8 podem se encontrar na oitava fileira.','O xeque de cavalo em f6 desloca o rei e abre a captura da dama em e8.'],
    ['IVtEw','1r2k3/1p4q1/p7/2Q1P3/1P6/P6R/5PPK/3r4 b - - 2 39','g7f8 c5f8 e8f8 h3h8 f8e7 h8b8',1335,'w','Dama atrai rei; torre ganha torre','A dama branca está em c5, o rei preto em e8 e a torre preta em b8.','A troca de damas traz o rei para f8; os xeques de torre terminam com a captura em b8.'],
  ],
  interference: [
    ['8iIk8','1k1r4/2p5/p1b5/1p6/P1B2P1R/1PQ3P1/1K2R1P1/3q4 w - - 0 36','e2e1 d8d2 b2a3 d1e1',1389,'b','Torre dá xeque; dama captura em e1','A dama preta ocupa d1 e a torre preta d8; acompanhe a coluna d depois do recuo branco.','Um xeque de torre pode forçar o rei a uma casa que permite capturar outra peça.'],
    ['YXT97','4r1kr/pp4p1/4b1p1/1Q5p/8/3P4/PP3P2/1K5R b - - 3 30','g8h7 h1h5 g6h5 b5h5 h7g8 h5e8',1118,'w','Torre é entregue; dama chega a e8','A torre branca está em h1, a dama branca em b5 e o rei preto em g8.','Depois da troca em h5, a dama branca dá xeque e captura a torre em e8.'],
  ],
  x_ray_attack: [
    ['StT6m','5kr1/6p1/2r1pqQ1/pp3p2/2pP4/P1P1R3/5PPP/4R1K1 w - - 3 40','e3e6 f6g6 e6g6 c6g6',1267,'b','Dama e torre se encontram em g6','A dama branca está em g6, a torre branca em e3 e a torre preta em c6.','Depois da captura da dama, as trocas em g6 revelam a torre preta na sexta fileira.'],
    ['5dPCy','2knQ3/ppp1Nppp/3q4/8/8/8/PrP2PPP/3R2K1 b - - 6 19','c8b8 e8d8 d6d8 d1d8',1598,'w','Dama é trocada; torre entra em d8','A dama branca ocupa e8 e a torre branca d1; a coluna d está prestes a abrir.','A captura em d8 atrai a dama preta para a coluna, onde a torre branca dá mate.'],
  ],
  zugzwang: [
    ['9zl2u','8/8/5kp1/3p3p/p1pP1PKP/P1P5/1P6/8 w - - 0 40','g4f3 f6f5 f3g3 f5e4',1158,'b','Rei preto avança de f6 até e4','Os reis estão em g4 e f6; os peões limitam suas rotas de entrada.','O rei preto ganha terreno enquanto o branco precisa escolher onde recuar.'],
    ['Qxkac','8/8/2p1p1p1/p2k2Pp/Pp1P1P1P/1P2K3/8/8 b - - 1 37','c6c5 d4c5 d5c5 e3e4 c5d6 e4d4',1400,'w','Peão captura em c5; reis disputam o centro','O peão preto está em c6 e o peão branco em d4, com os reis próximos.','Após a troca em c5, compare qual rei alcança primeiro as casas centrais.'],
  ],
  advanced_pawn: [
    ['3wg6H','q5kr/1p1PQppp/p3p3/8/2P5/4P1P1/3K3P/b4B1R b - - 0 23','a1f6 e7e8 a8e8 d7e8q',1155,'w','Peão d7 promove depois da troca','O peão branco já está em d7 e a dama preta em a8; observe a casa e8.','Mesmo que uma dama seja capturada em e8, o peão avançado pode recapturar e promover com mate.'],
    ['aKuZ9','4R3/p1p2KP1/P7/2p5/1k6/8/4p1r1/8 b - - 5 45','b4c3 e8e2 g2e2 g7g8q',1654,'w','Peão branco promove em g8','O peão branco ocupa g7, a um passo da promoção, e a torre preta está em g2.','Eliminar a torre que controla a coluna abre o caminho para a nova dama.'],
  ],
  promotion: [
    ['tfFf7','3r4/7P/8/1pk5/6PR/p7/7K/8 w - - 0 50','g4g5 a3a2 h7h8q d8h8 h4h8 a2a1q',1633,'b','Duas promoções na mesma corrida','O peão branco está em h7 e o preto em a3; ambos estão perto da última fileira.','Conte não só quem promove primeiro, mas também as capturas das novas damas.'],
    ['z5w4B','5k2/p4pp1/6p1/PP6/2N5/1n3P2/8/7K b - - 0 35','f8e7 b5b6 b3a5 b6a7 a5c4 a7a8q',1183,'w','Peão a7 alcança a8','O peão branco em a5 pode avançar pela coluna a; o cavalo preto começa em b3.','O avanço de peão com tempos calculados supera as manobras do cavalo.'],
  ],
  underpromotion: [
    ['ocBkM','8/8/5p2/4kn1Q/7P/5pP1/4p1K1/8 w - - 0 60','h5f3 e2e1n g2f2 e1f3',1307,'b','Peão e2 vira cavalo com xeque','O peão preto em e2 pode promover e o rei branco está em g2; observe as casas f2 e f3.','A promoção a cavalo dá xeque e permite ao novo cavalo capturar a dama em f3.'],
    ['Oezqb','3Rr2R/6k1/p7/1p3Pb1/4p1P1/P5K1/1Pr2p2/8 w - - 12 46','d8e8 f2f1n g3h3 c2h2',1576,'b','Cavalo nasce em f1 com xeque','O peão preto está em f2 e o rei branco em g3; veja a opção de promover a cavalo.','A subpromoção com xeque muda a ordem dos lances antes do mate de torre em h2.'],
  ],
  pawn_endgame: [
    ['uPy9B','8/4k3/6p1/pp1K2P1/5P2/8/1P6/8 b - - 1 35','a5a4 d5c5 a4a3 b2a3',1326,'w','Peão b2 detém o avanço pela coluna a','O peão preto em a5 pode avançar, mas o branco em b2 está pronto para capturar.','Antes de avançar um peão passado, conte o lance da captura pelo peão vizinho.'],
    ['AqEFo','8/5kp1/5pp1/3pP1P1/p2P1K1P/P7/8/8 b - - 0 53','f6e5 f4e5 f7e7 e5d5',1206,'w','Rei branco chega a d5','O peão branco em e5 está diante dos peões pretos; o rei branco começa em f4.','Após a troca em e5, a atividade do rei permite ocupar d5.'],
  ],
  rook_endgame: [
    ['kuSjM','7R/8/P7/1P1kp3/r7/3K4/7p/8 w - - 3 49','h8h2 a4a3 d3e2 a3a2 e2f3 a2h2',1571,'b','Torre preta recupera torre em h2','A torre branca está em h8 e um peão preto em h2; observe a ação da torre preta de a4.','O xeque na terceira fileira permite à torre preta alcançar a torre branca em h2.'],
    ['KXz56','8/8/8/6P1/2K1k2P/5p2/1PR3r1/8 w - - 1 53','c2c3 f3f2 c3c1 g2g1',1266,'b','Peão f3 avança com apoio da torre','A torre preta em g2 e o peão em f3 estão ativos perto da primeira fileira.','A ameaça de promoção em f1 obriga a torre branca a vigiar a coluna.'],
  ],
  queen_endgame: [
    ['ZOlkx','6k1/p2q1p1p/2pP2p1/2P1Q3/1p3P2/7P/P5K1/8 b - - 4 35','a7a5 e5e7 d7f5 d6d7',1351,'w','Dama em e7 apoia peão d7','O peão branco está em d6 e a dama branca em e5; a dama preta defende a partir de d7.','Avançar o peão passado com apoio da dama cria uma ameaça de promoção.'],
    ['AiQwk','3Q4/7p/6p1/5p1k/1p2q2P/6P1/5P1K/8 b - - 3 41','h7h6 d8d1 e4g4 f2f3',1649,'w','Dama branca dá xeque em d1','O rei branco está em h2 e a dama preta em e4; observe os xeques à distância.','No final de damas, a iniciativa pode depender de um único xeque intermediário.'],
  ],
  knight_endgame: [
    ['OIdI9','8/1p4p1/7p/1ppk4/3pN3/3K4/PP3PPP/8 w - - 4 33','b2b3 c5c4 b3c4 b5c4 d3e2 d5e4',1208,'b','Peões em c4 trocam; rei captura cavalo','O cavalo branco está em e4 e o rei preto em d5; observe a troca de peões na coluna c.','Depois das capturas em c4, o rei preto pode alcançar o cavalo em e4.'],
    ['6IFqL','8/8/6p1/nk1KP1p1/1p6/1P6/8/4N3 b - - 0 53','a5b3 e5e6 b5b6 e6e7',1067,'w','Peão branco avança até e7','O cavalo preto está em a5 e o peão branco em e5, próximo da promoção.','A corrida do peão obriga o defensor a avaliar cada tempo gasto com o cavalo.'],
  ],
  bishop_endgame: [
    ['adKXK','8/5k1p/6p1/p2K2P1/Pb1B1P2/8/8/8 b - - 4 41','f7e7 d4c5 b4c5 d5c5',1497,'w','Bispos trocam em c5; rei recaptura','O bispo branco está em d4 e o preto em b4, ambos próximos da casa c5.','Trocar os bispos em c5 permite ao rei branco recapturar e permanecer ativo.'],
    ['dZHaT','8/6B1/8/1K6/1p6/pk6/8/8 w - - 0 42','b5a5 a3a2 a5b5 b3a3 b5c4 b4b3',1376,'b','Peão preto alcança b3','O bispo branco está em g7 e o peão preto em a3; observe a rota dos reis.','Peões distantes da casa de controle do bispo exigem um rei bem colocado.'],
  ],
};

/** Dois exemplos autossuficientes por tema, com comentários gerados da posição legal. */
export const LESSON_EXAMPLES: Record<LessonThemeId, LessonExample[]> = Object.fromEntries(
  (Object.entries(sources) as [LessonThemeId, Source[]][]).map(([theme, rows]) => [
    theme,
    rows.map(([puzzleId, fen, uci, rating, playerColor, title, intro, outro]) => {
      const moves = uci.split(' ');
      const item: LessonExample = {
        theme, puzzleId, fen, moves, rating, playerColor,
        title,
        intro,
        comments: [],
        outro,
      };
      item.comments = describeExample(item);
      return item;
    }),
  ]),
) as Record<LessonThemeId, LessonExample[]>;