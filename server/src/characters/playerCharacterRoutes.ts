/**
 * Personagem do jogador — superfície HTTP.
 *
 *   GET /api/me/character → { character: PlayerCharacterConfigV1 | null }
 *   PUT /api/me/character → cria/atualiza { classId, appearance }
 *
 * Ambas exigem Supabase JWT (o dono é o usuário autenticado — nunca vem do
 * corpo). A PERMISSÃO de aparência é validada contra as refs da categoria
 * `default-character` (assets-controller). A arma equipada NÃO é editável
 * aqui: quem equipa é a sala (mensagem `equip_weapon`), validando a arma
 * padrão da classe; num re-save da aparência ela é preservada se a classe
 * não mudou.
 */
import { Router, type Request, type Response } from 'express';
import { requireSupabaseAuth } from '../auth/supabaseAuth.js';
import {
  DEFAULT_CHARACTER_CATEGORY_ID,
  isPlayerClassId,
  validateAppearanceAgainstRefs,
  validateCharacterAppearance,
  type PlayerCharacterConfigV1,
} from '../shared/characters/PlayerCharacterShapes.js';
import { getAssetCategoriesCached } from '../assets/assetCategoryRepository.js';
import {
  PLAYER_CHARACTER_TABLE_SQL,
  getPlayerCharacter,
  savePlayerCharacter,
  type PlayerCharacterWriteResult,
} from './playerCharacterRepository.js';

export const playerCharacterRouter = Router();
playerCharacterRouter.use(requireSupabaseAuth);

function authedUserId(req: Request): string {
  return (req as Request & { userId?: string }).userId ?? '';
}

function writeFailed(res: Response, result: PlayerCharacterWriteResult): void {
  if (result.tableMissing) {
    res.status(503).json({
      error: 'Tabela player_characters ausente no Supabase',
      tableMissing: true,
      tableSql: PLAYER_CHARACTER_TABLE_SQL,
    });
    return;
  }
  res.status(500).json({ error: result.error ?? 'Falha ao persistir' });
}

playerCharacterRouter.get('/', async (req: Request, res: Response) => {
  const result = await getPlayerCharacter(authedUserId(req));
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({
    character: result.config,
    ...(result.tableMissing ? { tableMissing: true, tableSql: PLAYER_CHARACTER_TABLE_SQL } : {}),
  });
});

playerCharacterRouter.put('/', async (req: Request, res: Response) => {
  const userId = authedUserId(req);
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (!isPlayerClassId(body.classId)) {
    res.status(400).json({ error: `classId inválido: "${String(body.classId)}"` });
    return;
  }
  const validated = validateCharacterAppearance(body.appearance);
  if (!validated.ok) {
    res.status(400).json({ error: 'Aparência inválida', details: validated.errors });
    return;
  }

  // Permissão: só refs liberadas na categoria default-character.
  const categories = await getAssetCategoriesCached();
  const defaultCategory = categories[DEFAULT_CHARACTER_CATEGORY_ID];
  if (!defaultCategory) {
    res.status(503).json({
      error: `Categoria "${DEFAULT_CHARACTER_CATEGORY_ID}" não configurada — crie no /admin/assets-controller`,
    });
    return;
  }
  const permissionErrors = validateAppearanceAgainstRefs(validated.appearance, defaultCategory.assetRefs);
  if (permissionErrors.length > 0) {
    res.status(400).json({ error: 'Aparência usa assets não liberados', details: permissionErrors });
    return;
  }

  // Re-save preserva a arma equipada quando a classe não muda.
  const existing = await getPlayerCharacter(userId);
  if (existing.error) {
    res.status(500).json({ error: existing.error });
    return;
  }
  const equippedWeapon =
    existing.config && existing.config.classId === body.classId ? existing.config.equippedWeapon : null;

  const config: PlayerCharacterConfigV1 = {
    v: 1,
    classId: body.classId,
    appearance: validated.appearance,
    equippedWeapon,
  };
  const result = await savePlayerCharacter(userId, config);
  if (!result.ok) {
    writeFailed(res, result);
    return;
  }
  res.json({ character: config });
});
