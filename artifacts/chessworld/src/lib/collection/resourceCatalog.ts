/**
 * Catálogo ÚNICO dos recursos do Mundo de Coleta para as UIs (admin de
 * coleta, manual de receitas, …).
 *
 * Fonte de verdade visual: craftingMapConfig (sheets/urls/frames). As CHAVES
 * são as mesmas de RESOURCE_KEYS (CollectionShapes) e do inventário de coleta
 * — `mineral:pedra`, `tree:pinheiro_peao`, `herb:heal_herb`, `bush`,
 * `hand_stone`, `animal:cow`. Ao adicionar um recurso novo no
 * craftingMapConfig, inclua o rótulo aqui e a chave no CollectionShapes.
 */
import {
  ANIMALS,
  BUSH,
  HAND_STONE,
  HERBS,
  MINERALS,
  MINERAL_SHEET,
  RESOURCES_BASE,
  TREE_SHEET,
  TREE_TYPES,
  herbUrl,
  treeSheetUrl,
} from '../../game/config/craftingMapConfig';

export type ResourceGroup = 'Minerais' | 'Árvores' | 'Ervas' | 'Outros' | 'Animais';

export const RESOURCE_GROUPS: readonly ResourceGroup[] = [
  'Minerais',
  'Árvores',
  'Ervas',
  'Outros',
  'Animais',
];

export interface ResourceDefinition {
  key: string;
  label: string;
  group: ResourceGroup;
  url: string;
  frameWidth: number;
  frameHeight: number;
  naturalImage?: boolean;
}

/** Rótulos PT-BR por id CURTO (sem o prefixo "mineral:"/"tree:"/…). */
export const RESOURCE_LABELS: Record<string, string> = {
  pedra: 'Pedra',
  carvao: 'Carvão',
  ferro: 'Ferro',
  cobre: 'Cobre',
  ouro: 'Ouro',
  diamante: 'Diamante',
  cristal_real: 'Cristal real',
  pinheiro_peao: 'Pinheiro-peão',
  carvalho_torre: 'Carvalho-torre',
  freixo_cavalo: 'Freixo-cavalo',
  ebano_dama: 'Ébano-dama',
  salgueiro_bispo: 'Salgueiro-bispo',
  heal_herb: 'Erva de cura',
  red_herb: 'Erva vermelha',
  blue_herb: 'Erva azul',
  queen_thorn: 'Espinho da rainha',
  horse_root: 'Raiz de cavalo',
  bush: 'Arbusto',
  hand_stone: 'Pedra de mão',
  cow: 'Vaca',
  sheep: 'Ovelha',
  chicken: 'Galinha',
};

/** Todos os recursos do Mundo de Coleta, na ordem de exibição por grupo. */
export const RESOURCE_DEFINITIONS: ResourceDefinition[] = [
  ...MINERALS.map((m) => ({
    key: `mineral:${m.id}`,
    label: RESOURCE_LABELS[m.id],
    group: 'Minerais' as const,
    url: `${RESOURCES_BASE}minerals/${m.file}`,
    frameWidth: MINERAL_SHEET.frameWidth,
    frameHeight: MINERAL_SHEET.frameHeight,
  })),
  ...TREE_TYPES.map((tree) => ({
    key: `tree:${tree}`,
    label: RESOURCE_LABELS[tree],
    group: 'Árvores' as const,
    url: treeSheetUrl(tree),
    frameWidth: TREE_SHEET.frameWidth,
    frameHeight: TREE_SHEET.frameHeight,
  })),
  ...HERBS.map((herb) => ({
    key: `herb:${herb.id}`,
    label: RESOURCE_LABELS[herb.id],
    group: 'Ervas' as const,
    url: herbUrl(herb.file),
    frameWidth: 1,
    frameHeight: 1,
    naturalImage: true,
  })),
  {
    key: 'bush',
    label: RESOURCE_LABELS.bush,
    group: 'Outros',
    url: BUSH.url,
    frameWidth: 1,
    frameHeight: 1,
    naturalImage: true,
  },
  {
    key: 'hand_stone',
    label: RESOURCE_LABELS.hand_stone,
    group: 'Outros',
    url: HAND_STONE.url,
    frameWidth: HAND_STONE.frameWidth,
    frameHeight: HAND_STONE.frameHeight,
  },
  ...ANIMALS.map((animal) => ({
    key: `animal:${animal.id}`,
    label: RESOURCE_LABELS[animal.id],
    group: 'Animais' as const,
    url: `${RESOURCES_BASE}animais/${animal.file}`,
    frameWidth: animal.frameSize,
    frameHeight: animal.frameSize,
  })),
];

export const resourceByKey: ReadonlyMap<string, ResourceDefinition> = new Map(
  RESOURCE_DEFINITIONS.map((def) => [def.key, def]),
);

/**
 * Ícone de DROP (imagem única) — o mesmo visual do inventário de coleta.
 * Animais e hand_stone não têm drop dedicado (usam recorte do sheet).
 */
export const RESOURCE_DROP_ICONS: Record<string, string> = {
  'mineral:pedra': `${RESOURCES_BASE}minerals/drop/drop-stone.png`,
  'mineral:carvao': `${RESOURCES_BASE}minerals/drop/drop-coal.png`,
  'mineral:ferro': `${RESOURCES_BASE}minerals/drop/drop-iron.png`,
  'mineral:cobre': `${RESOURCES_BASE}minerals/drop/drop-copper.png`,
  'mineral:ouro': `${RESOURCES_BASE}minerals/drop/drop-gold.png`,
  'mineral:diamante': `${RESOURCES_BASE}minerals/drop/drop-diamond.png`,
  'mineral:cristal_real': `${RESOURCES_BASE}minerals/drop/drop-cristal-real.png`,
  'tree:pinheiro_peao': `${RESOURCES_BASE}tronco/drop-pinheiro-peao.png`,
  'tree:carvalho_torre': `${RESOURCES_BASE}tronco/drop-carvalho-torre.png`,
  'tree:freixo_cavalo': `${RESOURCES_BASE}tronco/drop-freixo-cavalo.png`,
  'tree:ebano_dama': `${RESOURCES_BASE}tronco/drop-ebano-dama.png`,
  'tree:salgueiro_bispo': `${RESOURCES_BASE}tronco/drop-salgueiro-bispo.png`,
  'herb:heal_herb': `${RESOURCES_BASE}ervas e plantas/heal_herb.png`,
  'herb:red_herb': `${RESOURCES_BASE}ervas e plantas/red_herb.png`,
  'herb:blue_herb': `${RESOURCES_BASE}ervas e plantas/blue_herb.png`,
  'herb:queen_thorn': `${RESOURCES_BASE}ervas e plantas/queen_thorn.png`,
  'herb:horse_root': `${RESOURCES_BASE}ervas e plantas/horse_root.png`,
  bush: BUSH.url,
};
