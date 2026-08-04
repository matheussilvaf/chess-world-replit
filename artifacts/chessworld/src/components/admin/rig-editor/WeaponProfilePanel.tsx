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
import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Link2,
  Link2Off,
  Loader2,
  Plus,
  Swords,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { RigConfig } from '../../../shared/combat/RigShapes';
import {
  WEAPON_PROFILE_ID_RE,
  countWeaponProfileRects,
  weaponFamiliesUsingProfile,
  type WeaponFamilyConfig,
  type WeaponFamilyManifestEntry,
  type WeaponHitboxProfile,
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

  const animNames = useMemo(() => Object.keys(rig.animations), [rig]);

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
          Arma no preview:{' '}
          {previewWeapon ? (
            <span className="font-mono text-white">
              {previewWeapon.familyId}
              <span className="text-slate-500"> · variação {previewWeapon.variantId}</span>
            </span>
          ) : (
            <span className="text-slate-500">nenhuma (categoria weapon oculta)</span>
          )}
        </div>
        {previewWeapon && (
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
        {previewWeapon && (
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
        Famílias e variações vêm do scan da pasta weapon (nada é hardcoded). Novos PNGs aparecem após
        recarregar a página.
      </p>
    </div>
  );
}
