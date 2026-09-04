/**
 * Estações PORTÁTEIS (privadas) — itens craftáveis embutidos que o jogador
 * posiciona no Mundo de Coleta e que abrem o card da estação pública
 * correspondente (forja, mesa de crafting, fornalha, estação de poções).
 *
 * Regras (espelhadas entre servidor autoritativo e cliente):
 *   - São craft items EMBUTIDOS: aparecem em /admin/craft na seção "Itens
 *     criados" com nome/receita/estação editáveis e um campo extra de
 *     DURABILIDADE (quantos crafts a estação aguenta). Não podem ser apagados
 *     nem ter a imagem trocada (o sprite do mapa é fixo).
 *   - A durabilidade pertence à cópia (coluna `durability` da pilha, como as
 *     ferramentas) e VIAJA com ela: posicionar/soltar leva a durabilidade
 *     restante; recolher/pegar devolve. Ao contrário das ferramentas, 0 é um
 *     estado válido ("sem durabilidade"): a cópia continua no inventário mas
 *     não pode ser posicionada nem usada.
 *   - Para a durabilidade por cópia ficar coerente, o inventário carrega NO
 *     MÁXIMO UMA cópia de cada estação portátil (craft/pickup recusam a 2ª).
 *   - Só o dono usa a estação posicionada (cada craft gasta 1 de
 *     durabilidade); outros jogadores podem PEDIR permissão de uso (nunca de
 *     coleta). Passados PLACED_STATION_TTL_MS ela deixa de ter dono e vira um
 *     drop comum que qualquer um recolhe (com a durabilidade que restou).
 *   - Colisão = o retângulo do corpo do sprite (não o frame inteiro), para
 *     jogadores e animais.
 *
 * Mirrored byte-identical in:
 *   - artifacts/chessworld/src/shared/craft/PlaceableStations.ts   (client)
 *   - server/src/shared/craft/PlaceableStations.ts                 (Colyseus server)
 *   - artifacts/api-server/src/src/shared/craft/PlaceableStations.ts
 * Keep it free of Phaser/DOM/Node dependencies.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlaceableStationSprite {
  /** Caminho público (relativo à raiz do app do jogo); pode conter espaços — encodeURI ao carregar. */
  url: string;
  frameWidth: number;
  frameHeight: number;
  /** Frames lado a lado (1 = estático). */
  frames: number;
  fps: number;
}

export interface PlaceableStationDef {
  /** Slug do craft item (formato CRAFT_ITEM_ID_RE). */
  itemId: string;
  /** Nome padrão (o admin pode renomear). */
  name: string;
  /** Estação pública cujo card/receitas esta estação portátil abre. */
  stationId: 'forja' | 'mesa-de-crafting' | 'fornalha' | 'estacao-de-pocoes';
  /** Ícone do inventário/admin (caminho público do app do jogo). */
  iconUrl: string;
  sprite: PlaceableStationSprite;
  /**
   * Corpo opaco do sprite em px DO FRAME (colisão exata). A âncora do item no
   * mundo é o centro da base deste retângulo.
   */
  body: Rect;
  /** Durabilidade padrão (crafts) — o admin ajusta em /admin/craft. */
  defaultDurability: number;
}

const RES = '/assets/CraftingWorld/resources';

export const PLACEABLE_STATIONS: readonly PlaceableStationDef[] = [
  {
    itemId: 'bigorna-portatil',
    name: 'Bigorna portátil',
    stationId: 'forja',
    iconUrl: `${RES}/anvil/icon-anvil.png`,
    sprite: { url: `${RES}/anvil/anvil.png`, frameWidth: 72, frameHeight: 112, frames: 5, fps: 6 },
    body: { x: 7, y: 29, width: 60, height: 61 },
    defaultDurability: 50,
  },
  {
    itemId: 'mesa-de-crafting-portatil',
    name: 'Mesa de crafting portátil',
    stationId: 'mesa-de-crafting',
    iconUrl: `${RES}/crafting table/crafting-table.png`,
    sprite: { url: `${RES}/crafting table/crafting-table.png`, frameWidth: 72, frameHeight: 72, frames: 1, fps: 1 },
    body: { x: 3, y: 6, width: 66, height: 60 },
    defaultDurability: 50,
  },
  {
    itemId: 'fornalha-portatil',
    name: 'Fornalha portátil',
    stationId: 'fornalha',
    iconUrl: `${RES}/furnace/icon-furnace.png`,
    sprite: { url: `${RES}/furnace/furnace.png`, frameWidth: 72, frameHeight: 112, frames: 5, fps: 6 },
    body: { x: 12, y: 20, width: 47, height: 70 },
    defaultDurability: 50,
  },
  {
    itemId: 'estacao-de-pocoes-portatil',
    name: 'Estação de poções portátil',
    stationId: 'estacao-de-pocoes',
    iconUrl: `${RES}/potion station/icon-potion.png`,
    sprite: { url: `${RES}/potion station/potion-station.png`, frameWidth: 72, frameHeight: 72, frames: 5, fps: 6 },
    body: { x: 5, y: 14, width: 62, height: 46 },
    defaultDurability: 50,
  },
];

export const PLACEABLE_STATION_BY_ID: Readonly<Record<string, PlaceableStationDef>> = Object.fromEntries(
  PLACEABLE_STATIONS.map((def) => [def.itemId, def]),
);

/** Tempo que a estação fica do dono depois de posicionada; depois vira drop. */
export const PLACED_STATION_TTL_MS = 5 * 60_000;
/** Distância (px, da borda do corpo) para usar a estação — igual às públicas. */
export const PLACED_STATION_USE_DISTANCE = 64;
/** Distância (px, da borda do corpo) para o dono recolher. */
export const PLACED_STATION_PICKUP_DISTANCE = 100;
/** Folga mínima entre estações posicionadas / estações públicas (px). */
export const PLACED_STATION_CLEARANCE = 4;
export const MIN_PLACEABLE_DURABILITY = 1;
export const MAX_PLACEABLE_DURABILITY = 9999;
/** Máximo de cópias de cada estação portátil no inventário. */
export const PLACEABLE_STACK_LIMIT = 1;

/**
 * Retângulos (mundo) das estações PÚBLICAS do Mundo de Coleta — os mesmos que
 * o servidor usa para a proximidade do craft; estações portáteis não podem
 * ser posicionadas em cima deles.
 */
export const PUBLIC_STATION_RECTS: Readonly<Record<string, Rect>> = {
  fornalha: { x: 2298, y: 2752, width: 298, height: 211 },
  'estacao-de-pocoes': { x: 2328.67, y: 1983.33, width: 423, height: 386 },
  'mesa-de-crafting': { x: 3804, y: 1985, width: 654, height: 319 },
  forja: { x: 2392.5, y: 3075, width: 332, height: 123 },
};

export function isPlaceableStationItemKey(key: unknown): key is string {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(PLACEABLE_STATION_BY_ID, key);
}

export function placeableStationFor(key: unknown): PlaceableStationDef | null {
  return isPlaceableStationItemKey(key) ? PLACEABLE_STATION_BY_ID[key] : null;
}

/** Corpo (colisão/clique) no mundo para uma estação ancorada em (x, y) = centro da base do corpo. */
export function placedStationRect(def: PlaceableStationDef, x: number, y: number): Rect {
  return { x: x - def.body.width / 2, y: y - def.body.height, width: def.body.width, height: def.body.height };
}

/**
 * Deslocamento do sprite (origem 0.5,1 = centro da base do FRAME) em relação
 * à âncora, para o corpo desenhado cair exatamente sobre `placedStationRect`.
 */
export function placedStationSpriteOffset(def: PlaceableStationDef): { x: number; y: number } {
  return {
    x: def.sprite.frameWidth / 2 - (def.body.x + def.body.width / 2),
    y: def.sprite.frameHeight - (def.body.y + def.body.height),
  };
}

/** Distância euclidiana de um ponto à borda do retângulo (0 se estiver dentro). */
export function distanceToRect(px: number, py: number, rect: Rect): number {
  const nearestX = Math.max(rect.x, Math.min(px, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(py, rect.y + rect.height));
  return Math.hypot(px - nearestX, py - nearestY);
}

export function rectsOverlap(a: Rect, b: Rect, clearance = 0): boolean {
  return (
    a.x < b.x + b.width + clearance &&
    a.x + a.width + clearance > b.x &&
    a.y < b.y + b.height + clearance &&
    a.y + a.height + clearance > b.y
  );
}

export function pointInRect(px: number, py: number, rect: Rect): boolean {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
}

/** Durabilidade máxima válida para uma estação portátil (inteiro 1..9999). */
export function isValidPlaceableDurability(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) &&
    value >= MIN_PLACEABLE_DURABILITY && value <= MAX_PLACEABLE_DURABILITY;
}

/**
 * Restante válido de uma estação (0..max). null/ausente/lixo/acima do máximo
 * = cheia; negativo = 0. Diferente de clampToolRemaining: 0 é um estado
 * legítimo ("sem durabilidade"), não "cheia".
 */
export function clampStationRemaining(remaining: number | null | undefined, maxDurability: number): number {
  const max = Math.max(1, Math.floor(maxDurability));
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return max;
  return Math.max(0, Math.min(max, Math.floor(remaining)));
}

/**
 * Durabilidade da pilha depois de uma cópia (com `incoming` restante) voltar
 * para ela: a pior das duas — nunca "renova" uma cópia gasta.
 */
export function mergeStationRemaining(existing: number | null | undefined, incoming: number | null | undefined, maxDurability: number): number {
  return Math.min(clampStationRemaining(existing, maxDurability), clampStationRemaining(incoming, maxDurability));
}

/** Valor a gravar na coluna: null quando cheia (convenção da pilha). */
export function stationRemainingForStorage(remaining: number, maxDurability: number): number | null {
  const clamped = clampStationRemaining(remaining, maxDurability);
  return clamped >= Math.max(1, Math.floor(maxDurability)) ? null : clamped;
}

/** Ids de jogadores autorizados a USAR uma estação (campo `allowed`, separado por vírgula). */
export function parseAllowedIds(allowed: string): string[] {
  return allowed.split(',').map((id) => id.trim()).filter((id) => id.length > 0);
}

export function joinAllowedIds(ids: Iterable<string>): string {
  return [...new Set(ids)].join(',');
}
