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

/** Galho caído: imagem única nos insert points de branches_spawns (coleta com a mão). */
export const BRANCH = {
  textureKey: 'craft-branch',
  url: `${RESOURCES_BASE}branch/branch.png`,
  layer: 'branches_spawns',
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
 * O sheet "eating" é o visual inicial; walking.png anima o passeio e
 * dying.png (mesmas dimensões) toca UMA vez no abate (HP zerado).
 */
export const ANIMAL_SHEET = { columns: 7, rows: 4, frames: 7, eatFrameRate: 6, walkFrameRate: 8, dieFrameRate: 8 } as const;
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
  /** Sheet da morte (toca uma vez no abate) dentro de resources/animais/ */
  dieFile: string;
  /** Lado do frame quadrado nos sheets. */
  frameSize: number;
  /** Velocidade do passeio (px/s). */
  speed: number;
  /** Itens (chaves de ANIMAL_DROP_ITEMS) que caem no chão quando o bicho morre. */
  drops: readonly string[];
}

export const ANIMALS: AnimalDef[] = [
  { id: 'cow', layer: 'cows', file: 'cow/coweating.png', walkFile: 'cow/walking.png', dieFile: 'cow/dying.png', frameSize: 140, speed: 22, drops: ['beef', 'couro'] },
  { id: 'sheep', layer: 'sheeps', file: 'sheep/sheepeating.png', walkFile: 'sheep/walking.png', dieFile: 'sheep/dying.png', frameSize: 116, speed: 24, drops: ['wool'] },
  { id: 'chicken', layer: 'chickens', file: 'chicken/chickeneating.png', walkFile: 'chicken/walking.png', dieFile: 'chicken/dying.png', frameSize: 44, speed: 28, drops: ['pena'] },
];

/**
 * Itens de abate (drops dos animais): imagens únicas 40×40 em resources/<pasta>/.
 * As chaves são as mesmas de RESOURCE_KEYS/inventário — vaca solta beef+couro,
 * ovelha solta wool, galinha solta pena (AnimalDef.drops).
 */
export interface AnimalDropDef {
  key: string;
  /** Caminho dentro de resources/ */
  file: string;
}

export const ANIMAL_DROP_ITEMS: AnimalDropDef[] = [
  { key: 'beef', file: 'beef/beef.png' },
  { key: 'couro', file: 'couro/couro.png' },
  { key: 'wool', file: 'wool/wool.png' },
  { key: 'pena', file: 'pena/pena.png' },
];

export const animalDropTextureKey = (key: string) => `craft-animal-drop-${key}`;
export const animalDropUrl = (file: string) => `${RESOURCES_BASE}${file}`;

/** Passeio: raio máximo em torno do ponto de spawn e duração das pausas comendo. */
export const ANIMAL_WANDER = { radius: 72, eatMinMs: 2500, eatMaxMs: 7000 } as const;

/**
 * Fuga (vaca/ovelha; galinha ignora): duração após o último golpe e velocidade
 * padrão = speedMultiplier × passeio. Raio e velocidade têm override por animal
 * no admin (fleeRadius/fleeSpeed da config de coleta; raio padrão nas shapes).
 */
/** triggerRadius: COMEÇAR um golpe a até este raio do bicho já dispara a fuga. */
export const ANIMAL_FLEE = { durationMs: 5000, speedMultiplier: 2.2, triggerRadius: 160 } as const;

/**
 * Proteção pós-respawn do abate: por este intervalo o bicho recém-renascido
 * não pode ser mirado nem atingido. Sem isso, o respawn imediato (perto de onde
 * ele morreu) + uma arma forte = abate duplo sem querer, com drops duplicados.
 */
export const ANIMAL_RESPAWN_PROTECT_MS = 1500;

/**
 * Escala dos mini-drops que reusam a própria textura do recurso (a pedra de
 * mão não entra: ela rende Pedra comum e usa o drop do minério).
 */
export const SELF_DROP_SCALE = { herb: 0.45, bush: 0.45, branch: 0.45 } as const;

export const animalTextureKey = (id: string) => `craft-animal-${id}`;
export const animalWalkTextureKey = (id: string) => `craft-animal-walk-${id}`;
export const animalDieTextureKey = (id: string) => `craft-animal-die-${id}`;
export const animalAnimKey = (id: string, action: 'eat' | 'walk' | 'die', dir: AnimalDirection) =>
  `craft-animal-${action}-${dir}-${id}`;

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
