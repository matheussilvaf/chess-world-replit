/**
 * Player Character Shapes — contrato do personagem jogável (v1).
 *
 * Espelhado byte a byte em:
 *   - artifacts/chessworld/src/shared/characters/PlayerCharacterShapes.ts
 *   - server/src/shared/characters/PlayerCharacterShapes.ts
 *   - artifacts/api-server/src/src/shared/characters/PlayerCharacterShapes.ts
 * (auto-contido de propósito: nenhum import, para o espelhamento ser trivial)
 *
 * O personagem é uma RECEITA (classe + tom de pele + família/variante por
 * camada do gerador de personagens), não um spritesheet: cada cliente compõe
 * a folha localmente e cacheia a textura por hash do conteúdo — quem repete a
 * mesma receita reaproveita a mesma textura, sem novo download.
 *
 * A PERMISSÃO (o que pode ser escolhido) vem das categorias de assets do
 * /admin/assets-controller:
 *   - aparência → refs da categoria `default-character`
 *   - arma      → subcategoria da classe dentro de `default-weapons`
 */

// ------------------------------------------------------------------ classes

export const PLAYER_CLASS_IDS = ['assassino', 'arqueiro', 'guerreiro', 'mago'] as const;
export type PlayerClassId = (typeof PLAYER_CLASS_IDS)[number];

export const PLAYER_CLASS_LABELS: Record<PlayerClassId, string> = {
  assassino: 'Assassino',
  arqueiro: 'Arqueiro',
  guerreiro: 'Guerreiro',
  mago: 'Mago',
};

export function isPlayerClassId(value: unknown): value is PlayerClassId {
  return typeof value === 'string' && (PLAYER_CLASS_IDS as readonly string[]).includes(value);
}

/** Categoria raiz com as permissões de aparência do personagem inicial. */
export const DEFAULT_CHARACTER_CATEGORY_ID = 'default-character';
/** Categoria raiz cujas subcategorias (uma por classe) definem a arma inicial. */
export const DEFAULT_WEAPONS_CATEGORY_ID = 'default-weapons';

// ---------------------------------------------------------------- aparência

/**
 * Ids de tom de pele — manter em sincronia com
 * lib/character-generator/skinTones.ts (um teste garante a paridade).
 */
export const SKIN_TONE_IDS = ['default', 'green', 'red', 'tone1', 'tone2', 'tone3', 'bone'] as const;
export type SkinToneId = (typeof SKIN_TONE_IDS)[number];

/** Camadas do gerador que o jogador escolhe na criação. */
export const REQUIRED_APPEARANCE_LAYERS = ['head', 'top', 'bottom'] as const;
export const OPTIONAL_APPEARANCE_LAYERS = ['hair'] as const;
export type AppearanceLayerId =
  | (typeof REQUIRED_APPEARANCE_LAYERS)[number]
  | (typeof OPTIONAL_APPEARANCE_LAYERS)[number];
export const APPEARANCE_LAYERS: readonly AppearanceLayerId[] = [
  ...REQUIRED_APPEARANCE_LAYERS,
  ...OPTIONAL_APPEARANCE_LAYERS,
];

export interface AppearanceLayerChoice {
  familyId: string;
  variantId: string;
}

export interface CharacterAppearanceV1 {
  v: 1;
  skinTone: string;
  layers: {
    head: AppearanceLayerChoice;
    top: AppearanceLayerChoice;
    bottom: AppearanceLayerChoice;
    /** null = sem cabelo. */
    hair: AppearanceLayerChoice | null;
  };
}

export interface PlayerCharacterConfigV1 {
  v: 1;
  classId: PlayerClassId;
  appearance: CharacterAppearanceV1;
  /** Ref de asset de mão (`gen:weapon/...` arma ou `gen:crafttools/...` ferramenta) ou null. */
  equippedWeapon: string | null;
}

/** Segmento de id do gerador (família/variante): slug minúsculo curto. */
const SEGMENT_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/**
 * Ref de item de MÃO equipável — camada `weapon` (armas) ou `crafttools`
 * (ferramentas de coleta). Grupos: [1] categoria, [2] família, [3] variação.
 * Prefira parseWeaponRef() a .exec para não depender dos índices.
 */
export const WEAPON_REF_RE =
  /^gen:(weapon|crafttools)\/([a-z0-9][a-z0-9_-]{0,39})(?:\/([a-z0-9][a-z0-9_-]{0,39}))?$/;

/** Ref de equipável decomposta (null = fora do formato). */
export interface ParsedWeaponRef {
  category: 'weapon' | 'crafttools';
  familyId: string;
  /** null = variação default da família. */
  variantId: string | null;
}

export function parseWeaponRef(ref: string | null | undefined): ParsedWeaponRef | null {
  if (!ref) return null;
  const m = WEAPON_REF_RE.exec(ref);
  if (!m) return null;
  return {
    category: m[1] as ParsedWeaponRef['category'],
    familyId: m[2],
    variantId: m[3] ?? null,
  };
}

// --------------------------------------------------------------- validação

export type AppearanceValidation =
  | { ok: true; appearance: CharacterAppearanceV1 }
  | { ok: false; errors: string[] };

function validateChoice(value: unknown, where: string, errors: string[]): AppearanceLayerChoice | null {
  if (typeof value !== 'object' || value === null) {
    errors.push(`${where}: deve ser um objeto { familyId, variantId }`);
    return null;
  }
  const v = value as Record<string, unknown>;
  const familyId = typeof v.familyId === 'string' ? v.familyId : '';
  const variantId = typeof v.variantId === 'string' ? v.variantId : '';
  if (!SEGMENT_RE.test(familyId)) errors.push(`${where}.familyId inválido: "${String(v.familyId)}"`);
  if (!SEGMENT_RE.test(variantId)) errors.push(`${where}.variantId inválido: "${String(v.variantId)}"`);
  return { familyId, variantId };
}

/** Validação ESTRUTURAL da aparência (permissões são checadas à parte, contra as categorias). */
export function validateCharacterAppearance(value: unknown): AppearanceValidation {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null) {
    return { ok: false, errors: ['appearance deve ser um objeto'] };
  }
  const a = value as Record<string, unknown>;
  if (a.v !== 1) errors.push('appearance.v deve ser 1');
  const skinTone = typeof a.skinTone === 'string' ? a.skinTone : '';
  if (!(SKIN_TONE_IDS as readonly string[]).includes(skinTone)) {
    errors.push(`skinTone inválido: "${String(a.skinTone)}"`);
  }
  if (typeof a.layers !== 'object' || a.layers === null) {
    errors.push('appearance.layers deve ser um objeto');
    return { ok: false, errors };
  }
  const layers = a.layers as Record<string, unknown>;
  const head = validateChoice(layers.head, 'layers.head', errors);
  const top = validateChoice(layers.top, 'layers.top', errors);
  const bottom = validateChoice(layers.bottom, 'layers.bottom', errors);
  let hair: AppearanceLayerChoice | null = null;
  if (layers.hair !== null && layers.hair !== undefined) {
    hair = validateChoice(layers.hair, 'layers.hair', errors);
  }
  for (const key of Object.keys(layers)) {
    if (!['head', 'top', 'bottom', 'hair'].includes(key)) {
      errors.push(`layers.${key} não é uma camada suportada`);
    }
  }
  if (errors.length > 0 || !head || !top || !bottom) {
    return { ok: false, errors: errors.length > 0 ? errors : ['camadas obrigatórias ausentes'] };
  }
  return {
    ok: true,
    appearance: { v: 1, skinTone, layers: { head, top, bottom, hair } },
  };
}

export type PlayerCharacterValidation =
  | { ok: true; config: PlayerCharacterConfigV1 }
  | { ok: false; errors: string[] };

export function validatePlayerCharacterConfig(value: unknown): PlayerCharacterValidation {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, errors: ['config deve ser um objeto'] };
  }
  const c = value as Record<string, unknown>;
  const errors: string[] = [];
  if (c.v !== 1) errors.push('v deve ser 1');
  if (!isPlayerClassId(c.classId)) errors.push(`classId inválido: "${String(c.classId)}"`);
  const appearance = validateCharacterAppearance(c.appearance);
  if (!appearance.ok) errors.push(...appearance.errors);
  let equippedWeapon: string | null = null;
  if (c.equippedWeapon !== null && c.equippedWeapon !== undefined) {
    if (typeof c.equippedWeapon !== 'string' || !WEAPON_REF_RE.test(c.equippedWeapon)) {
      errors.push(`equippedWeapon inválido: "${String(c.equippedWeapon)}"`);
    } else {
      equippedWeapon = c.equippedWeapon;
    }
  }
  if (errors.length > 0 || !appearance.ok) return { ok: false, errors };
  return {
    ok: true,
    config: {
      v: 1,
      classId: c.classId as PlayerClassId,
      appearance: appearance.appearance,
      equippedWeapon,
    },
  };
}

// ------------------------------------------------- permissões (categorias)

/** Ref de família de uma camada (formato usado nas categorias de assets). */
export function appearanceLayerRef(layer: AppearanceLayerId, familyId: string): string {
  return `gen:${layer}/${familyId}`;
}

/**
 * Uma escolha é permitida se a categoria contém a ref da FAMÍLIA (qualquer
 * variante liberada) ou a ref exata da variante.
 */
export function appearanceChoiceAllowed(
  refs: readonly string[],
  layer: AppearanceLayerId,
  choice: AppearanceLayerChoice,
): boolean {
  return (
    refs.includes(`gen:${layer}/${choice.familyId}`) ||
    refs.includes(`gen:${layer}/${choice.familyId}/${choice.variantId}`)
  );
}

/** Erros (PT-BR) de permissão da aparência contra as refs da categoria. */
export function validateAppearanceAgainstRefs(
  appearance: CharacterAppearanceV1,
  refs: readonly string[],
): string[] {
  const errors: string[] = [];
  const check = (layer: AppearanceLayerId, choice: AppearanceLayerChoice | null) => {
    if (!choice) return;
    if (!appearanceChoiceAllowed(refs, layer, choice)) {
      errors.push(`"${choice.familyId}/${choice.variantId}" não está liberado para a camada ${layer}`);
    }
  };
  check('head', appearance.layers.head);
  check('top', appearance.layers.top);
  check('bottom', appearance.layers.bottom);
  check('hair', appearance.layers.hair);
  return errors;
}

/** Forma estrutural mínima de uma categoria de assets (evita import cruzado). */
export interface AssetCategoryLike {
  categoryId: string;
  name: string;
  parentId: string | null;
  assetRefs: string[];
}

/**
 * Arma padrão de uma classe: primeira ref de arma da subcategoria da classe
 * dentro de `default-weapons` (match por categoryId OU por nome slugificado).
 */
export function findClassWeaponRef(
  categories: Record<string, AssetCategoryLike>,
  classId: PlayerClassId,
): string | null {
  const child = Object.values(categories).find(
    (c) =>
      c.parentId === DEFAULT_WEAPONS_CATEGORY_ID &&
      (c.categoryId === classId || c.name.trim().toLowerCase() === classId),
  );
  if (!child) return null;
  const ref = child.assetRefs.find((r) => WEAPON_REF_RE.test(r));
  return ref ?? null;
}

// ------------------------------------------------------ forma canônica/hash

/**
 * String canônica da aparência — ordem de chaves FIXA. É o formato que
 * trafega no estado do Colyseus e a base do hash de cache de textura
 * (servidor e todos os clientes produzem byte a byte a mesma string).
 */
export function canonicalAppearanceString(a: CharacterAppearanceV1): string {
  const choice = (c: AppearanceLayerChoice | null): string =>
    c ? `{"familyId":${JSON.stringify(c.familyId)},"variantId":${JSON.stringify(c.variantId)}}` : 'null';
  return (
    `{"v":1,"skinTone":${JSON.stringify(a.skinTone)},"layers":{` +
    `"head":${choice(a.layers.head)},` +
    `"top":${choice(a.layers.top)},` +
    `"bottom":${choice(a.layers.bottom)},` +
    `"hair":${choice(a.layers.hair)}}}`
  );
}

/** Parse + validação da string canônica (estado do Colyseus). */
export function parseAppearanceString(raw: string): CharacterAppearanceV1 | null {
  if (!raw) return null;
  try {
    const result = validateCharacterAppearance(JSON.parse(raw));
    return result.ok ? result.appearance : null;
  } catch {
    return null;
  }
}

/** FNV-1a 32 bits (hex) — hash estável para chaves de textura/def. */
export function appearanceHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// --------------------------------------------------- folha composta (jogo)

/**
 * Layout da folha composta do gerador (2208×384: 23 colunas × 4 direções
 * S,W,E,N) e as animações que o MUNDO usa. Cliente compõe/anima com isso;
 * o servidor usa os tamanhos para cronometrar cooldown de ataque.
 */
export const COMPOSED_SHEET = {
  columns: 23,
  rows: 4,
  frameSize: 96,
  /** Padrão de colunas do andar (0,1,2,1 em loop). */
  walkFrames: [0, 1, 2, 1],
  /** Coluna da pose parada. */
  standFrame: 1,
  /** Colunas do ataque completo (wind-up → golpe). */
  attackFrames: [10, 11, 12, 13, 14],
  /** Colunas do disparo de arco (knock-and-bow: puxar → soltar). */
  shootFrames: [15, 16, 17, 18],
  /** Coluna do caído/KO. */
  deadFrame: 22,
} as const;
