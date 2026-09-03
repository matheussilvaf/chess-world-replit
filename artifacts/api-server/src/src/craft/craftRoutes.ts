/**
 * Craft system HTTP surface (spec: /admin/craft).
 *
 * Admin (Supabase JWT required):
 *   - /api/admin/craft-items     GET, PUT /:itemId, DELETE /:itemId, POST /:itemId/image
 *   - /api/admin/craft-recipes   GET, PUT /:targetId, DELETE /:targetId
 * Public (read-only, cached — the future player craft panel reads this):
 *   - GET /api/craft-data        → { items, recipes }
 *
 * Icons are uploaded as RAW image bytes (Content-Type image/*), never JSON:
 * @colyseus/tools registers its own express.json() (100kb cap) BEFORE any of
 * our middleware, so base64-in-JSON dies there with 413 no matter what limit
 * we set later. express.raw on this route sidesteps that parser entirely
 * (json() only touches application/json bodies). Stored in the PUBLIC Supabase
 * Storage bucket `craft-items`; the persisted config keeps only the public URL.
 */
import { raw, Router, type Request, type Response } from 'express';
import { requireSupabaseAdmin } from '../auth/supabaseAuth.js';
import {
  classifyCraftEntityId,
  validateCraftItemConfig,
  validateCraftRecipeConfig,
  type CraftIngredient,
  type CraftItemConfig,
  type CraftRecipeConfig,
} from '../shared/craft/CraftShapes.js';
import { getServiceClient, PERSISTENCE_UNAVAILABLE } from '../rigs/serviceSupabase.js';
import {
  CRAFT_TABLES_SQL,
  deleteCraftItem,
  deleteCraftRecipe,
  getCraftItemsCached,
  getCraftRecipesCached,
  listCraftItems,
  listCraftRecipes,
  saveCraftItem,
  saveCraftRecipe,
} from './craftRepository.js';

const IMAGE_BUCKET = 'craft-items';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * O Content-Type declarado é entrada do cliente — nunca confiável. O bucket é
 * PÚBLICO, então só sobem bytes cuja assinatura binária bate com o formato
 * declarado (evita hospedar conteúdo arbitrário disfarçado de imagem).
 */
function sniffImageFormat(bytes: Buffer): 'png' | 'jpeg' | 'webp' | 'gif' | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 6) {
    const head = bytes.subarray(0, 6).toString('latin1');
    if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

function badItemId(res: Response, itemId: string): boolean {
  // Craft items são SEMPRE 'custom' — recusa refs gen:, chaves de recurso
  // reservadas (ex.: "bush") e qualquer slug fora do padrão.
  if (classifyCraftEntityId(itemId) === 'custom') return false;
  res.status(400).json({
    error: `itemId inválido: "${itemId}" (slug minúsculo, sem colidir com chaves de recurso)`,
  });
  return true;
}

function badTargetId(res: Response, targetId: string): boolean {
  // Alvo de receita: QUALQUER item do jogo (ref gen:, recurso ou craft item).
  if (classifyCraftEntityId(targetId) !== null) return false;
  res.status(400).json({ error: `targetId inválido: "${targetId}"` });
  return true;
}

function writeFailed(res: Response, result: { tableMissing: boolean; error: string | null }): void {
  if (result.tableMissing) {
    res.status(503).json({ error: 'Tabelas de craft ausentes no Supabase', tableMissing: true, tableSql: CRAFT_TABLES_SQL });
    return;
  }
  res.status(500).json({ error: result.error ?? 'Falha ao persistir' });
}

// Bucket creation is idempotent and lazy — first upload ensures it exists.
let bucketEnsured = false;
async function ensureImageBucket(): Promise<string | null> {
  if (bucketEnsured) return null;
  const client = getServiceClient();
  if (!client) return PERSISTENCE_UNAVAILABLE;
  const { error } = await client.storage.createBucket(IMAGE_BUCKET, { public: true });
  if (error && !/exist/i.test(error.message)) return error.message;
  bucketEnsured = true;
  return null;
}

// ------------------------------------------------------------- admin: items

export const craftItemsAdminRouter = Router();
craftItemsAdminRouter.use(requireSupabaseAdmin);

craftItemsAdminRouter.get('/', async (_req: Request, res: Response) => {
  const result = await listCraftItems();
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({
    items: result.records,
    updatedAt: result.updatedAt,
    tableMissing: result.tableMissing,
    invalidIds: result.invalidIds,
    ...(result.tableMissing ? { tableSql: CRAFT_TABLES_SQL } : {}),
  });
});

craftItemsAdminRouter.put('/:itemId', async (req: Request, res: Response) => {
  const itemId = String(req.params.itemId ?? '');
  if (badItemId(res, itemId)) return;
  const validated = validateCraftItemConfig(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: 'CraftItemConfig inválido', details: validated.errors });
    return;
  }
  const body = req.body as CraftItemConfig;
  if (body.itemId !== itemId) {
    res.status(400).json({ error: `itemId do corpo ("${body.itemId}") difere da URL ("${itemId}")` });
    return;
  }
  // Normalized copy — never persist unknown fields into the jsonb.
  const config: CraftItemConfig = {
    itemId,
    name: body.name.trim(),
    imageUrl: body.imageUrl ?? null,
    repairsItemId: body.repairsItemId ?? null,
  };
  const result = await saveCraftItem(config);
  if (!result.ok) {
    writeFailed(res, result);
    return;
  }
  res.json({ item: config });
});

craftItemsAdminRouter.delete('/:itemId', async (req: Request, res: Response) => {
  const itemId = String(req.params.itemId ?? '');
  if (badItemId(res, itemId)) return;
  // Never orphan recipes silently: block deletion while recipes reference it.
  const recipes = await listCraftRecipes();
  if (recipes.error) {
    res.status(500).json({ error: recipes.error });
    return;
  }
  const usedBy = Object.values(recipes.records)
    .filter((r) => r.ingredients.some((i) => i.itemId === itemId))
    .map((r) => r.targetId)
    .sort();
  if (usedBy.length > 0) {
    res.status(409).json({
      error: `Item "${itemId}" está em uso por ${usedBy.length} receita(s)`,
      usedBy,
    });
    return;
  }
  // A receita do PRÓPRIO item morre junto (antes do item, para nunca deixar
  // órfã invisível que "ressuscitaria" se o mesmo slug fosse recriado).
  if (recipes.records[itemId] !== undefined) {
    const recipeGone = await deleteCraftRecipe(itemId);
    if (!recipeGone.ok) {
      writeFailed(res, recipeGone);
      return;
    }
  }
  const result = await deleteCraftItem(itemId);
  if (!result.ok) {
    writeFailed(res, result);
    return;
  }
  // Best-effort icon cleanup — storage junk must not fail the delete.
  try {
    const client = getServiceClient();
    if (client) {
      const { data } = await client.storage.from(IMAGE_BUCKET).list('items', { search: `${itemId}-` });
      const stale = (data ?? []).filter((f) => f.name.startsWith(`${itemId}-`)).map((f) => `items/${f.name}`);
      if (stale.length > 0) await client.storage.from(IMAGE_BUCKET).remove(stale);
    }
  } catch {
    /* ignore */
  }
  res.json({ ok: true });
});

// Bytes crus com Content-Type image/* — raw() só intercepta esses MIMEs, e o
// express.json() embutido do @colyseus/tools (100kb) ignora corpos não-JSON,
// então o limite real aqui é o MAX_IMAGE_BYTES do raw() (413 além dele).
craftItemsAdminRouter.post(
  '/:itemId/image',
  raw({ type: IMAGE_MIME_TYPES, limit: MAX_IMAGE_BYTES }),
  async (req: Request, res: Response) => {
  const itemId = String(req.params.itemId ?? '');
  if (badItemId(res, itemId)) return;
  if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
    res.status(400).json({
      error:
        'Envie os bytes do arquivo direto no corpo da requisição, com Content-Type image/png, image/jpeg, image/webp ou image/gif',
    });
    return;
  }
  const bytes = req.body as Buffer;
  const declared = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const sniffed = sniffImageFormat(bytes);
  if (!sniffed || `image/${sniffed}` !== declared) {
    res.status(400).json({
      error: 'Os bytes do arquivo não correspondem ao formato declarado — envie uma imagem PNG, JPEG, WEBP ou GIF real',
    });
    return;
  }
  const ext = sniffed === 'jpeg' ? 'jpg' : sniffed;
  const bucketError = await ensureImageBucket();
  if (bucketError) {
    res.status(500).json({ error: `Storage indisponível: ${bucketError}` });
    return;
  }
  const client = getServiceClient();
  if (!client) {
    res.status(500).json({ error: PERSISTENCE_UNAVAILABLE });
    return;
  }
  // Timestamped name = CDN-cache-proof replacement; drop older icons first.
  try {
    const { data } = await client.storage.from(IMAGE_BUCKET).list('items', { search: `${itemId}-` });
    const stale = (data ?? []).filter((f) => f.name.startsWith(`${itemId}-`)).map((f) => `items/${f.name}`);
    if (stale.length > 0) await client.storage.from(IMAGE_BUCKET).remove(stale);
  } catch {
    /* ignore */
  }
  const path = `items/${itemId}-${Date.now()}.${ext}`;
  const upload = await client.storage.from(IMAGE_BUCKET).upload(path, bytes, {
    contentType: `image/${sniffed}`,
    upsert: true,
  });
  if (upload.error) {
    res.status(500).json({ error: `Upload falhou: ${upload.error.message}` });
    return;
  }
  const { data: pub } = client.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  res.json({ imageUrl: pub.publicUrl });
  },
);

// ----------------------------------------------------------- admin: recipes

export const craftRecipesAdminRouter = Router();
craftRecipesAdminRouter.use(requireSupabaseAdmin);

craftRecipesAdminRouter.get('/', async (_req: Request, res: Response) => {
  const result = await listCraftRecipes();
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({
    recipes: result.records,
    updatedAt: result.updatedAt,
    tableMissing: result.tableMissing,
    invalidIds: result.invalidIds,
    ...(result.tableMissing ? { tableSql: CRAFT_TABLES_SQL } : {}),
  });
});

craftRecipesAdminRouter.put('/:targetId', async (req: Request, res: Response) => {
  const targetId = String(req.params.targetId ?? '');
  if (badTargetId(res, targetId)) return;
  // Unknown ingredient refs are rejected — never silently accepted.
  const items = await listCraftItems();
  if (items.error) {
    res.status(500).json({ error: items.error });
    return;
  }
  if (items.tableMissing) {
    res.status(503).json({ error: 'Tabelas de craft ausentes no Supabase', tableMissing: true, tableSql: CRAFT_TABLES_SQL });
    return;
  }
  const validated = validateCraftRecipeConfig(req.body, new Set(Object.keys(items.records)));
  if (!validated.ok) {
    res.status(400).json({ error: 'CraftRecipeConfig inválido', details: validated.errors });
    return;
  }
  const body = req.body as CraftRecipeConfig;
  if (body.targetId !== targetId) {
    res.status(400).json({ error: `targetId do corpo ("${body.targetId}") difere da URL ("${targetId}")` });
    return;
  }
  const config: CraftRecipeConfig = {
    targetId,
    ingredients: body.ingredients.map(
      (i): CraftIngredient => ({ itemId: i.itemId, quantity: i.quantity }),
    ),
    // Sempre explícito no jsonb — "ausente = 1" fica só para registros legados.
    outputQuantity: body.outputQuantity ?? 1,
  };
  const result = await saveCraftRecipe(config);
  if (!result.ok) {
    writeFailed(res, result);
    return;
  }
  // TOCTOU com DELETE de item: um item pode ser excluído entre a validação
  // acima e o upsert (o scan do DELETE não vê a receita ainda não salva).
  // Re-checa e desfaz o save se alguma referência morreu no meio do caminho.
  // (Janela residual mínima é aceita — refs vivem em jsonb, sem transação.)
  const recheck = await listCraftItems();
  if (!recheck.error && !recheck.tableMissing) {
    const missing = config.ingredients.filter(
      (i) => classifyCraftEntityId(i.itemId) === 'custom' && recheck.records[i.itemId] === undefined,
    );
    if (missing.length > 0) {
      await deleteCraftRecipe(targetId);
      res.status(409).json({
        error: `Item(ns) excluído(s) durante o salvamento: ${missing.map((m) => m.itemId).join(', ')} — receita não salva`,
        details: missing.map((m) => m.itemId),
      });
      return;
    }
  }
  res.json({ recipe: config });
});

craftRecipesAdminRouter.delete('/:targetId', async (req: Request, res: Response) => {
  const targetId = String(req.params.targetId ?? '');
  if (badTargetId(res, targetId)) return;
  const result = await deleteCraftRecipe(targetId);
  if (!result.ok) {
    writeFailed(res, result);
    return;
  }
  res.json({ ok: true });
});

// ------------------------------------------------------------------ public

/** Read-only cached snapshot for game clients (future player craft panel). */
export async function publicCraftDataHandler(_req: Request, res: Response): Promise<void> {
  const [items, recipes] = await Promise.all([getCraftItemsCached(), getCraftRecipesCached()]);
  res.json({ items, recipes });
}
