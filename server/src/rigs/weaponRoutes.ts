/**
 * Weapon catalog HTTP surface (spec §25).
 *
 * Admin (Supabase JWT required, spec §19):
 *   - /api/admin/weapon-families           GET, PUT /:familyId
 *   - /api/admin/weapon-hitbox-profiles    GET, POST, GET/PUT/DELETE /:profileId
 * Public (read-only, cached, for game clients):
 *   - GET /api/weapon-families                     → association map
 *   - GET /api/weapon-hitbox-profiles/:profileId   → validated profile
 *
 * The server never trusts client-sent profile ids/damage for combat — combat
 * resolution reads profiles through the repository (server authority).
 */
import { Router, type Request, type Response } from 'express';
import { requireSupabaseAuth } from '../auth/supabaseAuth.js';
import {
  WEAPON_FAMILY_ID_RE,
  WEAPON_PROFILE_ID_RE,
  validateWeaponFamilyConfig,
  validateWeaponHitboxProfile,
  weaponFamiliesUsingProfile,
  type WeaponHitboxProfile,
  type WeaponVariantConfig,
} from '../shared/combat/WeaponShapes.js';
import { getRig } from './rigConfigRepository.js';
import {
  WEAPON_FAMILY_TABLE_SQL,
  getWeaponFamiliesCached,
  listWeaponFamilies,
  saveWeaponFamily,
} from './weaponFamilyRepository.js';
import {
  WEAPON_PROFILE_TABLE_SQL,
  deleteWeaponProfile,
  getWeaponProfile,
  getWeaponProfileCached,
  listWeaponProfiles,
  saveWeaponProfile,
} from './weaponProfileRepository.js';

function badFamilyId(res: Response, familyId: string): boolean {
  if (WEAPON_FAMILY_ID_RE.test(familyId)) return false;
  res.status(400).json({ error: `familyId inválido: "${familyId}"` });
  return true;
}

function badProfileId(res: Response, profileId: string): boolean {
  if (WEAPON_PROFILE_ID_RE.test(profileId)) return false;
  res.status(400).json({ error: `profileId inválido: "${profileId}" (use minúsculas, números e hífens)` });
  return true;
}

/**
 * Validates a profile body structurally AND against its rig (spec §27).
 * Returns null after writing the error response when invalid.
 */
async function validateProfileBody(req: Request, res: Response): Promise<WeaponHitboxProfile | null> {
  const structural = validateWeaponHitboxProfile(req.body);
  if (!structural.ok) {
    res.status(400).json({ error: 'WeaponHitboxProfile inválido', details: structural.errors });
    return null;
  }
  const rigResult = await getRig(structural.config.rigId);
  if (rigResult.error) {
    res.status(500).json({ error: `Falha ao carregar o rig "${structural.config.rigId}": ${rigResult.error}` });
    return null;
  }
  if (!rigResult.rig) {
    res.status(400).json({
      error: `rigId: rig "${structural.config.rigId}" não existe — perfil sem rig válido não é permitido`,
    });
    return null;
  }
  const crossChecked = validateWeaponHitboxProfile(req.body, rigResult.rig);
  if (!crossChecked.ok) {
    res.status(400).json({ error: 'Perfil incompatível com o rig', details: crossChecked.errors });
    return null;
  }
  return crossChecked.config;
}

// ------------------------------------------------------------ admin: families

export const weaponFamiliesAdminRouter = Router();
weaponFamiliesAdminRouter.use(requireSupabaseAuth);

// Full catalog (only explicitly configured families have rows).
weaponFamiliesAdminRouter.get('/', async (_req: Request, res: Response) => {
  const result = await listWeaponFamilies();
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({
    families: result.families,
    updatedAt: result.updatedAt,
    tableMissing: result.tableMissing,
    invalidIds: result.invalidIds,
    ...(result.tableMissing ? { tableSql: WEAPON_FAMILY_TABLE_SQL } : {}),
  });
});

// Upsert one family (association / display name). Association to a
// non-existent profile is rejected — never silently accepted (spec §27).
weaponFamiliesAdminRouter.put('/:familyId', async (req: Request, res: Response) => {
  const familyId = String(req.params.familyId ?? '');
  if (badFamilyId(res, familyId)) return;
  const validated = validateWeaponFamilyConfig(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: 'WeaponFamilyConfig inválido', details: validated.errors });
    return;
  }
  if (validated.config.familyId !== familyId) {
    res.status(400).json({ error: `familyId do corpo ("${validated.config.familyId}") difere da URL ("${familyId}")` });
    return;
  }

  const profileId = validated.config.weaponHitboxProfileId;
  if (profileId !== null) {
    const profile = await getWeaponProfile(profileId);
    if (profile.error) {
      res.status(500).json({ error: profile.error });
      return;
    }
    if (profile.tableMissing) {
      res.status(503).json({
        error: 'Tabela weapon_hitbox_profiles não existe no Supabase',
        tableMissing: true,
        tableSql: WEAPON_PROFILE_TABLE_SQL,
      });
      return;
    }
    if (!profile.profile) {
      res.status(400).json({ error: `Associação inválida: perfil "${profileId}" não existe` });
      return;
    }
  }

  const write = await saveWeaponFamily(validated.config);
  if (write.tableMissing) {
    res.status(503).json({
      error: 'Tabela weapon_families não existe no Supabase',
      tableMissing: true,
      tableSql: WEAPON_FAMILY_TABLE_SQL,
    });
    return;
  }
  if (!write.ok) {
    res.status(500).json({ error: write.error ?? 'Falha ao salvar a família' });
    return;
  }
  res.json({ family: validated.config });
});

// ------------------------------------------------------------ admin: profiles

export const weaponProfilesAdminRouter = Router();
weaponProfilesAdminRouter.use(requireSupabaseAuth);

weaponProfilesAdminRouter.get('/', async (_req: Request, res: Response) => {
  const result = await listWeaponProfiles();
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({
    profiles: result.profiles,
    updatedAt: result.updatedAt,
    tableMissing: result.tableMissing,
    invalidIds: result.invalidIds,
    ...(result.tableMissing ? { tableSql: WEAPON_PROFILE_TABLE_SQL } : {}),
  });
});

// Create (fails on duplicate ID).
weaponProfilesAdminRouter.post('/', async (req: Request, res: Response) => {
  const profile = await validateProfileBody(req, res);
  if (!profile) return;
  const write = await saveWeaponProfile(profile, { mustNotExist: true });
  if (write.tableMissing) {
    res.status(503).json({
      error: 'Tabela weapon_hitbox_profiles não existe no Supabase',
      tableMissing: true,
      tableSql: WEAPON_PROFILE_TABLE_SQL,
    });
    return;
  }
  if (write.conflict) {
    res.status(409).json({ error: `Já existe um perfil com o ID "${profile.id}"` });
    return;
  }
  if (!write.ok) {
    res.status(500).json({ error: write.error ?? 'Falha ao salvar o perfil' });
    return;
  }
  res.status(201).json({ profile });
});

weaponProfilesAdminRouter.get('/:profileId', async (req: Request, res: Response) => {
  const profileId = String(req.params.profileId ?? '');
  if (badProfileId(res, profileId)) return;
  const result = await getWeaponProfile(profileId);
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  if (!result.profile) {
    res.status(404).json({
      error: `Perfil "${profileId}" não encontrado`,
      tableMissing: result.tableMissing,
      ...(result.tableMissing ? { tableSql: WEAPON_PROFILE_TABLE_SQL } : {}),
    });
    return;
  }
  res.json({ profile: result.profile });
});

weaponProfilesAdminRouter.put('/:profileId', async (req: Request, res: Response) => {
  const profileId = String(req.params.profileId ?? '');
  if (badProfileId(res, profileId)) return;
  const profile = await validateProfileBody(req, res);
  if (!profile) return;
  if (profile.id !== profileId) {
    res.status(400).json({ error: `id do corpo ("${profile.id}") difere da URL ("${profileId}")` });
    return;
  }
  const write = await saveWeaponProfile(profile);
  if (write.tableMissing) {
    res.status(503).json({
      error: 'Tabela weapon_hitbox_profiles não existe no Supabase',
      tableMissing: true,
      tableSql: WEAPON_PROFILE_TABLE_SQL,
    });
    return;
  }
  if (!write.ok) {
    res.status(500).json({ error: write.error ?? 'Falha ao salvar o perfil' });
    return;
  }
  res.json({ profile });
});

/**
 * Delete. When families still reference the profile, refuses with 409 and the
 * usage list (spec §28) — the client offers the options. `?mode=dissociate`
 * clears every association first, then deletes.
 */
weaponProfilesAdminRouter.delete('/:profileId', async (req: Request, res: Response) => {
  const profileId = String(req.params.profileId ?? '');
  if (badProfileId(res, profileId)) return;

  const familiesResult = await listWeaponFamilies();
  if (familiesResult.error) {
    res.status(500).json({ error: `Não foi possível verificar o uso do perfil: ${familiesResult.error}` });
    return;
  }
  const inUseBy = weaponFamiliesUsingProfile(familiesResult.families, profileId);
  const mode = String(req.query.mode ?? '');

  if (inUseBy.length > 0 && mode !== 'dissociate') {
    res.status(409).json({
      error: `Perfil em uso por ${inUseBy.length} família(s) de arma`,
      inUseBy,
    });
    return;
  }

  if (inUseBy.length > 0) {
    for (const familyId of inUseBy) {
      const family = familiesResult.families[familyId];
      const write = await saveWeaponFamily({ ...family, weaponHitboxProfileId: null });
      if (!write.ok) {
        res.status(500).json({
          error: `Falha ao desassociar a família "${familyId}"${write.error ? `: ${write.error}` : ''} — exclusão abortada`,
        });
        return;
      }
    }
  }

  const write = await deleteWeaponProfile(profileId);
  if (write.tableMissing) {
    res.status(503).json({
      error: 'Tabela weapon_hitbox_profiles não existe no Supabase',
      tableMissing: true,
      tableSql: WEAPON_PROFILE_TABLE_SQL,
    });
    return;
  }
  if (!write.ok) {
    res.status(500).json({ error: write.error ?? 'Falha ao excluir o perfil' });
    return;
  }
  // Varredura pós-delete (TOCTOU): uma associação pode ter sido gravada entre
  // a checagem acima e o delete. Sem transação via PostgREST, limpamos agora
  // qualquer referência pendurada remanescente (melhor esforço; o cliente do
  // jogo tolera referência pendurada tratando 404 como "sem hitboxes").
  const dissociated = [...inUseBy];
  const recheck = await listWeaponFamilies();
  if (!recheck.error) {
    for (const familyId of weaponFamiliesUsingProfile(recheck.families, profileId)) {
      const family = recheck.families[familyId];
      if (!family) continue;
      const sweep = await saveWeaponFamily({ ...family, weaponHitboxProfileId: null });
      if (sweep.ok) dissociated.push(familyId);
    }
  }
  res.json({ ok: true, dissociated });
});

// ------------------------------------------------------------ public handlers

/** GET /api/weapon-families — familyId → { weaponHitboxProfileId } (cached). */
export async function publicWeaponFamiliesHandler(_req: Request, res: Response): Promise<void> {
  const map = await getWeaponFamiliesCached();
  const families: Record<
    string,
    { weaponHitboxProfileId: string | null; variants?: Record<string, WeaponVariantConfig> }
  > = {};
  for (const [familyId, config] of Object.entries(map)) {
    families[familyId] = {
      weaponHitboxProfileId: config.weaponHitboxProfileId,
      // Levels por item (dano/velocidade) viajam no endpoint público: o
      // cliente do jogo usa a velocidade na animação; o dano autoritativo
      // continua sendo resolvido pelo servidor via repositório.
      ...(config.variants ? { variants: config.variants } : {}),
    };
  }
  res.json({ families });
}

/** GET /api/weapon-hitbox-profiles/:profileId — validated profile (cached). */
export async function publicWeaponProfileHandler(req: Request, res: Response): Promise<void> {
  const profileId = String(req.params.profileId ?? '');
  if (!WEAPON_PROFILE_ID_RE.test(profileId)) {
    res.status(400).json({ error: 'profileId inválido' });
    return;
  }
  const profile = await getWeaponProfileCached(profileId);
  if (!profile) {
    res.status(404).json({ error: `Nenhum perfil válido para "${profileId}"` });
    return;
  }
  res.json(profile);
}
