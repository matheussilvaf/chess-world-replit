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

/**
 * Y-sort do mundo de coleta: profundidade em função do Y (pé do sprite),
 * numa banda entre as camadas de chão (0) e as camadas "above player" (200).
 * O player (depth fixo 100 no mapa principal) entra na mesma banda aqui.
 */
export function craftDepthForY(y: number, mapHeightPx: number): number {
  const t = Math.max(0, Math.min(1, y / Math.max(1, mapHeightPx)));
  return 100 + t * 89; // 100..189 — abaixo de 200 (above) e acima do chão (0)
}
