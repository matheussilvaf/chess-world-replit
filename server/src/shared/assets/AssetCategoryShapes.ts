/**
 * AssetCategoryShapes — categorias de permissão de assets (spec: /admin/assets-controller).
 *
 * Uma "categoria" é um agrupamento ADMINISTRATIVO de assets (ex.: "default
 * character", "shop assets", "level up") usado para separar o que pode ou não
 * aparecer em cada contexto do jogo. O jogo ainda NÃO consome isso — é
 * metadado para features futuras referenciarem por categoria.
 *
 * Estrutura: até 2 níveis (categoria raiz → subcategoria) via `parentId`.
 * Assets são referenciados por strings estáveis ("refs"):
 *   - `gen:<camada>/<familia>`             → família inteira do gerador (todas as cores)
 *   - `gen:<camada>/<familia>/<variante>`  → variação específica (ex.: cor c2)
 *   - `craft:<itemId>`                     → craft item cadastrado no /admin/craft
 *
 * Este arquivo é espelhado no cliente e nos servidores (server/src e
 * artifacts/api-server) — mantenha-o livre de dependências.
 */

export interface AssetCategoryConfig {
  categoryId: string;
  /** Nome de exibição (o id é um slug imutável derivado do primeiro nome). */
  name: string;
  /** null = categoria raiz; senão, id de uma categoria RAIZ (máx. 2 níveis). */
  parentId: string | null;
  /** Refs únicas, ordem irrelevante. */
  assetRefs: string[];
}

export const ASSET_CATEGORY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const MAX_CATEGORY_NAME_LENGTH = 60;
export const MAX_ASSET_REFS_PER_CATEGORY = 800;

const REF_SEGMENT = '[A-Za-z0-9][A-Za-z0-9_-]{0,47}';
export const ASSET_REF_RE = new RegExp(
  `^(?:gen:${REF_SEGMENT}/${REF_SEGMENT}(?:/${REF_SEGMENT})?|craft:[a-z0-9][a-z0-9_-]{0,47})$`,
);

export type ParsedAssetRef =
  | { kind: 'gen'; layer: string; familyId: string; variantId: string | null }
  | { kind: 'craft'; itemId: string };

export function parseAssetRef(ref: string): ParsedAssetRef | null {
  if (!ASSET_REF_RE.test(ref)) return null;
  if (ref.startsWith('craft:')) return { kind: 'craft', itemId: ref.slice('craft:'.length) };
  const [layer, familyId, variantId] = ref.slice('gen:'.length).split('/');
  return { kind: 'gen', layer, familyId, variantId: variantId ?? null };
}

export const genFamilyRef = (layer: string, familyId: string): string => `gen:${layer}/${familyId}`;
export const genVariantRef = (layer: string, familyId: string, variantId: string): string =>
  `gen:${layer}/${familyId}/${variantId}`;
export const craftItemRef = (itemId: string): string => `craft:${itemId}`;

/** Mesma política de slug do craft: id imutável derivado do nome. */
export function slugifyCategoryName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return ASSET_CATEGORY_ID_RE.test(slug) ? slug : '';
}

export interface AssetCategoryValidation {
  ok: boolean;
  errors: string[];
}

export function validateAssetCategoryConfig(value: unknown): AssetCategoryValidation {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['config deve ser um objeto'] };
  }
  const cfg = value as Record<string, unknown>;

  if (typeof cfg.categoryId !== 'string' || !ASSET_CATEGORY_ID_RE.test(cfg.categoryId)) {
    errors.push('categoryId deve ser um slug (a-z, 0-9, hífen/underscore, até 48 chars)');
  }
  if (
    typeof cfg.name !== 'string' ||
    cfg.name.trim().length === 0 ||
    cfg.name.trim().length > MAX_CATEGORY_NAME_LENGTH
  ) {
    errors.push(`name deve ter 1..${MAX_CATEGORY_NAME_LENGTH} caracteres`);
  }
  if (cfg.parentId !== null) {
    if (typeof cfg.parentId !== 'string' || !ASSET_CATEGORY_ID_RE.test(cfg.parentId)) {
      errors.push('parentId deve ser null ou um slug de categoria');
    } else if (cfg.parentId === cfg.categoryId) {
      errors.push('parentId não pode ser a própria categoria');
    }
  }
  if (!Array.isArray(cfg.assetRefs)) {
    errors.push('assetRefs deve ser uma lista');
  } else {
    if (cfg.assetRefs.length > MAX_ASSET_REFS_PER_CATEGORY) {
      errors.push(`assetRefs suporta no máximo ${MAX_ASSET_REFS_PER_CATEGORY} refs`);
    }
    const seen = new Set<string>();
    for (const ref of cfg.assetRefs) {
      if (typeof ref !== 'string' || !ASSET_REF_RE.test(ref)) {
        errors.push(`ref inválida: ${typeof ref === 'string' ? ref : typeof ref}`);
        break;
      }
      if (seen.has(ref)) {
        errors.push(`ref duplicada: ${ref}`);
        break;
      }
      seen.add(ref);
    }
  }
  return { ok: errors.length === 0, errors };
}
