/**
 * "Perfil de Hitbox da Arma" — the weapon-profile section of /admin/rigs
 * (spec §9/§13/§16). Hitboxes/damage live in WeaponHitboxProfiles associated
 * to weapon FAMILIES; this panel owns:
 *   - profile CRUD (create/duplicate/rename via page callbacks) + selection
 *   - combat metadata editing (enabled/damagePerHit/singleHitPerTarget)
 *   - family ↔ profile association for the family equipped in the preview
 *   - the rig's explicit fallback profile (defaultWeaponHitboxProfileId)
 *   - the discovered-families list (manifest scan + persisted associations)
 *
 * All mutations are delegated to the page (which owns undo/dirty/save state).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Link2,
  Link2Off,
  Loader2,
  Plus,
  Save,
  Swords,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { LocalRectangle, RigConfig, RigDirection } from '../../../shared/combat/RigShapes';
import {
  DEFAULT_ARROW_RANGE_PX,
  DEFAULT_WEAPON_DAMAGE,
  DEFAULT_WEAPON_SPEED,
  MAX_ARROW_RANGE_PX,
  MIN_ARROW_RANGE_PX,
  WEAPON_PROFILE_ID_RE,
  countWeaponProfileRects,
  getWeaponVariantLevels,
  getWeaponVariantProjectile,
  rotateRectClockwise,
  weaponFamiliesUsingProfile,
  type WeaponFamilyConfig,
  type WeaponFamilyManifestEntry,
  type WeaponHitboxProfile,
  type WeaponLevelStats,
  type WeaponProjectileConfig,
} from '../../../shared/combat/WeaponShapes';

export interface PreviewWeapon {
  familyId: string;
  variantId: string;
  assetId: string;
}

interface WeaponProfilePanelProps {
  rig: RigConfig;
  profiles: WeaponHitboxProfile[];
  families: Record<string, WeaponFamilyConfig>;
  catalog: WeaponFamilyManifestEntry[];
  workingProfile: WeaponHitboxProfile | null;
  profileDirty: boolean;
  previewWeapon: PreviewWeapon | null;
  /** Current editor animation — used for the mismatch hint. */
  animId: string;
  busy: boolean;
  weaponTablesMissing: boolean;
  error: string | null;
  onSelectProfile: (profileId: string | null) => void;
  onCreateProfile: (opts: { id: string; displayName: string; animationId: string; duplicate: boolean }) => void;
  onDeleteProfile: () => void;
  onMutateProfile: (
    fn: (p: WeaponHitboxProfile) => void,
    opts?: { undo?: 'push' | 'coalesce' | 'skip' },
  ) => void;
  onChangeProfileAnimation: (animationId: string) => void;
  onAssociateFamily: (familyId: string, profileId: string | null) => void;
  /** Salva os levels do item selecionado; resolve true quando persistiu. */
  onSaveVariantLevels: (
    familyId: string,
    variantId: string,
    levels: WeaponLevelStats[],
  ) => Promise<boolean>;
  /** Arma de DISPARO no preview (arco)? Esconde o perfil melee e edita a flecha. */
  isShooter: boolean;
  /** Família do projétil pareado (ex.: "arrow") quando isShooter. */
  projectileFamilyId: string | null;
  /** Salva alcance/hitbox do projétil da variação da flecha; true quando persistiu. */
  onSaveVariantProjectile: (
    familyId: string,
    variantId: string,
    projectile: WeaponProjectileConfig,
  ) => Promise<boolean>;
  /** Incrementado a cada recarga dos dados de arma — descarta rascunhos obsoletos. */
  weaponDataEpoch: number;
  onSetRigDefaultProfile: (profileId: string | null) => void;
  onGoToProfileAnimation: () => void;
}

const sectionCls = 'border border-slate-800 rounded-lg p-3 bg-slate-900/60';
const titleCls = 'text-[11px] uppercase tracking-wider text-slate-500 font-semibold';
const btnCls =
  'inline-flex items-center gap-1.5 px-2 py-1.5 rounded border text-xs font-medium transition-colors disabled:opacity-30 disabled:pointer-events-none';
const neutralBtn = `${btnCls} border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white`;
const fieldCls =
  'bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono';

/** Direções (linhas) das folhas de 4 direções — ordem de exibição no editor. */
const ARROW_DIRS: readonly RigDirection[] = ['south', 'west', 'east', 'north'];
const ARROW_DIR_LABELS: Record<RigDirection, string> = {
  south: 'Baixo (sul)',
  west: 'Esquerda (oeste)',
  east: 'Direita (leste)',
  north: 'Cima (norte)',
};

/** Hitbox padrão da flecha: fina no eixo do voo (mesma usada no runtime). */
function defaultArrowRect(dir: RigDirection): LocalRectangle {
  return dir === 'west' || dir === 'east'
    ? { id: 'arrow', x: -12, y: -4, width: 24, height: 8 }
    : { id: 'arrow', x: -4, y: -12, width: 8, height: 24 };
}

/** Config editável do projétil: preenche defaults (alcance + 4 direções). */
function normalizeProjectile(saved: WeaponProjectileConfig | null): WeaponProjectileConfig {
  const hitbox: Partial<Record<RigDirection, LocalRectangle>> = {};
  for (const dir of ARROW_DIRS) hitbox[dir] = saved?.hitbox?.[dir] ?? defaultArrowRect(dir);
  return { rangePx: saved?.rangePx ?? DEFAULT_ARROW_RANGE_PX, hitbox };
}

/** Input numérico que só commita valores válidos (permite digitação parcial). */
function NumField(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  integer?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
  onCommit: (v: number) => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  return (
    <input
      type="number"
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      value={raw ?? String(props.value)}
      disabled={props.disabled}
      title={props.title}
      onChange={(e) => {
        const text = e.target.value;
        setRaw(text);
        if (text.trim() === '') return;
        const v = Number(text);
        if (!Number.isFinite(v)) return;
        if (props.integer && !Number.isInteger(v)) return;
        props.onCommit(Math.max(props.min, Math.min(props.max, v)));
      }}
      onBlur={() => setRaw(null)}
      className={props.className}
    />
  );
}

export function WeaponProfilePanel(props: WeaponProfilePanelProps) {
  const {
    rig,
    profiles,
    families,
    catalog,
    workingProfile,
    profileDirty,
    previewWeapon,
    animId,
    busy,
  } = props;

  const [createMode, setCreateMode] = useState<null | 'new' | 'duplicate'>(null);
  const [createId, setCreateId] = useState('');
  const [createName, setCreateName] = useState('');
  const [createAnim, setCreateAnim] = useState('attack');
  const [createError, setCreateError] = useState<string | null>(null);
  const [showFamilies, setShowFamilies] = useState(false);
  /** Rascunhos de levels por item (assetId) — nada persiste até "Salvar níveis". */
  const [levelDrafts, setLevelDrafts] = useState<Record<string, WeaponLevelStats[]>>({});
  /** Texto cru dos inputs numéricos (permite digitar/apagar sem o valor "pular"). */
  const [rawLevelInputs, setRawLevelInputs] = useState<Record<string, string>>({});
  /** Rascunhos do PROJÉTIL (flecha) por item do preview — idem, até "Salvar". */
  const [projDrafts, setProjDrafts] = useState<Record<string, WeaponProjectileConfig>>({});

  // Recarga dos dados de arma (Recarregar/migração/reabertura): rascunhos
  // antigos são descartados para não sobrescrever mudanças vindas do servidor.
  useEffect(() => {
    setLevelDrafts({});
    setRawLevelInputs({});
    setProjDrafts({});
  }, [props.weaponDataEpoch]);

  const animNames = useMemo(() => Object.keys(rig.animations), [rig]);

  const { isShooter, projectileFamilyId } = props;
  const previewFamilyConfig = previewWeapon ? (families[previewWeapon.familyId] ?? null) : null;
  const familyProfileId = previewFamilyConfig?.weaponHitboxProfileId ?? null;
  const rigDefaultId = rig.defaultWeaponHitboxProfileId ?? null;
  /** Where the resolved profile of the equipped weapon comes from (spec §18). */
  const resolvedSource: 'family' | 'rig-default' | 'none' = previewWeapon
    ? familyProfileId
      ? 'family'
      : rigDefaultId
        ? 'rig-default'
        : 'none'
    : 'none';

  const usedBy = workingProfile ? weaponFamiliesUsingProfile(families, workingProfile.id) : [];
  const rectCount = workingProfile ? countWeaponProfileRects(workingProfile) : 0;

  // ---- Levels do item selecionado (dano/velocidade POR ITEM da família) ----
  /**
   * ALVO das estatísticas: numa arma de disparo, dano/alcance/hitbox moram na
   * FLECHA pareada (mesma variação/material do arco); senão, no próprio item.
   * Rascunhos continuam chaveados pelo assetId do PREVIEW (único por item).
   */
  const statsTarget = previewWeapon
    ? isShooter && projectileFamilyId
      ? { familyId: projectileFamilyId, variantId: previewWeapon.variantId }
      : { familyId: previewWeapon.familyId, variantId: previewWeapon.variantId }
    : null;
  const statsFamilyConfig = statsTarget ? (families[statsTarget.familyId] ?? null) : null;
  const resolvedProfileForSeed = (() => {
    const id = familyProfileId ?? rigDefaultId;
    return id ? (profiles.find((p) => p.id === id) ?? null) : null;
  })();
  /** Dano-semente de item sem levels salvos: perfil resolvido (melee), senão 10. */
  const seedDamage = isShooter
    ? DEFAULT_WEAPON_DAMAGE
    : (resolvedProfileForSeed?.combat.damagePerHit ?? DEFAULT_WEAPON_DAMAGE);
  const baselineLevels: WeaponLevelStats[] = statsTarget
    ? getWeaponVariantLevels(statsFamilyConfig, statsTarget.variantId, seedDamage)
    : [];
  const draftLevels: WeaponLevelStats[] = previewWeapon
    ? (levelDrafts[previewWeapon.assetId] ?? baselineLevels)
    : [];
  const levelsDirty =
    previewWeapon !== null && JSON.stringify(draftLevels) !== JSON.stringify(baselineLevels);

  const setLevelDraft = (assetId: string, levels: WeaponLevelStats[]) =>
    setLevelDrafts((prev) => ({ ...prev, [assetId]: levels }));

  const mutateDraftLevel = (index: number, patch: Partial<WeaponLevelStats>) => {
    if (!previewWeapon) return;
    setLevelDraft(
      previewWeapon.assetId,
      draftLevels.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  };

  const clearLevelDraft = (assetId: string) => {
    setLevelDrafts((prev) => {
      const next = { ...prev };
      delete next[assetId];
      return next;
    });
    setRawLevelInputs((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) if (!k.startsWith(`${assetId}:`)) next[k] = v;
      return next;
    });
  };

  const rawKey = (assetId: string, level: number, field: 'damage' | 'speed') =>
    `${assetId}:${level}:${field}`;

  /** Commit do input numérico: aceita só número válido; clamp; ignora parcial. */
  const commitLevelNumber = (index: number, field: 'damage' | 'speed', raw: string) => {
    if (raw.trim() === '') return;
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    if (field === 'damage') {
      if (!Number.isInteger(v)) return;
      mutateDraftLevel(index, { damage: Math.max(0, Math.min(1000, v)) });
    } else {
      mutateDraftLevel(index, { speed: Math.max(0.1, Math.min(10, v)) });
    }
  };

  const handleSaveLevels = async () => {
    if (!previewWeapon || !statsTarget) return;
    const ok = await props.onSaveVariantLevels(
      statsTarget.familyId,
      statsTarget.variantId,
      draftLevels,
    );
    if (ok) clearLevelDraft(previewWeapon.assetId);
  };

  // ---- Projétil (flecha) do item de disparo: alcance + hitbox por direção ----
  const savedProjectile =
    isShooter && statsTarget ? getWeaponVariantProjectile(statsFamilyConfig, statsTarget.variantId) : null;
  const baselineProj = normalizeProjectile(savedProjectile);
  const draftProj = previewWeapon ? (projDrafts[previewWeapon.assetId] ?? baselineProj) : baselineProj;
  const projDirty =
    isShooter && previewWeapon !== null && JSON.stringify(draftProj) !== JSON.stringify(baselineProj);

  const setProjDraft = (cfg: WeaponProjectileConfig) => {
    if (!previewWeapon) return;
    setProjDrafts((prev) => ({ ...prev, [previewWeapon.assetId]: cfg }));
  };
  const clearProjDraft = () => {
    if (!previewWeapon) return;
    setProjDrafts((prev) => {
      const next = { ...prev };
      delete next[previewWeapon.assetId];
      return next;
    });
  };
  const mutateProjRect = (dir: RigDirection, patch: Partial<LocalRectangle>) => {
    const rect = { ...(draftProj.hitbox?.[dir] ?? defaultArrowRect(dir)), ...patch };
    setProjDraft({ ...draftProj, hitbox: { ...draftProj.hitbox, [dir]: rect } });
  };
  /** Copia a hitbox do SUL girando 90°: oeste=rot(sul), norte=rot(oeste), leste=rot(norte). */
  const rotateFromSouth = () => {
    const south = draftProj.hitbox?.south ?? defaultArrowRect('south');
    const west = rotateRectClockwise(south);
    const north = rotateRectClockwise(west);
    const east = rotateRectClockwise(north);
    setProjDraft({ ...draftProj, hitbox: { south, west, north, east } });
  };
  const handleSaveProjectile = async () => {
    if (!previewWeapon || !statsTarget) return;
    const ok = await props.onSaveVariantProjectile(statsTarget.familyId, statsTarget.variantId, draftProj);
    if (ok) clearProjDraft();
  };

  const openCreate = (duplicate: boolean) => {
    setCreateMode(duplicate ? 'duplicate' : 'new');
    setCreateError(null);
    if (duplicate && workingProfile) {
      setCreateId(`${workingProfile.id}-copy`);
      setCreateName(`${workingProfile.displayName} (Cópia)`);
      setCreateAnim(workingProfile.animationId);
    } else {
      setCreateId('');
      setCreateName('');
      setCreateAnim(animNames.includes('attack') ? 'attack' : (animNames[0] ?? 'attack'));
    }
  };

  const submitCreate = () => {
    const id = createId.trim();
    if (!WEAPON_PROFILE_ID_RE.test(id)) {
      setCreateError('ID inválido: use minúsculas, números e hífens (ex.: espadas-basico).');
      return;
    }
    if (profiles.some((p) => p.id === id)) {
      setCreateError(`Já existe um perfil com o ID "${id}".`);
      return;
    }
    props.onCreateProfile({
      id,
      displayName: createName.trim() || id,
      animationId: createAnim,
      duplicate: createMode === 'duplicate',
    });
    setCreateMode(null);
  };

  const profileChip = (profileId: string | null) => {
    if (!profileId) return <span className="text-slate-600">—</span>;
    const exists = profiles.some((p) => p.id === profileId);
    return (
      <span className={`font-mono ${exists ? 'text-fuchsia-300' : 'text-red-400 line-through'}`} title={exists ? undefined : 'perfil não existe mais'}>
        {profileId}
      </span>
    );
  };

  return (
    <div className={sectionCls}>
      <div className="flex items-center gap-2">
        <Swords size={13} className="text-fuchsia-400" />
        <div className={titleCls}>Perfil de Hitbox da Arma</div>
      </div>
      <p className="text-[10px] text-slate-600 mt-1">
        Hitboxes e dano pertencem ao perfil da FAMÍLIA da arma equipada — não ao rig. Variações de cor
        (_cN) compartilham o perfil da família.
      </p>

      {props.error && (
        <div className="mt-2 border border-red-900 bg-red-950/40 rounded p-2 text-[11px] text-red-300">
          {props.error}
        </div>
      )}

      {/* Equipped weapon (from the preview) + resolution */}
      <div className="mt-2.5 border border-slate-800 rounded p-2 bg-slate-950/40 text-[11px] space-y-1">
        <div className="text-slate-400">
          Item no preview (arma/ferramenta):{' '}
          {previewWeapon ? (
            <span className="font-mono text-white">
              {previewWeapon.familyId}
              <span className="text-slate-500"> · variação {previewWeapon.variantId}</span>
            </span>
          ) : (
            <span className="text-slate-500">nenhum (categorias weapon/crafttools ocultas)</span>
          )}
        </div>
        {previewWeapon && isShooter && (
          <div className="text-emerald-300/90">
            Arma de disparo: sem perfil melee — dano, alcance e hitbox vêm da FLECHA pareada (
            <span className="font-mono">{projectileFamilyId ?? 'flecha'}</span>), editados abaixo.
          </div>
        )}
        {previewWeapon && !isShooter && (
          <div className="text-slate-400">
            Perfil resolvido:{' '}
            {resolvedSource === 'family' && (
              <>
                {profileChip(familyProfileId)} <span className="text-slate-600">(da família)</span>
              </>
            )}
            {resolvedSource === 'rig-default' && (
              <>
                {profileChip(rigDefaultId)} <span className="text-amber-500">(fallback do rig)</span>
              </>
            )}
            {resolvedSource === 'none' && (
              <span className="text-slate-500">nenhum — sem hitbox, sem dano</span>
            )}
          </div>
        )}
        {previewWeapon && !isShooter && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              className={`${btnCls} border-fuchsia-800 bg-fuchsia-950/50 text-fuchsia-300 hover:bg-fuchsia-900/50`}
              disabled={busy || !workingProfile || familyProfileId === workingProfile.id}
              onClick={() => workingProfile && props.onAssociateFamily(previewWeapon.familyId, workingProfile.id)}
              title="Associa a família da arma equipada ao perfil selecionado abaixo (salva imediatamente)"
            >
              <Link2 size={12} /> Associar família ao perfil selecionado
            </button>
            <button
              type="button"
              className={neutralBtn}
              disabled={busy || !familyProfileId}
              onClick={() => props.onAssociateFamily(previewWeapon.familyId, null)}
              title="Remove a associação da família (a família fica sem perfil próprio)"
            >
              <Link2Off size={12} /> Desassociar família
            </button>
          </div>
        )}
      </div>

      {/* Levels do ITEM selecionado — dano/velocidade por level (por variação) */}
      {previewWeapon && (
        <div className="mt-2.5 border border-sky-900/50 rounded p-2 bg-sky-950/10 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={titleCls}>{isShooter ? 'Níveis da flecha' : 'Níveis do item'}</span>
            <span className="text-[10px] font-mono text-sky-300">
              {statsTarget ? `${statsTarget.familyId}/${statsTarget.variantId}` : previewWeapon.assetId}
            </span>
            {levelsDirty && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 border border-amber-700 text-amber-300">
                não salvo
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500">
            Cada item da família tem seus próprios níveis. Sem níveis salvos vale o padrão: level 1,
            dano {seedDamage}, velocidade {DEFAULT_WEAPON_SPEED}× (velocidade normal do jogo).
          </p>
          <div className="grid grid-cols-[2.25rem_1fr_1fr_1rem] gap-1 items-center text-[10px] text-slate-500">
            <span />
            <span>dano</span>
            <span>velocidade (×)</span>
            <span />
          </div>
          {draftLevels.map((lvl, i) => (
            <div key={lvl.level} className="grid grid-cols-[2.25rem_1fr_1fr_1rem] gap-1 items-center">
              <span className="text-[10px] font-mono text-slate-400">Lv {lvl.level}</span>
              <input
                type="number" min={0} max={1000} step={1}
                value={rawLevelInputs[rawKey(previewWeapon.assetId, lvl.level, 'damage')] ?? String(lvl.damage)}
                onChange={(e) => {
                  const raw = e.target.value;
                  setRawLevelInputs((prev) => ({
                    ...prev,
                    [rawKey(previewWeapon.assetId, lvl.level, 'damage')]: raw,
                  }));
                  commitLevelNumber(i, 'damage', raw);
                }}
                onBlur={() =>
                  setRawLevelInputs((prev) => {
                    const next = { ...prev };
                    delete next[rawKey(previewWeapon.assetId, lvl.level, 'damage')];
                    return next;
                  })
                }
                className={`${fieldCls} w-full`}
                disabled={busy}
              />
              <input
                type="number" min={0.1} max={10} step={0.1}
                value={rawLevelInputs[rawKey(previewWeapon.assetId, lvl.level, 'speed')] ?? String(lvl.speed)}
                onChange={(e) => {
                  const raw = e.target.value;
                  setRawLevelInputs((prev) => ({
                    ...prev,
                    [rawKey(previewWeapon.assetId, lvl.level, 'speed')]: raw,
                  }));
                  commitLevelNumber(i, 'speed', raw);
                }}
                onBlur={() =>
                  setRawLevelInputs((prev) => {
                    const next = { ...prev };
                    delete next[rawKey(previewWeapon.assetId, lvl.level, 'speed')];
                    return next;
                  })
                }
                className={`${fieldCls} w-full`}
                disabled={busy}
              />
              {i === draftLevels.length - 1 && lvl.level > 1 ? (
                <button
                  type="button"
                  className="text-red-400 hover:text-red-300 disabled:opacity-30"
                  title="Remover o último level"
                  disabled={busy}
                  onClick={() => setLevelDraft(previewWeapon.assetId, draftLevels.slice(0, -1))}
                >
                  <Trash2 size={12} />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              className={neutralBtn}
              disabled={busy || draftLevels.length >= 99}
              onClick={() => {
                const last = draftLevels[draftLevels.length - 1];
                if (!last) return;
                setLevelDraft(previewWeapon.assetId, [
                  ...draftLevels,
                  { level: last.level + 1, damage: last.damage, speed: last.speed },
                ]);
              }}
              title="Adiciona um level copiando os valores do anterior"
            >
              <Plus size={12} /> Adicionar level
            </button>
            <button
              type="button"
              className={`${btnCls} border-sky-800 bg-sky-950/50 text-sky-300 hover:bg-sky-900/50`}
              disabled={busy || !levelsDirty || props.weaponTablesMissing}
              onClick={() => void handleSaveLevels()}
            >
              <Save size={12} /> Salvar níveis
            </button>
            {levelsDirty && (
              <button
                type="button"
                className={neutralBtn}
                disabled={busy}
                onClick={() => clearLevelDraft(previewWeapon.assetId)}
              >
                Descartar
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-600">
            O dano do level substitui o damagePerHit do perfil para ESTE item; a velocidade multiplica
            a animação de ataque quando o item estiver equipado. Salvo por item, junto da família.
          </p>
        </div>
      )}

      {/* Projétil (flecha): alcance + hitbox por direção — POR VARIAÇÃO */}
      {isShooter && previewWeapon && statsTarget && (
        <div className="mt-2.5 border border-emerald-900/50 rounded p-2 bg-emerald-950/10 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={titleCls}>Projétil (flecha)</span>
            <span className="text-[10px] font-mono text-emerald-300">
              {statsTarget.familyId}/{statsTarget.variantId}
            </span>
            {projDirty && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 border border-amber-700 text-amber-300">
                não salvo
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500">
            A flecha voa em linha reta e cai ao esgotar a distância. A hitbox é local ao sprite da
            flecha (origem no centro), por direção de voo.
          </p>
          <label className="block">
            <span className="text-[10px] text-slate-500">
              Distância do tiro (px) — {MIN_ARROW_RANGE_PX} a {MAX_ARROW_RANGE_PX}
            </span>
            <NumField
              key={`${previewWeapon.assetId}:range`}
              value={draftProj.rangePx}
              min={MIN_ARROW_RANGE_PX}
              max={MAX_ARROW_RANGE_PX}
              integer
              disabled={busy}
              className={`${fieldCls} block w-full`}
              onCommit={(v) => setProjDraft({ ...draftProj, rangePx: v })}
            />
          </label>
          <div className="grid grid-cols-[5.5rem_1fr_1fr_1fr_1fr] gap-1 items-center text-[10px] text-slate-500">
            <span />
            <span>x</span>
            <span>y</span>
            <span>larg.</span>
            <span>alt.</span>
          </div>
          {ARROW_DIRS.map((dir) => {
            const rect = draftProj.hitbox?.[dir] ?? defaultArrowRect(dir);
            return (
              <div key={dir} className="grid grid-cols-[5.5rem_1fr_1fr_1fr_1fr] gap-1 items-center">
                <span className="text-[10px] text-slate-400">{ARROW_DIR_LABELS[dir]}</span>
                <NumField
                  key={`${previewWeapon.assetId}:${dir}:x`}
                  value={rect.x}
                  min={-192}
                  max={192}
                  integer
                  disabled={busy}
                  className={`${fieldCls} w-full`}
                  onCommit={(v) => mutateProjRect(dir, { x: v })}
                />
                <NumField
                  key={`${previewWeapon.assetId}:${dir}:y`}
                  value={rect.y}
                  min={-192}
                  max={192}
                  integer
                  disabled={busy}
                  className={`${fieldCls} w-full`}
                  onCommit={(v) => mutateProjRect(dir, { y: v })}
                />
                <NumField
                  key={`${previewWeapon.assetId}:${dir}:w`}
                  value={rect.width}
                  min={1}
                  max={192}
                  integer
                  disabled={busy}
                  className={`${fieldCls} w-full`}
                  onCommit={(v) => mutateProjRect(dir, { width: v })}
                />
                <NumField
                  key={`${previewWeapon.assetId}:${dir}:h`}
                  value={rect.height}
                  min={1}
                  max={192}
                  integer
                  disabled={busy}
                  className={`${fieldCls} w-full`}
                  onCommit={(v) => mutateProjRect(dir, { height: v })}
                />
              </div>
            );
          })}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              className={neutralBtn}
              disabled={busy}
              onClick={rotateFromSouth}
              title="Copia a hitbox do Sul para as outras direções girando 90° por vez"
            >
              <Copy size={12} /> Copiar girando (a partir do Sul)
            </button>
            <button
              type="button"
              className={`${btnCls} border-emerald-800 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50`}
              disabled={busy || !projDirty || props.weaponTablesMissing}
              onClick={() => void handleSaveProjectile()}
            >
              <Save size={12} /> Salvar projétil
            </button>
            {projDirty && (
              <button type="button" className={neutralBtn} disabled={busy} onClick={clearProjDraft}>
                Descartar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Profile selector + CRUD */}
      <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
        <select
          value={workingProfile?.id ?? ''}
          onChange={(e) => props.onSelectProfile(e.target.value || null)}
          className={`${fieldCls} flex-1 min-w-[140px]`}
          disabled={busy}
        >
          <option value="">— nenhum perfil selecionado —</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName} ({p.id}) · {p.animationId}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-1.5 flex gap-1.5 flex-wrap">
        <button type="button" onClick={() => openCreate(false)} className={neutralBtn} disabled={busy || props.weaponTablesMissing}>
          <Plus size={12} /> Novo
        </button>
        <button type="button" onClick={() => openCreate(true)} className={neutralBtn} disabled={busy || !workingProfile || props.weaponTablesMissing}>
          <Copy size={12} /> Duplicar
        </button>
        <button
          type="button"
          onClick={props.onDeleteProfile}
          className={`${btnCls} border-red-800 bg-red-950/60 text-red-300 hover:bg-red-900/60`}
          disabled={busy || !workingProfile}
        >
          <Trash2 size={12} /> Excluir
        </button>
        {busy && <Loader2 size={14} className="animate-spin text-slate-500 self-center" />}
      </div>

      {/* Create / duplicate form */}
      {createMode && (
        <div className="mt-2 border border-slate-700 rounded p-2 bg-slate-950/60 space-y-1.5">
          <label className="block">
            <span className="text-[10px] text-slate-500">profileId (minúsculas-com-hífens)</span>
            <input value={createId} onChange={(e) => setCreateId(e.target.value)} placeholder="espadas-basico" className={`${fieldCls} block w-full`} />
          </label>
          <label className="block">
            <span className="text-[10px] text-slate-500">Nome de exibição</span>
            <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Espadas — básico" className={`${fieldCls} block w-full`} />
          </label>
          {createMode === 'new' && (
            <label className="block">
              <span className="text-[10px] text-slate-500">Animação do perfil (uma por perfil)</span>
              <select value={createAnim} onChange={(e) => setCreateAnim(e.target.value)} className={`${fieldCls} block w-full`}>
                {animNames.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
          )}
          <div className="flex gap-1.5 items-center">
            <button type="button" onClick={submitCreate} className={`${btnCls} border-sky-600 bg-sky-700/60 text-white hover:bg-sky-600/60`} disabled={busy}>
              {createMode === 'new' ? 'Criar' : 'Duplicar'}
            </button>
            <button type="button" onClick={() => setCreateMode(null)} className={neutralBtn}>
              Cancelar
            </button>
          </div>
          {createError && <div className="text-[11px] text-red-400">{createError}</div>}
        </div>
      )}

      {/* Selected profile editor */}
      {workingProfile && (
        <div className="mt-2.5 border border-fuchsia-900/50 rounded p-2 bg-fuchsia-950/10 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-fuchsia-300 font-mono">{workingProfile.id}</span>
            {profileDirty && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 border border-amber-700 text-amber-300">não salvo</span>
            )}
            <span className="text-[10px] text-slate-500 font-mono ml-auto">{rectCount} ret.</span>
          </div>

          {usedBy.length >= 2 && (
            <div className="border border-amber-800 bg-amber-950/40 rounded p-1.5 text-[10px] text-amber-300 flex gap-1.5">
              <TriangleAlert size={12} className="shrink-0 mt-0.5" />
              <span>
                Este perfil é compartilhado por {usedBy.length} famílias de arma. Alterações afetarão todas:{' '}
                <span className="font-mono">{usedBy.join(', ')}</span>
              </span>
            </div>
          )}
          {usedBy.length === 1 && (
            <div className="text-[10px] text-slate-500">
              usado pela família <span className="font-mono text-slate-400">{usedBy[0]}</span>
            </div>
          )}
          {usedBy.length === 0 && (
            <div className="text-[10px] text-slate-500">não associado a nenhuma família</div>
          )}

          <label className="block">
            <span className="text-[10px] text-slate-500">Nome de exibição</span>
            <input
              value={workingProfile.displayName}
              onChange={(e) => props.onMutateProfile((p) => { p.displayName = e.target.value; }, { undo: 'coalesce' })}
              className={`${fieldCls} block w-full`}
            />
          </label>

          <label className="block">
            <span className="text-[10px] text-slate-500">Animação (uma por perfil)</span>
            <select
              value={workingProfile.animationId}
              onChange={(e) => props.onChangeProfileAnimation(e.target.value)}
              className={`${fieldCls} block w-full`}
            >
              {animNames.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>

          {workingProfile.animationId !== animId && (
            <div className="border border-amber-800 bg-amber-950/40 rounded p-1.5 text-[10px] text-amber-300">
              O editor está na animação "{animId}", mas este perfil pertence a "{workingProfile.animationId}" —
              as hitboxes do perfil só aparecem (e são editáveis) na animação do perfil.{' '}
              <button type="button" className="underline hover:text-amber-100" onClick={props.onGoToProfileAnimation}>
                Ir para "{workingProfile.animationId}"
              </button>
            </div>
          )}

          {/* Combat metadata (server is the damage authority) */}
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={workingProfile.combat.enabled}
              onChange={(e) => props.onMutateProfile((p) => { p.combat.enabled = e.target.checked; })}
              className="accent-fuchsia-500"
            />
            Perfil causa dano
          </label>
          <label className="block">
            <span className="text-[10px] text-slate-500 font-mono">damagePerHit</span>
            <input
              type="number" min={0} max={1000} step={1}
              value={workingProfile.combat.damagePerHit}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (Number.isFinite(v)) {
                  props.onMutateProfile((p) => { p.combat.damagePerHit = Math.max(0, Math.min(1000, v)); }, { undo: 'coalesce' });
                }
              }}
              className={`${fieldCls} w-full`}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={workingProfile.combat.singleHitPerTarget}
              onChange={(e) => props.onMutateProfile((p) => { p.combat.singleHitPerTarget = e.target.checked; })}
              className="accent-fuchsia-500"
            />
            Um hit por alvo por ataque
          </label>
        </div>
      )}

      {/* Rig-level explicit fallback (spec §18 step 2) */}
      <div className="mt-2.5">
        <span className="text-[10px] text-slate-500">Perfil padrão do rig (fallback explícito)</span>
        <select
          value={rigDefaultId ?? ''}
          onChange={(e) => props.onSetRigDefaultProfile(e.target.value || null)}
          className={`${fieldCls} block w-full`}
          disabled={busy}
        >
          <option value="">— nenhum (sem perfil → sem hitbox) —</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName} ({p.id})
            </option>
          ))}
        </select>
        <p className="text-[10px] text-slate-600 mt-0.5">
          Usado apenas quando a família equipada não tem perfil associado. Salvo junto com o rig.
        </p>
      </div>

      {/* Discovered families (manifest scan + persisted associations) */}
      <button
        type="button"
        onClick={() => setShowFamilies((s) => !s)}
        className="mt-2.5 flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
      >
        {showFamilies ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Famílias descobertas ({catalog.length})
      </button>
      {showFamilies && (
        <div className="mt-1.5 max-h-56 overflow-y-auto border border-slate-800 rounded divide-y divide-slate-800/60">
          {catalog.map((entry) => (
            <div key={entry.familyId} className="px-2 py-1.5 text-[10px] flex items-center gap-2">
              <span className={`font-mono ${previewWeapon?.familyId === entry.familyId ? 'text-white' : 'text-slate-300'}`}>
                {entry.familyId}
              </span>
              <span className="text-slate-600">
                {entry.variants.length > 0 ? `${entry.variants.length} var.` : 'PNG ausente'}
              </span>
              <span className="ml-auto">{profileChip(entry.weaponHitboxProfileId)}</span>
            </div>
          ))}
          {catalog.length === 0 && (
            <div className="px-2 py-2 text-[10px] text-slate-500">Nenhuma família descoberta no manifest.</div>
          )}
        </div>
      )}
      <p className="text-[10px] text-slate-600 mt-1.5">
        Famílias e variações vêm do scan das pastas weapon e crafttools (nada é hardcoded). Novos PNGs aparecem após
        recarregar a página.
      </p>
    </div>
  );
}
