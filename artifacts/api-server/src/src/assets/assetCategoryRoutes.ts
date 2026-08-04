/**
 * Assets Controller HTTP surface (spec: /admin/assets-controller).
 *
 * Admin (Supabase JWT required):
 *   - /api/admin/asset-categories   GET, PUT /:categoryId, DELETE /:categoryId
 * Público (read-only, cacheado — features futuras leem daqui):
 *   - GET /api/asset-category-data  → { categories }
 *
 * Regras de árvore (máx. 2 níveis):
 *   - parentId deve apontar para uma categoria RAIZ existente;
 *   - uma categoria com filhos não pode virar subcategoria;
 *   - DELETE é bloqueado (409 + usedBy) enquanto houver subcategorias.
 * Refs de asset são validadas por FORMATO (o servidor não escaneia PNGs; a
 * descoberta é do manifest no cliente — refs órfãs são toleradas e a UI marca).
 */
import { Router, type Request, type Response } from 'express';
import { requireSupabaseAuth } from '../auth/supabaseAuth.js';
import {
  ASSET_CATEGORY_ID_RE,
  validateAssetCategoryConfig,
  type AssetCategoryConfig,
} from '../shared/assets/AssetCategoryShapes.js';
import {
  ASSET_CATEGORY_TABLE_SQL,
  deleteAssetCategory,
  getAssetCategoriesCached,
  listAssetCategories,
  saveAssetCategory,
} from './assetCategoryRepository.js';

function badCategoryId(res: Response, categoryId: string): boolean {
  if (ASSET_CATEGORY_ID_RE.test(categoryId)) return false;
  res.status(400).json({ error: `categoryId inválido: "${categoryId}" (slug minúsculo)` });
  return true;
}

function writeFailed(res: Response, result: { tableMissing: boolean; error: string | null }): void {
  if (result.tableMissing) {
    res.status(503).json({
      error: 'Tabela asset_categories ausente no Supabase',
      tableMissing: true,
      tableSql: ASSET_CATEGORY_TABLE_SQL,
    });
    return;
  }
  res.status(500).json({ error: result.error ?? 'Falha ao persistir' });
}

// ------------------------------------------------------- admin: categorias

export const assetCategoriesAdminRouter = Router();
assetCategoriesAdminRouter.use(requireSupabaseAuth);

assetCategoriesAdminRouter.get('/', async (_req: Request, res: Response) => {
  const result = await listAssetCategories();
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({
    categories: result.records,
    updatedAt: result.updatedAt,
    tableMissing: result.tableMissing,
    invalidIds: result.invalidIds,
    ...(result.tableMissing ? { tableSql: ASSET_CATEGORY_TABLE_SQL } : {}),
  });
});

assetCategoriesAdminRouter.put('/:categoryId', async (req: Request, res: Response) => {
  const categoryId = String(req.params.categoryId ?? '');
  if (badCategoryId(res, categoryId)) return;
  const validated = validateAssetCategoryConfig(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: 'AssetCategoryConfig inválido', details: validated.errors });
    return;
  }
  const body = req.body as AssetCategoryConfig;
  if (body.categoryId !== categoryId) {
    res.status(400).json({ error: `categoryId do corpo ("${body.categoryId}") difere da URL ("${categoryId}")` });
    return;
  }

  // Regras de árvore precisam do estado atual (fresco, não o cache público).
  const current = await listAssetCategories();
  if (current.error) {
    res.status(500).json({ error: current.error });
    return;
  }
  if (current.tableMissing) {
    writeFailed(res, { tableMissing: true, error: null });
    return;
  }
  if (body.parentId !== null) {
    const parent = current.records[body.parentId];
    if (!parent) {
      res.status(400).json({ error: `Categoria-pai "${body.parentId}" não existe` });
      return;
    }
    if (parent.parentId !== null) {
      res.status(400).json({ error: 'Máximo de 2 níveis: uma subcategoria não pode ter filhos' });
      return;
    }
    const children = Object.values(current.records).filter((c) => c.parentId === categoryId);
    if (children.length > 0) {
      res.status(400).json({
        error: `"${categoryId}" tem ${children.length} subcategoria(s) e não pode virar subcategoria`,
        details: children.map((c) => c.categoryId).sort(),
      });
      return;
    }
  }

  // Cópia normalizada — nunca persistir campos desconhecidos no jsonb.
  const config: AssetCategoryConfig = {
    categoryId,
    name: body.name.trim(),
    parentId: body.parentId,
    assetRefs: [...body.assetRefs].sort(),
  };
  const result = await saveAssetCategory(config);
  if (!result.ok) {
    writeFailed(res, result);
    return;
  }
  res.json({ category: config });
});

assetCategoriesAdminRouter.delete('/:categoryId', async (req: Request, res: Response) => {
  const categoryId = String(req.params.categoryId ?? '');
  if (badCategoryId(res, categoryId)) return;
  // Nunca orfanar subcategorias silenciosamente.
  const current = await listAssetCategories();
  if (current.error) {
    res.status(500).json({ error: current.error });
    return;
  }
  const usedBy = Object.values(current.records)
    .filter((c) => c.parentId === categoryId)
    .map((c) => c.categoryId)
    .sort();
  if (usedBy.length > 0) {
    res.status(409).json({
      error: `Categoria "${categoryId}" tem ${usedBy.length} subcategoria(s)`,
      usedBy,
    });
    return;
  }
  const result = await deleteAssetCategory(categoryId);
  if (!result.ok) {
    writeFailed(res, result);
    return;
  }
  res.json({ ok: true });
});

// ------------------------------------------------------------------ público

export async function publicAssetCategoryDataHandler(_req: Request, res: Response): Promise<void> {
  const categories = await getAssetCategoriesCached();
  res.json({ categories });
}
