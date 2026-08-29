/**
 * Configuração do Mundo de Coleta (Crafting World).
 *
 * O mapa é servido já com tilesets embutidos pelo plugin vite `crafting-map`
 * (o Phaser não lê .tsx externos do Tiled).
 */

export const CRAFTING_MAP = {
  key: 'crafting-world',
  path: '/assets/CraftingWorld/map/crafting-world.embedded.tmj',
  tileSize: 32,
  /** Camada de pontos onde o jogador pode aparecer ao entrar no mundo. */
  spawnLayer: 'character_spawn',
  /** Sentinela usada no fluxo de troca de mapa (não existe camada 'spawns' aqui). */
  spawnId: 'craft_start',
} as const;

/** Prefixo de região para as salas do mundo de coleta (isola do mapa principal). */
export const CRAFT_REGION_PREFIX = 'craft:';

export const RESOURCES_BASE = '/assets/CraftingWorld/resources/';

/** Árvores: spritesheet 9 frames (0 = em pé, 8 = toco); animação = queda. */
export const TREE_SHEET = { frameWidth: 357, frameHeight: 270, frames: 9 } as const;
export const TREE_TYPES = [
  'pinheiro_peao',
  'carvalho_torre',
  'freixo_cavalo',
  'ebano_dama',
  'salgueiro_bispo',
] as const;
export type TreeType = (typeof TREE_TYPES)[number];

export const treeTextureKey = (t: TreeType) => `craft-tree-${t}`;
export const treeSheetUrl = (t: TreeType) => `${RESOURCES_BASE}Arvores/${t}.png`;
export const treeFallAnimKey = (t: TreeType) => `craft-tree-fall-${t}`;

/** Minerais: spritesheet 10 frames de 128x128 (0 = nó intacto). */
export const MINERAL_SHEET = { frameWidth: 128, frameHeight: 128, frames: 10 } as const;

export interface MineralDef {
  id: string;
  /** Nome do arquivo dentro de resources/minerals/ */
  file: string;
  /** Quantidade colocada no mapa (placeholder até existir o painel admin). */
  defaultCount: number;
}

/**
 * Quantidades padrão por mineral — serão configuráveis num painel admin
 * (pedido do usuário: "mais pra frente a gente vai criar esse painel").
 * A soma deve caber nos insert points de minerals_spawns (124 no mapa atual).
 */
export const MINERALS: MineralDef[] = [
  { id: 'pedra', file: 'Stone.png', defaultCount: 30 },
  { id: 'carvao', file: 'Coal.png', defaultCount: 25 },
  { id: 'ferro', file: 'Iron.png', defaultCount: 20 },
  { id: 'cobre', file: 'Copper.png', defaultCount: 18 },
  { id: 'ouro', file: 'Gold.png', defaultCount: 12 },
  { id: 'diamante', file: 'Diamond.png', defaultCount: 8 },
  { id: 'cristal_real', file: 'Cristal Real.png', defaultCount: 6 },
];

export const mineralTextureKey = (id: string) => `craft-mineral-${id}`;

/** Pedra coletável com a mão: fixa nos pontos de fallen_simple_stones (10 frames de 32x32). */
export const HAND_STONE = {
  textureKey: 'craft-hand-stone',
  url: `${RESOURCES_BASE}minerals/stone-hand-collected.png`,
  frameWidth: 32,
  frameHeight: 32,
} as const;

/** Arbusto comum: imagem única nos pontos de simple_bush. */
export const BUSH = {
  textureKey: 'craft-bush',
  url: `${RESOURCES_BASE}ervas e plantas/bush.png`,
} as const;

/** Ervas e plantas: imagem única nos insert points da object layer homônima. */
export interface HerbDef {
  id: string;
  /** Nome da object layer no TMJ (igual ao `type` dos insert points). */
  layer: string;
  /** Arquivo dentro de resources/ervas e plantas/ */
  file: string;
}

export const HERBS: HerbDef[] = [
  { id: 'heal_herb', layer: 'heal_herb', file: 'heal_herb.png' },
  { id: 'red_herb', layer: 'red_herb', file: 'red_herb.png' },
  { id: 'blue_herb', layer: 'blue_herb', file: 'blue_herb.png' },
  { id: 'queen_thorn', layer: 'queen_thorn', file: 'queen_thorn.png' },
  { id: 'horse_root', layer: 'horse_root', file: 'horse_root.png' },
];

export const herbTextureKey = (id: string) => `craft-herb-${id}`;
export const herbUrl = (file: string) => `${RESOURCES_BASE}ervas e plantas/${file}`;

/**
 * Animais: sheets 7×4 de frames quadrados — 7 frames por linha, e as linhas
 * são as direções na ordem do pack: 0=sul, 1=leste, 2=oeste, 3=norte.
 * O sheet "eating" é o visual inicial; walking.png anima o passeio.
 * (dying.png existe nas pastas, mas a morte será especificada depois.)
 */
export const ANIMAL_SHEET = { columns: 7, rows: 4, frames: 7, eatFrameRate: 6, walkFrameRate: 8 } as const;
export const ANIMAL_DIRECTIONS = ['south', 'east', 'west', 'north'] as const;
export type AnimalDirection = (typeof ANIMAL_DIRECTIONS)[number];

export interface AnimalDef {
  id: string;
  /** Nome da camada de pontos (insert points) no TMJ. */
  layer: string;
  /** Sheet "comendo" dentro de resources/animais/ */
  file: string;
  /** Sheet de caminhada dentro de resources/animais/ */
  walkFile: string;
  /** Lado do frame quadrado nos sheets. */
  frameSize: number;
  /** Velocidade do passeio (px/s). */
  speed: number;
}

export const ANIMALS: AnimalDef[] = [
  { id: 'cow', layer: 'cows', file: 'cow/coweating.png', walkFile: 'cow/walking.png', frameSize: 140, speed: 22 },
  { id: 'sheep', layer: 'sheeps', file: 'sheep/sheepeating.png', walkFile: 'sheep/walking.png', frameSize: 116, speed: 24 },
  { id: 'chicken', layer: 'chickens', file: 'chicken/chickeneating.png', walkFile: 'chicken/walking.png', frameSize: 44, speed: 28 },
];

/** Passeio: raio máximo em torno do ponto de spawn e duração das pausas comendo. */
export const ANIMAL_WANDER = { radius: 72, eatMinMs: 2500, eatMaxMs: 7000 } as const;

export const animalTextureKey = (id: string) => `craft-animal-${id}`;
export const animalWalkTextureKey = (id: string) => `craft-animal-walk-${id}`;
export const animalAnimKey = (id: string, action: 'eat' | 'walk', dir: AnimalDirection) =>
  `craft-animal-${action}-${dir}-${id}`;

/** Fase de teste: golpes de ferramenta para quebrar/coletar qualquer recurso. */
export const RESOURCE_HITS_TO_BREAK = 3;

/** Drops: mini-itens que pulam do nó quebrado e são atraídos pelo jogador (imã). */
export const RESOURCE_DROP = {
  /** Itens por nó quebrado. */
  count: 3,
  /** Raio do espalhamento inicial (px). */
  scatterRadius: 26,
  /** Distância em que o imã começa a puxar (px). */
  magnetRadius: 56,
  /** Distância de coleta (px). */
  collectRadius: 14,
  /** Velocidade do puxão (px/s). */
  magnetSpeed: 220,
  /** Duração do pulo inicial (ms). */
  popMs: 260,
} as const;

/** Animação de quebra dos minerais (frames 0..9 do próprio sheet). */
export const mineralBreakAnimKey = (id: string) => `craft-mineral-break-${id}`;

/** minerals/drop/drop-<arquivo minúsculo com hífens>.png (32×32). */
export const mineralDropTextureKey = (id: string) => `craft-drop-mineral-${id}`;
export const mineralDropUrl = (file: string) =>
  `${RESOURCES_BASE}minerals/drop/drop-${file.replace(/\.png$/i, '').toLowerCase().replace(/\s+/g, '-')}.png`;

/** tronco/drop-<tipo com hífens>.png (64×64). */
export const treeDropTextureKey = (t: TreeType) => `craft-drop-tree-${t}`;
export const treeDropUrl = (t: TreeType) =>
  `${RESOURCES_BASE}tronco/drop-${t.replace(/_/g, '-')}.png`;

/**
 * Y-sort do mundo de coleta: profundidade em função do Y (pé do sprite),
 * numa banda entre as camadas de chão (0) e as camadas "above player" (200).
 * O player (depth fixo 100 no mapa principal) entra na mesma banda aqui.
 */
export function craftDepthForY(y: number, mapHeightPx: number): number {
  const t = Math.max(0, Math.min(1, y / Math.max(1, mapHeightPx)));
  return 100 + t * 89; // 100..189 — abaixo de 200 (above) e acima do chão (0)
}
