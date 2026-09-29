/** Contratos e conteúdo fixo da Sala de Lições; todos os textos visíveis são pt-BR. */
import { puzzleThemeLabel, type PuzzleSeat } from './PuzzleShapes.js';

/** Identificador estável das cinco categorias. */
export type LessonCategoryId = 'mates' | 'fundamentals' | 'advanced' | 'pawns' | 'endgames';
/** Identificador estável de cada tema da lição. */
export type LessonThemeId = 'mate_in_1' | 'mate_in_2' | 'mate_in_3' | 'back_rank_mate' | 'smothered_mate' | 'fork' | 'pin' | 'skewer' | 'discovered_attack' | 'double_check' | 'hanging_piece' | 'trapped_piece' | 'sacrifice' | 'deflection' | 'attraction' | 'interference' | 'x_ray_attack' | 'zugzwang' | 'advanced_pawn' | 'promotion' | 'underpromotion' | 'pawn_endgame' | 'rook_endgame' | 'queen_endgame' | 'knight_endgame' | 'bishop_endgame';
/** Categorias na ordem das carteiras físicas da sala. */
export const LESSON_CATEGORIES: { id: LessonCategoryId; label: string; deskIndex: number; themes: LessonThemeId[] }[] = [
  { id: 'mates', label: 'Mates', deskIndex: 1, themes: ['mate_in_1', 'mate_in_2', 'mate_in_3', 'back_rank_mate', 'smothered_mate'] },
  { id: 'fundamentals', label: 'Táticas fundamentais', deskIndex: 2, themes: ['fork', 'pin', 'skewer', 'discovered_attack', 'double_check', 'hanging_piece', 'trapped_piece'] },
  { id: 'advanced', label: 'Táticas avançadas', deskIndex: 3, themes: ['sacrifice', 'deflection', 'attraction', 'interference', 'x_ray_attack', 'zugzwang'] },
  { id: 'pawns', label: 'Peões e promoção', deskIndex: 4, themes: ['advanced_pawn', 'promotion', 'underpromotion'] },
  { id: 'endgames', label: 'Finais', deskIndex: 5, themes: ['pawn_endgame', 'rook_endgame', 'queen_endgame', 'knight_endgame', 'bishop_endgame'] },
];

/** Definições, rótulos e chave de busca Lichess dos temas. */
export const LESSON_THEMES: Record<LessonThemeId, { id: LessonThemeId; label: string; category: LessonCategoryId; lichessThemes: string[]; explanation: string }> = {
  mate_in_1: { id: 'mate_in_1', label: 'Mate em 1', category: 'mates', lichessThemes: ['mateIn1'], explanation: 'Há um lance que dá xeque e encerra a partida imediatamente. Reconheça o padrão quando todas as casas de fuga do rei já estão controladas. Confira se ele pode capturar a peça atacante ou bloquear o xeque. Um xeque de dama apoiada ou de torre na última fileira costuma decidir.' },
  mate_in_2: { id: 'mate_in_2', label: 'Mate em 2', category: 'mates', lichessThemes: ['mateIn2'], explanation: 'O primeiro lance força uma resposta, e o segundo dá mate. Reconheça o motivo quando o rei tem poucas casas de fuga e uma ameaça força a última defesa. Calcule as respostas do adversário antes de iniciar a combinação. Um xeque de cavalo que conduz o rei até a dama é um padrão possível.' },
  mate_in_3: { id: 'mate_in_3', label: 'Mate em 3', category: 'mates', lichessThemes: ['mateIn3'], explanation: 'Uma sequência forçada termina em mate no terceiro lance do atacante. Reconheça a oportunidade quando os xeques disponíveis empurram o rei para casas cada vez piores. Considere cada resposta legal do defensor, não apenas a mais natural. A invasão de uma torre ou dama na última fileira pode concluir a sequência.' },
  back_rank_mate: { id: 'back_rank_mate', label: 'Mate do Corredor', category: 'mates', lichessThemes: ['backRankMate'], explanation: 'O rei fica preso na última fileira, geralmente atrás dos próprios peões. Reconheça o corredor quando nenhum peão criou uma casa de fuga para ele. Uma torre ou dama invade essa fileira e dá xeque. Sem bloqueio ou captura possível, o xeque é mate.' },
  smothered_mate: { id: 'smothered_mate', label: 'Mate Sufocado', category: 'mates', lichessThemes: ['smotheredMate'], explanation: 'O próprio exército do rei ocupa suas casas de fuga. Reconheça a oportunidade quando o rei está cercado por suas peças perto do canto. Um cavalo dá xeque sem poder ser bloqueado. A atração de uma torre à casa vizinha do rei pode completar o cerco e permitir o mate.' },
  fork: { id: 'fork', label: 'Garfo', category: 'fundamentals', lichessThemes: ['fork'], explanation: 'Um lance cria ameaças simultâneas contra duas ou mais peças. Reconheça o garfo ao encontrar uma casa de onde sua peça ataca dois alvos. Como o adversário normalmente só pode salvar um, o outro fica vulnerável. O garfo de cavalo entre rei e dama costuma ganhar material.' },
  pin: { id: 'pin', label: 'Cravada', category: 'fundamentals', lichessThemes: ['pin'], explanation: 'Uma peça está alinhada entre um atacante de longo alcance e um alvo valioso. Reconheça a cravada procurando três peças na mesma coluna, fileira ou diagonal. Se o alvo atrás for o rei, a peça cravada não pode sair da linha. Se for a dama, avançar contra a peça cravada pode ganhar material.' },
  skewer: { id: 'skewer', label: 'Espeto', category: 'fundamentals', lichessThemes: ['skewer'], explanation: 'Uma peça de maior valor é atacada na frente de outra, na mesma linha. Reconheça o espeto quando um rei ou uma dama bloqueia o caminho para outra peça. Ao fugir, ela deixa exposta a peça atrás. Um bispo que dá xeque e depois captura a dama é um padrão típico.' },
  discovered_attack: { id: 'discovered_attack', label: 'Ataque Descoberto', category: 'fundamentals', lichessThemes: ['discoveredAttack'], explanation: 'Uma peça sai da frente de um bispo, torre ou dama e libera sua linha de ataque. Reconheça o motivo procurando duas peças suas alinhadas com um alvo adversário. A peça que sai também pode criar uma ameaça independente. Se a linha liberada der xeque, o tempo ganho pode permitir capturar material.' },
  double_check: { id: 'double_check', label: 'Xeque Duplo', category: 'fundamentals', lichessThemes: ['doubleCheck'], explanation: 'Duas peças dão xeque ao mesmo tempo, geralmente após um ataque descoberto. Reconheça a possibilidade quando uma peça sua bloqueia a linha de outra contra o rei. Capturar ou bloquear apenas uma das ameaças não resolve a outra. O rei precisa se mover, podendo acabar em uma casa de mate.' },
  hanging_piece: { id: 'hanging_piece', label: 'Peça Pendurada', category: 'fundamentals', lichessThemes: ['hangingPiece'], explanation: 'Uma peça atacada está sem defesa suficiente. Reconheça a oportunidade comparando atacantes e defensores de cada alvo. Antes de capturá-la, verifique possíveis xeques intermediários. Uma peça sem defensor pode ser capturada com ganho direto de material.' },
  trapped_piece: { id: 'trapped_piece', label: 'Peça Presa', category: 'fundamentals', lichessThemes: ['trappedPiece'], explanation: 'Uma peça sob ataque não dispõe de casa segura para escapar. Reconheça a armadilha examinando todas as casas para onde a peça pode fugir. Restringir suas saídas pode ser mais forte que atacá-la diretamente. Quando uma dama não encontra casa segura, uma peça menor pode capturá-la.' },
  sacrifice: { id: 'sacrifice', label: 'Sacrifício', category: 'advanced', lichessThemes: ['sacrifice'], explanation: 'Entrega-se material de propósito para obter um ganho concreto. Reconheça a possibilidade quando a captura forçada abre linhas contra o rei. O retorno pode ser mate, recuperação de material ou uma posição decisiva. Uma dama oferecida para desviar o rei e permitir mate de torre é um padrão frequente.' },
  deflection: { id: 'deflection', label: 'Desvio', category: 'advanced', lichessThemes: ['deflection'], explanation: 'Uma peça defensora é forçada a abandonar uma casa ou função importante. Reconheça o desvio identificando o único defensor de uma casa crítica. Depois que ele sai, o alvo antes protegido fica vulnerável. Um xeque que obriga o rei a deixar a defesa de uma torre pode ganhar material.' },
  attraction: { id: 'attraction', label: 'Atração', category: 'advanced', lichessThemes: ['attraction'], explanation: 'Um lance obriga uma peça adversária a ocupar uma casa desfavorável. Reconheça a atração quando a captura aparentemente obrigatória leva o rei ou a dama para uma casa atacável. Essa casa pode permitir um garfo, um ataque descoberto ou mate. Oferecer a dama com xeque para atrair o rei e liberar uma torre é um padrão possível.' },
  interference: { id: 'interference', label: 'Interferência', category: 'advanced', lichessThemes: ['interference'], explanation: 'Uma peça se interpõe na linha entre um defensor e aquilo que ele protegia. Reconheça o motivo ao observar duas peças adversárias que só se defendem por uma linha aberta. O bloqueio interrompe essa comunicação. Uma peça na casa intermediária pode permitir capturar a dama ou dar mate.' },
  x_ray_attack: { id: 'x_ray_attack', label: 'Ataque em Raio-X', category: 'advanced', lichessThemes: ['xRayAttack'], explanation: 'Uma peça de longo alcance influencia um alvo através de outra peça no caminho. Reconheça o raio-X procurando torres, bispos ou damas alinhados com um alvo além de uma peça intermediária. Quando o obstáculo sai, a ameaça aparece imediatamente. Uma série de trocas na mesma coluna pode permitir à torre de trás capturar a última peça.' },
  zugzwang: { id: 'zugzwang', label: 'Zugzwang', category: 'advanced', lichessThemes: ['zugzwang'], explanation: 'O lado a jogar piora sua posição em qualquer lance legal. Reconheça o zugzwang comparando o resultado se fosse a vez do outro lado. Isso é frequente em finais com poucas peças. Na oposição de reis, obrigar o rival a ceder uma casa pode permitir a entrada do seu rei.' },
  advanced_pawn: { id: 'advanced_pawn', label: 'Peão Avançado', category: 'pawns', lichessThemes: ['advancedPawn'], explanation: 'Um peão próximo à última fileira ameaça promover. Reconheça o perigo ao contar quantos lances faltam para esse peão chegar ao fim. O adversário pode precisar dedicar uma peça para pará-lo. Um peão passado na sétima fileira pode promover após uma troca na casa de chegada.' },
  promotion: { id: 'promotion', label: 'Promoção', category: 'pawns', lichessThemes: ['promotion'], explanation: 'Ao chegar à última fileira, um peão se transforma em dama, torre, bispo ou cavalo. Reconheça a chance contando a corrida até a oitava ou primeira fileira. Promover a dama costuma ser mais forte, mas exige verificar afogamento e ameaças imediatas. Duas promoções consecutivas podem transformar um final de peões em final de damas.' },
  underpromotion: { id: 'underpromotion', label: 'Subpromoção', category: 'pawns', lichessThemes: ['underPromotion'], explanation: 'Às vezes promover a dama é inferior a escolher torre, bispo ou cavalo. Reconheça a oportunidade quando o salto imediato do cavalo daria xeque. Um cavalo pode criar um garfo que a dama não conseguiria. Uma torre também pode evitar o afogamento e manter chances de vitória.' },
  pawn_endgame: { id: 'pawn_endgame', label: 'Final de Peões', category: 'endgames', lichessThemes: ['pawnEndgame'], explanation: 'Reis ativos e peões passados decidem muitos finais de peões. Reconheça a oposição quando os reis se encaram e o lado a jogar deve ceder terreno. Conte os tempos de cada corrida até a promoção. Criar um peão passado distante costuma obrigar o rei adversário a abandonar a defesa de outros peões.' },
  rook_endgame: { id: 'rook_endgame', label: 'Final de Torres', category: 'endgames', lichessThemes: ['rookEndgame'], explanation: 'Torres ativas devem atacar peões e restringir o rei. Reconheça a melhor casa da torre contando quantas colunas abertas ela controla. Colocar a torre atrás de um peão passado costuma aumentar sua eficácia. Xeques laterais podem ganhar tempo para a torre capturar um peão ou uma torre desprotegida.' },
  queen_endgame: { id: 'queen_endgame', label: 'Final de Damas', category: 'endgames', lichessThemes: ['queenEndgame'], explanation: 'Damas dão xeques de longe e podem criar ameaças perpétuas. Reconheça o perigo quando o rei não tem abrigo contra xeques laterais. A segurança do rei importa tanto quanto a vantagem de peões. Apoiar um peão passado com a dama pode decidir se o rival não dispõe de xeque perpétuo.' },
  knight_endgame: { id: 'knight_endgame', label: 'Final de Cavalos', category: 'endgames', lichessThemes: ['knightEndgame'], explanation: 'O cavalo precisa de casas de apoio para atacar peões. Reconheça um posto forte em uma casa central protegida por peão. Sua habilidade de dar garfos pode mudar rapidamente a avaliação do final. Um rei ativo pode atacar o cavalo inimigo enquanto seu peão passado avança.' },
  bishop_endgame: { id: 'bishop_endgame', label: 'Final de Bispos', category: 'endgames', lichessThemes: ['bishopEndgame'], explanation: 'Bispos controlam casas de uma só cor e atuam à distância. Reconheça a força do bispo nas diagonais abertas e a limitação dos peões fixados em casas de sua cor. Trocar bispos pode dar ao rei acesso a peões adversários. Em finais de bispos de cores opostas, uma vantagem material nem sempre basta para vencer.' },
};

/** Temas na ordem pedagógica da sala. */
export function lessonThemeIds(): LessonThemeId[] { return LESSON_CATEGORIES.flatMap((c) => c.themes); }
/** Valida um tema recebido pela rede. */
export function isLessonThemeId(v: unknown): v is LessonThemeId { return typeof v === 'string' && Object.prototype.hasOwnProperty.call(LESSON_THEMES, v); }
/** Categoria à qual pertence o tema. */
export function lessonCategoryOf(theme: LessonThemeId): LessonCategoryId { return LESSON_THEMES[theme].category; }
/** Identificador da carteira da categoria. */
export function lessonDeskBoardId(category: LessonCategoryId): string { return `academy_lesson_${LESSON_CATEGORIES.find((c) => c.id === category)?.deskIndex}`; }

/** Faixas disponíveis na prática. */
export type LessonDifficultyId = 'iniciante' | 'intermediario' | 'avancado' | 'expert';
/** Limites inclusivos de rating da prática. */
export const LESSON_DIFFICULTIES: Record<LessonDifficultyId, { label: string; min: number; max: number }> = {
  iniciante: { label: 'Iniciante', min: 600, max: 1100 }, intermediario: { label: 'Intermediário', min: 1100, max: 1600 },
  avancado: { label: 'Avançado', min: 1600, max: 2100 }, expert: { label: 'Expert', min: 2100, max: 2600 },
};
/** Valida a faixa da prática. */
export function isLessonDifficultyId(v: unknown): v is LessonDifficultyId { return typeof v === 'string' && Object.prototype.hasOwnProperty.call(LESSON_DIFFICULTIES, v); }
/** Quantidade de posições por tentativa. */
export const LESSON_PRACTICE_SIZE = 10;
/** Acertos necessários para concluir um tema. */
export const LESSON_PASS_SCORE = 8;
/** Histórico recente excluído de novos sorteios, quando há alternativas. */
export const LESSON_HISTORY_WINDOW = 300;

/** Organização das opções de temas dos problemas, com rótulos pt-BR. */
export const PROBLEM_THEME_GROUPS: { id: string; label: string; themes: string[] }[] = [
  { id: 'mixed', label: 'Misto', themes: ['mixed'] },
  { id: 'phase', label: 'Fase da partida', themes: ['opening','middlegame','endgame','rookEndgame','bishopEndgame','pawnEndgame','knightEndgame','queenEndgame','queenRookEndgame'] },
  { id: 'tactics', label: 'Motivos táticos', themes: ['fork','pin','skewer','discoveredAttack','doubleCheck','hangingPiece','capturingDefender','trappedPiece','exposedKing','sacrifice','attackingF2F7','kingsideAttack','queensideAttack'] },
  { id: 'advanced', label: 'Avançados', themes: ['attraction','deflection','interference','clearance','intermezzo','quietMove','defensiveMove','xRayAttack','zugzwang'] },
  { id: 'mates', label: 'Mates', themes: ['mate','mateIn1','mateIn2','mateIn3','mateIn4','mateIn5','backRankMate','smotheredMate','anastasiaMate','arabianMate','bodenMate','doubleBishopMate','dovetailMate','hookMate','killBoxMate','vukovicMate'] },
  { id: 'special', label: 'Especiais', themes: ['castling','enPassant','promotion','underPromotion'] },
  { id: 'origin', label: 'Origem', themes: ['master','masterVsMaster','superGM'] },
];
/** Rótulo localizado de uma opção de tema; nunca apresente chaves cruas ao usuário. */
export function problemThemeLabel(theme: string): string { return theme === 'mixed' ? 'Misto' : puzzleThemeLabel(theme); }
/** Famílias de abertura disponíveis no banco de problemas. */
export const OPENING_FAMILIES = [
  ['Sicilian_Defense', 'Defesa Siciliana'], ['French_Defense', 'Defesa Francesa'], ['Italian_Game', 'Abertura Italiana'],
  ['Caro-Kann_Defense', 'Defesa Caro-Kann'], ['Queens_Pawn_Game', 'Peão da Dama'], ['Scandinavian_Defense', 'Defesa Escandinava'],
  ['Queens_Gambit_Declined', 'Gambito da Dama Recusado'], ['English_Opening', 'Abertura Inglesa'], ['Ruy_Lopez', 'Ruy López (Espanhola)'],
  ['Scotch_Game', 'Abertura Escocesa'], ['Indian_Defense', 'Defesa Índia'], ['Pirc_Defense', 'Defesa Pirc'],
  ['Petrovs_Defense', 'Defesa Petrov'], ['Vienna_Game', 'Abertura Vienense'], ['Philidor_Defense', 'Defesa Philidor'],
  ['Kings_Gambit_Accepted', 'Gambito do Rei Aceito'], ['Zukertort_Opening', 'Abertura Zukertort'], ['Bishops_Opening', 'Abertura do Bispo'],
  ['Kings_Pawn_Game', 'Peão do Rei'], ['Englund_Gambit', 'Gambito Englund'], ['Four_Knights_Game', 'Quatro Cavalos'],
  ['Slav_Defense', 'Defesa Eslava'], ['Modern_Defense', 'Defesa Moderna'], ['Nimzowitsch_Defense', 'Defesa Nimzowitsch'],
  ['Bird_Opening', 'Abertura Bird'], ['Nimzo-Larsen_Attack', 'Ataque Nimzo-Larsen'], ['Benoni_Defense', 'Defesa Benoni'],
  ['Queens_Gambit_Accepted', 'Gambito da Dama Aceito'], ['Alekhine_Defense', 'Defesa Alekhine'], ['Kings_Gambit_Declined', 'Gambito do Rei Recusado'],
  ['Dutch_Defense', 'Defesa Holandesa'], ['Owen_Defense', 'Defesa Owen'], ['Kings_Indian_Defense', 'Defesa Índia do Rei'],
  ['Horwitz_Defense', 'Defesa Horwitz'], ['Center_Game', 'Abertura do Centro'], ['Rapport-Jobava_System', 'Sistema Rapport-Jobava'],
  ['Nimzo-Indian_Defense', 'Defesa Nimzo-Índia'], ['Semi-Slav_Defense', 'Defesa Semi-Eslava'], ['Elephant_Gambit', 'Gambito do Elefante'],
  ['Blackmar-Diemer_Gambit', 'Gambito Blackmar-Diemer'], ['Ponziani_Opening', 'Abertura Ponziani'], ['Hungarian_Opening', 'Abertura Húngara'],
  ['Rat_Defense', 'Defesa do Rato'], ['Russian_Game', 'Partida Russa'], ['Three_Knights_Opening', 'Três Cavalos'],
  ['London_System', 'Sistema Londres'],
] as const;
/** Faixa de rating dos problemas. */
export type ProblemDifficultyId = 'any' | 'beginner' | 'easy' | 'intermediate' | 'advanced' | 'expert' | 'master';
/** Limites inclusivos das faixas dos problemas; 0 e 4000 representam limites abertos. */
export const PROBLEM_DIFFICULTIES: Record<ProblemDifficultyId, { label: string; min: number; max: number }> = {
  any: { label: 'Qualquer', min: 0, max: 4000 }, beginner: { label: 'Iniciante (<1000)', min: 0, max: 999 },
  easy: { label: 'Fácil (1000–1399)', min: 1000, max: 1399 }, intermediate: { label: 'Intermediário (1400–1799)', min: 1400, max: 1799 },
  advanced: { label: 'Avançado (1800–2199)', min: 1800, max: 2199 }, expert: { label: 'Expert (2200–2599)', min: 2200, max: 2599 },
  master: { label: 'Mestre (2600+)', min: 2600, max: 4000 },
};
/** Filtro de extensão (chaves Lichess). */
export type ProblemLengthId = 'any' | 'oneMove' | 'short' | 'long' | 'veryLong';
/** Rótulos de extensão. */
export const PROBLEM_LENGTHS: Record<ProblemLengthId, string> = { any: 'Qualquer', oneMove: 'Um lance', short: 'Curto', long: 'Longo', veryLong: 'Muito longo' };
/** Filtro de fase (chaves Lichess). */
export type ProblemPhaseId = 'any' | 'opening' | 'middlegame' | 'endgame';
/** Rótulos de fase. */
export const PROBLEM_PHASES: Record<ProblemPhaseId, string> = { any: 'Qualquer', opening: 'Abertura', middlegame: 'Meio-jogo', endgame: 'Final' };
/** Seleção de filtros de um treino livre. */
export interface ProblemFilters { theme: string | 'mixed'; difficulty: ProblemDifficultyId; length: ProblemLengthId; phase: ProblemPhaseId; opening?: string; showTheme?: boolean }
/** Seleção inicial sem restrições. */
export const DEFAULT_PROBLEM_FILTERS: ProblemFilters = { theme: 'mixed', difficulty: 'any', length: 'any', phase: 'any', showTheme: true };
/** Valida todos os campos de filtros recebidos pela rede. */
export function isProblemFilters(v: unknown): v is ProblemFilters {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const f = v as Record<string, unknown>;
  return Object.keys(f).every((key) => ['theme', 'difficulty', 'length', 'phase', 'opening', 'showTheme'].includes(key))
    && typeof f.theme === 'string' && PROBLEM_THEME_GROUPS.some((g) => g.themes.includes(f.theme as string))
    && typeof f.difficulty === 'string' && Object.prototype.hasOwnProperty.call(PROBLEM_DIFFICULTIES, f.difficulty)
    && typeof f.length === 'string' && Object.prototype.hasOwnProperty.call(PROBLEM_LENGTHS, f.length)
    && typeof f.phase === 'string' && Object.prototype.hasOwnProperty.call(PROBLEM_PHASES, f.phase)
    && (f.showTheme === undefined || typeof f.showTheme === 'boolean')
    && (f.opening === undefined || f.opening === '' || (typeof f.opening === 'string' && OPENING_FAMILIES.some(([tag]) => tag === f.opening)));
}
/** Chaves que devem estar simultaneamente no array `themes` do banco. */
export function problemFilterThemes(filters: ProblemFilters): string[] { return [...new Set([filters.theme, filters.length, filters.phase].filter((v) => v !== 'mixed' && v !== 'any'))]; }
/** Converte uma tag de abertura do banco em texto legível. */
export function openingTagLabel(tag: string): string { return tag.replace(/_/g, ' '); }

/**
 * Fluxo: a prática sorteia 10 posições, uma por vez e sem vidas. O PRIMEIRO
 * erro encerra a posição (conta como erro); o feedback traz `solutionMoves`
 * apenas após esse erro, para replay. O cliente envia `LESSON_MSG.next` para
 * prosseguir. Após 10 posições, o servidor envia `sessionEnd` e novo `state`;
 * 8 acertos concluem o tema. Problemas usam o mesmo fluxo sem limite de
 * posições; `stop` ou `leave` encerra a sessão.
 */
export const LESSON_MSG = {
  open: 'academy_lesson_open', state: 'academy_lesson_state', sit: 'academy_lesson_sit',
  seated: 'academy_lesson_seated', leave: 'academy_lesson_leave', practiceStart: 'academy_lesson_practice_start',
  problemStart: 'academy_lesson_problem_start', next: 'academy_lesson_next', stop: 'academy_lesson_stop',
  sessionEnd: 'academy_lesson_session_end',
} as const;
/** Pedido para ocupar uma carteira. */
export interface LessonSitPayload { boardId: string }
/** Confirmação de cadeira reservada. */
export interface LessonSeatedPayload { boardId: string; seat: PuzzleSeat }
/** Inicia uma tentativa da lição. */
export interface LessonPracticeStartPayload { boardId: string; theme: LessonThemeId; difficulty: LessonDifficultyId }
/** Inicia um treino livre. */
export interface LessonProblemStartPayload { boardId: string; filters: ProblemFilters }
/** Solicita a próxima posição após feedback final. */
export interface LessonNextPayload { boardId: string }
/** Resumo da sessão encerrada. */
export interface LessonSessionEndPayload { kind: 'lesson' | 'problem'; theme?: LessonThemeId; solved: number; attempted: number; total?: number; completed?: boolean; newlyCompleted?: boolean; reason: 'finished' | 'stopped' | 'left' }
/** Desempenho em um tema. */
export interface LessonThemeStat { theme: string; label: string; attempted: number; solvedFirstTry: number; accuracy: number }
/** Estatísticas agregadas de lições e problemas. */
export interface LessonStatsPayload { lessonsCompleted: number; lessonsTotal: number; attempted: number; solvedFirstTry: number; accuracy: number; byTheme: LessonThemeStat[]; strongest: LessonThemeStat[]; needsPractice: LessonThemeStat[] }
/** Melhor tentativa registrada em um tema. */
export interface LessonProgressEntry { theme: LessonThemeId; bestScore: number; attempts: number; completed: boolean; completedAt?: string }
/** Estado enviado ao abrir a sala ou concluir uma sessão. */
export interface LessonStatePayload { schemaMissing?: boolean; progress: LessonProgressEntry[]; stats: LessonStatsPayload }
/** Agrega histórico sem efeitos colaterais; precisão de 0 a 1. */
export function computeLessonStats(rows: { theme: string | null; solved: boolean; firstTry: boolean }[], progress: LessonProgressEntry[]): LessonStatsPayload {
  const byKey = new Map<string, LessonThemeStat>();
  let solvedFirstTry = 0;
  for (const row of rows) {
    if (row.solved && row.firstTry) solvedFirstTry++;
    if (!row.theme) continue;
    const key = row.theme;
    let stat = byKey.get(key);
    if (!stat) {
      stat = { theme: key, label: isLessonThemeId(key) ? LESSON_THEMES[key].label : puzzleThemeLabel(key), attempted: 0, solvedFirstTry: 0, accuracy: 0 };
      byKey.set(key, stat);
    }
    stat.attempted++;
    if (row.solved && row.firstTry) stat.solvedFirstTry++;
    stat.accuracy = stat.solvedFirstTry / stat.attempted;
  }
  const byTheme = [...byKey.values()].sort((a, b) => b.attempted - a.attempted || a.label.localeCompare(b.label));
  const eligible = byTheme.filter((s) => s.attempted >= 5);
  return {
    lessonsCompleted: progress.filter((p) => p.completed).length, lessonsTotal: lessonThemeIds().length,
    attempted: rows.length, solvedFirstTry, accuracy: rows.length ? solvedFirstTry / rows.length : 0,
    byTheme, strongest: [...eligible].sort((a, b) => b.accuracy - a.accuracy || b.attempted - a.attempted).slice(0, 3),
    needsPractice: [...eligible].sort((a, b) => a.accuracy - b.accuracy || b.attempted - a.attempted).slice(0, 3),
  };
}