/**
 * Character Rig Controller (/admin/rigs) — spec §2.
 *
 * Edits RIGS (schemaVersion 2): sheet structure, directions, animation frame
 * maps, sprite origin, collision body and per-animation/direction/frame
 * hurt/hitboxes + damage metadata. Preview appearance comes from the
 * Character Generator compositor (real assets — no dependency on
 * public/assets/characters).
 *
 * Persistence is SERVER-SIDE (rig_configs via /api/admin/rigs, Supabase JWT
 * required). The old /admin/characters editor wrote straight to Supabase from
 * the client; that path is gone.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crosshair,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  RIG_DIRECTION_NAMES,
  RIG_ID_RE,
  RIG_OPPOSITE_DIRECTION,
  cloneRigConfig,
  emptyRigFrame,
  getRigFrameConfig,
  mirrorRigFrameConfig,
  newRigTemplate,
  sheetColumnForFrame,
  validateRigConfig,
  type LocalRectangle,
  type PreviewAppearanceRecipe,
  type RigConfig,
  type RigDirection,
  type RigFrameConfig,
} from '../../../shared/combat/RigShapes';
import { rigApi, RigApiError } from './rigApi';
import { RigCanvas } from './RigCanvas';
import { BoxTools, DIRECTION_LABELS } from './BoxTools';
import { AppearancePanel } from './AppearancePanel';
import type { BoxKind, BoxSelection, EditorTool } from './types';
import { weaponApi } from './weaponApi';
import { WeaponProfilePanel, type PreviewWeapon } from './WeaponProfilePanel';
import { buildWeaponFamilyCatalog, projectilePairedFamily } from '../../../lib/character-generator/weaponCatalog';
import { fetchGeneratorManifest } from '../../../lib/character-generator/manifest';
import type { GeneratorManifest } from '../../../lib/character-generator/types';
import {
  buildWeaponMigration,
  cloneWeaponProfile,
  emptyWeaponFrame,
  getWeaponProfileFrame,
  mirrorWeaponFrameConfig,
  newWeaponProfileTemplate,
  resolveWeaponProfileId,
  rigAnimationsWithLegacyHitboxes,
  validateWeaponHitboxProfile,
  weaponFamiliesUsingProfile,
  type WeaponFamilyConfig,
  type WeaponHitboxFrameConfig,
  type WeaponHitboxProfile,
  type WeaponLevelStats,
  type WeaponProjectileConfig,
} from '../../../shared/combat/WeaponShapes';

/**
 * Undo/redo snapshots capture BOTH edit domains (rig + weapon profile) so a
 * single Ctrl+Z reverts one user action even when it touched both.
 */
type EditorSnapshot = {
  rig: RigConfig;
  profile: WeaponHitboxProfile | null;
};

const UNDO_LIMIT = 100;
const UNDO_COALESCE_MS = 600;

const btn =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none';
const neutralBtn = `${btn} border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`;
const fieldCls =
  'bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono';

function nextRectId(kind: BoxKind, group: { rectangles: LocalRectangle[] }): string {
  let max = 0;
  for (const r of group.rectangles) {
    const m = new RegExp(`^${kind}-(\\d+)$`).exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${kind}-${max + 1}`;
}

function frameIsEmpty(f: RigFrameConfig): boolean {
  return (
    !f.hurtbox.enabled &&
    !f.hitbox.enabled &&
    f.hurtbox.rectangles.length === 0 &&
    f.hitbox.rectangles.length === 0
  );
}

export function RigControllerPage() {
  // The game forces overflow:hidden on html/body/#root — override here.
  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')].filter(
      Boolean,
    ) as HTMLElement[];
    const prev = els.map((el) => el.style.overflow);
    els.forEach((el) => {
      el.style.overflow = 'auto';
    });
    return () => {
      els.forEach((el, i) => {
        el.style.overflow = prev[i];
      });
    };
  }, []);

  // ---------------------------------------------------------------- data
  const [rigs, setRigs] = useState<RigConfig[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Record<string, string>>({});
  const [tableMissing, setTableMissing] = useState(false);
  const [tableSql, setTableSql] = useState<string | null>(null);
  const [invalidIds, setInvalidIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [working, setWorking] = useState<RigConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveDetails, setSaveDetails] = useState<string[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);

  // ---------------------------------------------------------------- nav
  const [animId, setAnimId] = useState<string>('stand');
  const [dirId, setDirId] = useState<RigDirection>('south');
  const [localFrame, setLocalFrame] = useState(0);
  const [zoom, setZoom] = useState(4);
  const [showBoxes, setShowBoxes] = useState(true);

  const [tool, setTool] = useState<EditorTool>('select');
  const [snap1px, setSnap1px] = useState(true);
  const [selection, setSelection] = useState<BoxSelection | null>(null);

  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(12);
  const [loop, setLoop] = useState(true);

  const [sheet, setSheet] = useState<HTMLCanvasElement | null>(null);
  const [clipboard, setClipboard] = useState<RigFrameConfig | null>(null);

  // ------------------------------------------------- weapon profiles/families
  // Hitboxes + damage live on WeaponHitboxProfiles keyed by weapon FAMILY;
  // the rig keeps only hurtbox/origin/collision body (spec §5-§8).
  const [profiles, setProfiles] = useState<WeaponHitboxProfile[]>([]);
  const [families, setFamilies] = useState<Record<string, WeaponFamilyConfig>>({});
  const [weaponTablesMissing, setWeaponTablesMissing] = useState(false);
  const [weaponTableSql, setWeaponTableSql] = useState<string | null>(null);
  const [weaponError, setWeaponError] = useState<string | null>(null);
  const [weaponBusy, setWeaponBusy] = useState(false);
  /** Bump a cada recarga de famílias/perfis — o painel descarta rascunhos de níveis. */
  const [weaponDataEpoch, setWeaponDataEpoch] = useState(0);
  const [generatorManifest, setGeneratorManifest] = useState<GeneratorManifest | null>(null);
  const [previewWeapon, setPreviewWeapon] = useState<PreviewWeapon | null>(null);
  const [workingProfile, setWorkingProfile] = useState<WeaponHitboxProfile | null>(null);
  const [profileDirty, setProfileDirty] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationMsg, setMigrationMsg] = useState<string | null>(null);

  // CRUD sub-form: null | 'new' | 'duplicate' | 'rename'
  const [crudMode, setCrudMode] = useState<null | 'new' | 'duplicate' | 'rename'>(null);
  const [crudId, setCrudId] = useState('');
  const [crudName, setCrudName] = useState('');
  const [crudBusy, setCrudBusy] = useState(false);
  const [crudError, setCrudError] = useState<string | null>(null);

  // Undo/redo (whole-state snapshots — rig + profile pairs, coalesced in time)
  const undoRef = useRef<EditorSnapshot[]>([]);
  const redoRef = useRef<EditorSnapshot[]>([]);
  const lastUndoPushRef = useRef(0);
  const [historyVersion, setHistoryVersion] = useState(0); // re-render for button states

  const workingRef = useRef<RigConfig | null>(null);
  workingRef.current = working;
  const workingProfileRef = useRef<WeaponHitboxProfile | null>(null);
  workingProfileRef.current = workingProfile;
  const profilesRef = useRef<WeaponHitboxProfile[]>([]);
  profilesRef.current = profiles;
  const familiesRef = useRef<Record<string, WeaponFamilyConfig>>({});
  familiesRef.current = families;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const profileDirtyRef = useRef(false);
  profileDirtyRef.current = profileDirty;

  // ---------------------------------------------------------------- load
  const loadList = useCallback(async (selectId?: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await rigApi.list();
      setRigs(res.rigs);
      setUpdatedAt(res.updatedAt ?? {});
      setTableMissing(res.tableMissing);
      setTableSql(res.tableSql ?? null);
      setInvalidIds(res.invalidIds ?? []);
      const pick =
        res.rigs.find((r) => r.rigId === selectId) ??
        res.rigs.find((r) => r.rigId === workingRef.current?.rigId) ??
        res.rigs[0] ??
        null;
      setWorking(pick ? cloneRigConfig(pick) : null);
      setDirty(false);
      setWorkingProfile(null); // auto-resolve re-selects for the fresh rig
      setProfileDirty(false);
      undoRef.current = [];
      redoRef.current = [];
      if (pick) {
        const firstAnim = Object.keys(pick.animations)[0] ?? 'stand';
        setAnimId((prev) => (prev in pick.animations ? prev : firstAnim));
        setDirId((prev) => (prev in pick.directions ? prev : ('south' as RigDirection)));
        setLocalFrame(0);
        setSelection(null);
      }
    } catch (e) {
      if (e instanceof RigApiError) {
        setLoadError(e.message);
        if (e.tableMissing) {
          setTableMissing(true);
          setTableSql(e.tableSql ?? null);
        }
      } else {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Generator manifest — weapon family discovery (same scan the preview uses;
  // families/variants are NEVER hardcoded).
  useEffect(() => {
    let cancelled = false;
    fetchGeneratorManifest()
      .then((m) => {
        if (!cancelled) setGeneratorManifest(m);
      })
      .catch(() => {
        if (!cancelled) setGeneratorManifest(null); // AppearancePanel surfaces the error
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadWeaponData = useCallback(async () => {
    setWeaponError(null);
    try {
      const [famRes, profRes] = await Promise.all([weaponApi.families.list(), weaponApi.profiles.list()]);
      setFamilies(famRes.families ?? {});
      setProfiles(profRes.profiles ?? []);
      setWeaponDataEpoch((n) => n + 1);
      const missing = famRes.tableMissing || profRes.tableMissing;
      setWeaponTablesMissing(missing);
      setWeaponTableSql(
        missing
          ? [famRes.tableMissing ? famRes.tableSql : null, profRes.tableMissing ? profRes.tableSql : null]
              .filter(Boolean)
              .join('\n\n')
          : null,
      );
      const invalid = [...(famRes.invalidIds ?? []), ...(profRes.invalidIds ?? [])];
      if (invalid.length > 0) {
        setWeaponError(`Registros de arma com JSON inválido no banco (ignorados): ${invalid.join(', ')}`);
      }
      // Refresh the selected profile from the server copy (only when clean).
      const selected = workingProfileRef.current;
      if (selected && !profileDirtyRef.current) {
        const fresh = (profRes.profiles ?? []).find((p) => p.id === selected.id);
        setWorkingProfile(fresh ? cloneWeaponProfile(fresh) : null);
      }
    } catch (e) {
      if (e instanceof RigApiError) {
        setWeaponError(e.message);
        if (e.tableMissing) {
          setWeaponTablesMissing(true);
          setWeaponTableSql(e.tableSql ?? null);
        }
      } else {
        setWeaponError(e instanceof Error ? e.message : String(e));
      }
    }
  }, []);

  useEffect(() => {
    void loadWeaponData();
  }, [loadWeaponData]);

  // Merged §26 view: manifest scan + persisted associations.
  const weaponCatalog = useMemo(
    () => buildWeaponFamilyCatalog(generatorManifest, families),
    [generatorManifest, families],
  );

  /** Família de projétil pareada à arma do preview (arco→flecha); null p/ melee. */
  const previewProjectileFamilyId = useMemo(
    () =>
      previewWeapon
        ? (projectilePairedFamily(generatorManifest, previewWeapon.familyId)?.id ?? null)
        : null,
    [generatorManifest, previewWeapon],
  );

  const selectProfile = useCallback((profileId: string | null, opts: { confirmDiscard?: boolean } = {}) => {
    const currentId = workingProfileRef.current?.id ?? null;
    if (profileId === currentId) return;
    if (
      (opts.confirmDiscard ?? true) &&
      profileDirtyRef.current &&
      !window.confirm('O perfil de arma atual tem alterações não salvas. Descartar e trocar de perfil?')
    ) {
      return;
    }
    const target = profileId ? (profilesRef.current.find((p) => p.id === profileId) ?? null) : null;
    setWorkingProfile(target ? cloneWeaponProfile(target) : null);
    setProfileDirty(false);
    setSelection((sel) => (sel?.kind === 'hitbox' ? null : sel));
  }, []);

  // §14/§18: equipped weapon changed → resolve family profile → rig default →
  // none, and follow it in the editor. Never auto-switches over unsaved edits
  // (the panel shows a mismatch hint instead).
  useEffect(() => {
    const rig = workingRef.current;
    if (!rig) return;
    if (profileDirtyRef.current) return;
    const family = previewWeapon ? (families[previewWeapon.familyId] ?? null) : null;
    const resolved = resolveWeaponProfileId(family, rig);
    if ((workingProfileRef.current?.id ?? null) !== resolved) {
      selectProfile(resolved, { confirmDiscard: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewWeapon, families, profiles, working?.rigId, working?.defaultWeaponHitboxProfileId, selectProfile]);

  // ---------------------------------------------------------------- derived
  const animNames = useMemo(() => (working ? Object.keys(working.animations) : []), [working]);
  const dirNames = useMemo(
    () => (working ? RIG_DIRECTION_NAMES.filter((d) => d in working.directions) : []),
    [working],
  );
  const animFrames = working?.animations[animId] ?? [];
  const frameCount = animFrames.length;
  const rowIndex = working?.directions[dirId] ?? 0;
  const sheetColumn = working ? (sheetColumnForFrame(working, animId, localFrame) ?? 0) : 0;
  const rigFrame: RigFrameConfig = working
    ? getRigFrameConfig(working, animId, dirId, localFrame)
    : emptyRigFrame();
  /** Hitboxes are editable only when the selected profile targets this animation. */
  const profileMatchesAnim = workingProfile !== null && workingProfile.animationId === animId;
  // Canvas frame = rig HURTBOX + profile HITBOX. Legacy rig hitboxes (backup
  // pós-migração, spec §17) are intentionally not rendered as editable boxes.
  const frame: RigFrameConfig = {
    hurtbox: rigFrame.hurtbox,
    hitbox:
      profileMatchesAnim && workingProfile
        ? getWeaponProfileFrame(workingProfile, dirId, localFrame).hitbox
        : { enabled: false, rectangles: [] },
  };
  const hitboxHint = workingProfile
    ? profileMatchesAnim
      ? null
      : `As hitboxes pertencem ao perfil "${workingProfile.id}" (animação "${workingProfile.animationId}") — troque para essa animação para vê-las/editá-las.`
    : 'Nenhum perfil de arma selecionado — hitboxes agora são editadas por perfil de arma (seção "Perfil de Hitbox da Arma").';
  const mirrorTarget = RIG_OPPOSITE_DIRECTION[dirId] ?? null;

  // Drawing hitboxes requires an editable profile; drop the tool otherwise.
  useEffect(() => {
    if (tool === 'draw-hitbox' && !profileMatchesAnim) setTool('select');
  }, [tool, profileMatchesAnim]);
  const fw = working?.sheet.frameWidth ?? 96;
  const fh = working?.sheet.frameHeight ?? 96;

  // Clamp nav when rig/animation shape changes
  useEffect(() => {
    if (!working) return;
    if (!(animId in working.animations)) {
      setAnimId(Object.keys(working.animations)[0] ?? 'stand');
      return;
    }
    const n = working.animations[animId].length;
    if (localFrame >= n) setLocalFrame(Math.max(0, n - 1));
    if (!(dirId in working.directions)) {
      const first = RIG_DIRECTION_NAMES.find((d) => d in working.directions);
      if (first) setDirId(first);
    }
  }, [working, animId, dirId, localFrame]);

  // Selection must always point at an existing rectangle
  useEffect(() => {
    if (!selection) return;
    const rects = frame[selection.kind].rectangles;
    if (selection.index >= rects.length) setSelection(rects.length > 0 ? { kind: selection.kind, index: rects.length - 1 } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, selection?.kind, selection?.index]);

  // ---------------------------------------------------------------- undo/redo
  const snapshotNow = useCallback((): EditorSnapshot | null => {
    const current = workingRef.current;
    if (!current) return null;
    return {
      rig: cloneRigConfig(current),
      profile: workingProfileRef.current ? cloneWeaponProfile(workingProfileRef.current) : null,
    };
  }, []);

  const pushUndo = useCallback(
    (coalesce = false) => {
      const snap = snapshotNow();
      if (!snap) return;
      const now = Date.now();
      if (coalesce && now - lastUndoPushRef.current < UNDO_COALESCE_MS) return;
      lastUndoPushRef.current = now;
      undoRef.current.push(snap);
      if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
      redoRef.current = [];
      setHistoryVersion((v) => v + 1);
    },
    [snapshotNow],
  );

  const restoreSnapshot = useCallback((snap: EditorSnapshot) => {
    setWorking(snap.rig);
    setWorkingProfile(snap.profile);
    // Conservative dirty flags: the restored state may differ from the server
    // copy (e.g. undoing right after a save), so both domains stay saveable.
    setDirty(true);
    setProfileDirty(snap.profile !== null);
    setPlaying(false);
    setHistoryVersion((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    const current = snapshotNow();
    if (!prev || !current) return;
    redoRef.current.push(current);
    restoreSnapshot(prev);
  }, [snapshotNow, restoreSnapshot]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    const current = snapshotNow();
    if (!next || !current) return;
    undoRef.current.push(current);
    restoreSnapshot(next);
  }, [snapshotNow, restoreSnapshot]);

  // ---------------------------------------------------------------- mutation
  /** All rig mutations go through here (dirty + pause + optional undo). */
  const mutateRig = useCallback(
    (fn: (rig: RigConfig) => void, opts: { undo?: 'push' | 'coalesce' | 'skip' } = {}) => {
      const mode = opts.undo ?? 'push';
      if (mode !== 'skip') pushUndo(mode === 'coalesce');
      setWorking((prev) => {
        if (!prev) return prev;
        const next = cloneRigConfig(prev);
        fn(next);
        return next;
      });
      setDirty(true);
      setPlaying(false);
    },
    [pushUndo],
  );

  const mutateFrame = useCallback(
    (fn: (frame: RigFrameConfig) => void, opts: { undo?: 'push' | 'coalesce' | 'skip' } = {}) => {
      mutateRig((rig) => {
        const anim = (rig.animationConfigs[animId] ??= { directions: {} });
        const dir = (anim.directions[dirId] ??= { frames: {} });
        const key = String(localFrame);
        const f = (dir.frames[key] ??= emptyRigFrame());
        fn(f);
        if (frameIsEmpty(f)) delete dir.frames[key];
      }, opts);
    },
    [mutateRig, animId, dirId, localFrame],
  );

  /** All weapon-profile mutations go through here (dirty + pause + undo). */
  const mutateProfile = useCallback(
    (fn: (p: WeaponHitboxProfile) => void, opts: { undo?: 'push' | 'coalesce' | 'skip' } = {}) => {
      if (!workingProfileRef.current) return;
      const mode = opts.undo ?? 'push';
      if (mode !== 'skip') pushUndo(mode === 'coalesce');
      setWorkingProfile((prev) => {
        if (!prev) return prev;
        const next = cloneWeaponProfile(prev);
        fn(next);
        return next;
      });
      setProfileDirty(true);
      setPlaying(false);
    },
    [pushUndo],
  );

  /** Mutates the profile frame at the current direction/localFrame (prunes empties). */
  const mutateProfileFrame = useCallback(
    (fn: (frame: WeaponHitboxFrameConfig) => void, opts: { undo?: 'push' | 'coalesce' | 'skip' } = {}) => {
      mutateProfile((p) => {
        const dir = (p.directions[dirId] ??= { frames: {} });
        const key = String(localFrame);
        const f = (dir.frames[key] ??= emptyWeaponFrame());
        fn(f);
        if (!f.hitbox.enabled && f.hitbox.rectangles.length === 0) {
          delete dir.frames[key];
          if (Object.keys(dir.frames).length === 0) delete p.directions[dirId];
        }
      }, opts);
    },
    [mutateProfile, dirId, localFrame],
  );

  // Canvas callbacks
  const handleInteractionStart = useCallback(() => {
    setPlaying(false);
    pushUndo();
  }, [pushUndo]);

  const handleOriginChange = useCallback(
    (x: number, y: number, committed: boolean) => {
      mutateRig(
        (rig) => {
          rig.origin = { x, y };
        },
        { undo: committed ? 'skip' : 'skip' },
      );
      // undo snapshot came from onInteractionStart; intermediate drag states skip
      void committed;
    },
    [mutateRig],
  );

  const handleBodyChange = useCallback(
    (offsetX: number, offsetY: number, committed: boolean) => {
      mutateRig(
        (rig) => {
          rig.collisionBody.offsetX = offsetX;
          rig.collisionBody.offsetY = offsetY;
        },
        { undo: 'skip' },
      );
      void committed;
    },
    [mutateRig],
  );

  const handleRectChange = useCallback(
    (kind: BoxKind, index: number, rect: LocalRectangle) => {
      if (kind === 'hitbox') {
        if (!profileMatchesAnim) return; // hitboxes live on the weapon profile
        mutateProfileFrame(
          (f) => {
            if (f.hitbox.rectangles[index]) f.hitbox.rectangles[index] = rect;
          },
          { undo: 'skip' }, // snapshot taken at interaction start
        );
        return;
      }
      mutateFrame(
        (f) => {
          if (f.hurtbox.rectangles[index]) f.hurtbox.rectangles[index] = rect;
        },
        { undo: 'skip' }, // snapshot taken at interaction start
      );
    },
    [mutateFrame, mutateProfileFrame, profileMatchesAnim],
  );

  const handleRectAdd = useCallback(
    (kind: BoxKind, rect: LocalRectangle) => {
      if (kind === 'hitbox') {
        if (!profileMatchesAnim) return; // tool is disabled without a matching profile
        mutateProfileFrame(
          (f) => {
            const id = nextRectId('hitbox', f.hitbox);
            f.hitbox.rectangles.push({ ...rect, id });
            f.hitbox.enabled = true;
            setSelection({ kind: 'hitbox', index: f.hitbox.rectangles.length - 1 });
          },
          { undo: 'skip' }, // snapshot taken at draw start
        );
      } else {
        mutateFrame(
          (f) => {
            const id = nextRectId('hurtbox', f.hurtbox);
            f.hurtbox.rectangles.push({ ...rect, id });
            f.hurtbox.enabled = true;
            setSelection({ kind: 'hurtbox', index: f.hurtbox.rectangles.length - 1 });
          },
          { undo: 'skip' }, // snapshot taken at draw start
        );
      }
      setTool('select');
    },
    [mutateFrame, mutateProfileFrame, profileMatchesAnim],
  );

  // Tool actions
  const handleToggleGroup = useCallback(
    (kind: BoxKind, enabled: boolean) => {
      if (kind === 'hitbox') {
        if (!profileMatchesAnim) return;
        mutateProfileFrame((f) => {
          f.hitbox.enabled = enabled;
        });
        return;
      }
      mutateFrame((f) => {
        f.hurtbox.enabled = enabled;
      });
    },
    [mutateFrame, mutateProfileFrame, profileMatchesAnim],
  );

  const handleRectEdit = useCallback(
    (kind: BoxKind, index: number, patch: Partial<LocalRectangle>) => {
      if (kind === 'hitbox') {
        if (!profileMatchesAnim) return;
        mutateProfileFrame(
          (f) => {
            const r = f.hitbox.rectangles[index];
            if (r) f.hitbox.rectangles[index] = { ...r, ...patch };
          },
          { undo: 'coalesce' },
        );
        return;
      }
      mutateFrame(
        (f) => {
          const r = f.hurtbox.rectangles[index];
          if (r) f.hurtbox.rectangles[index] = { ...r, ...patch };
        },
        { undo: 'coalesce' },
      );
    },
    [mutateFrame, mutateProfileFrame, profileMatchesAnim],
  );

  const handleDuplicate = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'hitbox') {
      if (!profileMatchesAnim) return;
      mutateProfileFrame((f) => {
        const src = f.hitbox.rectangles[selection.index];
        if (!src) return;
        const id = nextRectId('hitbox', f.hitbox);
        f.hitbox.rectangles.push({ ...src, id, x: src.x + 4, y: src.y + 4 });
        setSelection({ kind: 'hitbox', index: f.hitbox.rectangles.length - 1 });
      });
      return;
    }
    mutateFrame((f) => {
      const src = f.hurtbox.rectangles[selection.index];
      if (!src) return;
      const id = nextRectId('hurtbox', f.hurtbox);
      f.hurtbox.rectangles.push({ ...src, id, x: src.x + 4, y: src.y + 4 });
      setSelection({ kind: 'hurtbox', index: f.hurtbox.rectangles.length - 1 });
    });
  }, [mutateFrame, mutateProfileFrame, profileMatchesAnim, selection]);

  const handleDelete = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'hitbox') {
      if (!profileMatchesAnim) return;
      mutateProfileFrame((f) => {
        f.hitbox.rectangles.splice(selection.index, 1);
      });
    } else {
      mutateFrame((f) => {
        f.hurtbox.rectangles.splice(selection.index, 1);
      });
    }
    setSelection(null);
  }, [mutateFrame, mutateProfileFrame, profileMatchesAnim, selection]);

  const handleCopyFrom = useCallback(
    (offset: -1 | 1) => {
      if (!working) return;
      const srcIdx = localFrame + offset;
      if (srcIdx < 0 || srcIdx >= frameCount) return;
      const src = getRigFrameConfig(working, animId, dirId, srcIdx);
      mutateFrame((f) => {
        f.hurtbox = JSON.parse(JSON.stringify(src.hurtbox));
      });
      if (profileMatchesAnim && workingProfile) {
        const psrc = getWeaponProfileFrame(workingProfile, dirId, srcIdx);
        mutateProfileFrame(
          (f) => {
            f.hitbox = JSON.parse(JSON.stringify(psrc.hitbox));
          },
          { undo: 'skip' }, // the rig mutation above snapshotted both domains
        );
      }
      setSelection(null);
    },
    [working, localFrame, frameCount, animId, dirId, mutateFrame, profileMatchesAnim, workingProfile, mutateProfileFrame],
  );

  const handleCopyFrameBoxes = useCallback(() => {
    if (!working) return;
    // Clipboard carries the SYNTHESIZED frame: rig hurtbox + profile hitbox.
    setClipboard(JSON.parse(JSON.stringify(frame)));
  }, [working, frame]);

  const handlePasteFrameBoxes = useCallback(() => {
    if (!clipboard) return;
    mutateFrame((f) => {
      f.hurtbox = JSON.parse(JSON.stringify(clipboard.hurtbox));
    });
    // The hitbox side only lands where it is editable (profile animation).
    if (profileMatchesAnim) {
      mutateProfileFrame(
        (f) => {
          f.hitbox = JSON.parse(JSON.stringify(clipboard.hitbox));
        },
        { undo: 'skip' },
      );
    }
    setSelection(null);
  }, [clipboard, mutateFrame, mutateProfileFrame, profileMatchesAnim]);

  const handleCopyHurtboxToDirection = useCallback(() => {
    if (!working) return;
    const src = getRigFrameConfig(working, animId, dirId, localFrame);
    mutateRig((rig) => {
      const anim = (rig.animationConfigs[animId] ??= { directions: {} });
      const dir = (anim.directions[dirId] ??= { frames: {} });
      for (let i = 0; i < frameCount; i++) {
        const key = String(i);
        const f = (dir.frames[key] ??= emptyRigFrame());
        f.hurtbox = JSON.parse(JSON.stringify(src.hurtbox));
        if (frameIsEmpty(f)) delete dir.frames[key];
      }
    });
  }, [working, animId, dirId, localFrame, frameCount, mutateRig]);

  const handleCopyHurtboxToAllDirections = useCallback(() => {
    if (!working) return;
    const src = getRigFrameConfig(working, animId, dirId, localFrame);
    mutateRig((rig) => {
      const anim = (rig.animationConfigs[animId] ??= { directions: {} });
      for (const d of RIG_DIRECTION_NAMES) {
        if (!(d in rig.directions)) continue;
        const dir = (anim.directions[d] ??= { frames: {} });
        const key = String(localFrame);
        const f = (dir.frames[key] ??= emptyRigFrame());
        f.hurtbox = JSON.parse(JSON.stringify(src.hurtbox));
        if (frameIsEmpty(f)) delete dir.frames[key];
      }
    });
  }, [working, animId, dirId, localFrame, mutateRig]);

  /** Mirrors the PROFILE hitboxes of this direction onto the opposite one. */
  const handleMirrorHitboxToOpposite = useCallback(() => {
    if (!workingProfile || !mirrorTarget || !profileMatchesAnim) return;
    mutateProfile((p) => {
      const srcDir = p.directions[dirId];
      if (!srcDir) return;
      const dstDir = (p.directions[mirrorTarget] ??= { frames: {} });
      for (const [key, srcFrame] of Object.entries(srcDir.frames)) {
        const mirrored = mirrorWeaponFrameConfig(srcFrame);
        if (!mirrored.hitbox.enabled && mirrored.hitbox.rectangles.length === 0) {
          delete dstDir.frames[key];
        } else {
          dstDir.frames[key] = mirrored;
        }
      }
      if (Object.keys(dstDir.frames).length === 0) delete p.directions[mirrorTarget];
    });
  }, [workingProfile, mirrorTarget, profileMatchesAnim, dirId, mutateProfile]);

  const handleClearFrame = useCallback(() => {
    if (
      !window.confirm(
        `Limpar TODAS as caixas do frame ${localFrame + 1} (${animId} · ${DIRECTION_LABELS[dirId]})? ` +
          'Hurtboxes saem do rig; hitboxes saem do perfil de arma selecionado.',
      )
    )
      return;
    mutateFrame((f) => {
      f.hurtbox = { enabled: false, rectangles: [] };
    });
    if (profileMatchesAnim) {
      mutateProfileFrame(
        (f) => {
          f.hitbox = { enabled: false, rectangles: [] };
        },
        { undo: 'skip' }, // single undo step for the whole action
      );
    }
    setSelection(null);
  }, [mutateFrame, mutateProfileFrame, profileMatchesAnim, localFrame, animId, dirId]);

  const handleClearAnimation = useCallback(() => {
    if (
      !window.confirm(
        `Limpar TODAS as hurtboxes da animação "${animId}" (todas as direções)? ` +
          'Isso também remove hitboxes antigas guardadas no rig nessa animação (backup da migração), se existirem. ' +
          'As hitboxes do perfil de arma NÃO são afetadas.',
      )
    )
      return;
    mutateRig((rig) => {
      const anim = rig.animationConfigs[animId];
      if (anim) anim.directions = {};
    });
    setSelection(null);
  }, [mutateRig, animId]);

  const handleSaveRecipe = useCallback(
    (recipe: PreviewAppearanceRecipe) => {
      mutateRig((rig) => {
        rig.previewAppearance = recipe;
      });
    },
    [mutateRig],
  );

  // ---------------------------------------------------------------- save/CRUD
  const handleSave = useCallback(async () => {
    const current = workingRef.current;
    if (!current || saving) return;
    const profileToSave = profileDirtyRef.current ? workingProfileRef.current : null;
    setSaveError(null);
    setSaveDetails([]);

    // §15: warn before saving a profile shared across families.
    if (profileToSave) {
      const usedBy = weaponFamiliesUsingProfile(familiesRef.current, profileToSave.id);
      if (
        usedBy.length >= 2 &&
        !window.confirm(
          `Este perfil é compartilhado por ${usedBy.length} famílias de arma (${usedBy.join(', ')}). ` +
            'Alterações afetarão todas. Salvar mesmo assim?',
        )
      ) {
        return;
      }
    }

    const validated = validateRigConfig(JSON.parse(JSON.stringify(current)));
    if (!validated.ok) {
      setSaveError('Config do rig inválida — nada foi salvo.');
      setSaveDetails(validated.errors.slice(0, 8));
      return;
    }
    let validatedProfile: WeaponHitboxProfile | null = null;
    if (profileToSave) {
      const vp = validateWeaponHitboxProfile(JSON.parse(JSON.stringify(profileToSave)), validated.config);
      if (!vp.ok) {
        setSaveError('Perfil de arma inválido — nada foi salvo.');
        setSaveDetails(vp.errors.slice(0, 8));
        return;
      }
      validatedProfile = vp.config;
    }

    setSaving(true);
    try {
      if (dirtyRef.current) {
        await rigApi.save(validated.config);
        setDirty(false);
        setUpdatedAt((prev) => ({ ...prev, [validated.config.rigId]: new Date().toISOString() }));
        setRigs((prev) => prev.map((r) => (r.rigId === validated.config.rigId ? validated.config : r)));
        setTableMissing(false);
      }
      if (validatedProfile) {
        const saved = validatedProfile;
        await weaponApi.profiles.save(saved);
        setProfileDirty(false);
        setProfiles((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      if (e instanceof RigApiError) {
        setSaveError(e.message);
        setSaveDetails(e.details ?? []);
        if (e.tableMissing) {
          // Which table is missing depends on which call failed; show both hints.
          if (dirtyRef.current) {
            setTableMissing(true);
            setTableSql(e.tableSql ?? tableSql);
          } else {
            setWeaponTablesMissing(true);
            setWeaponTableSql(e.tableSql ?? null);
          }
        }
      } else {
        setSaveError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  }, [saving, tableSql]);

  const switchRig = useCallback(
    (rigId: string) => {
      if ((dirty || profileDirty) && !window.confirm('Há alterações não salvas. Descartar e trocar de rig?')) return;
      const target = rigs.find((r) => r.rigId === rigId);
      if (!target) return;
      setWorking(cloneRigConfig(target));
      setDirty(false);
      setWorkingProfile(null); // auto-resolve re-selects for this rig
      setProfileDirty(false);
      undoRef.current = [];
      redoRef.current = [];
      setHistoryVersion((v) => v + 1);
      setSelection(null);
      setLocalFrame(0);
      setSaveError(null);
      setSaveDetails([]);
      const firstAnim = Object.keys(target.animations)[0] ?? 'stand';
      setAnimId((prev) => (prev in target.animations ? prev : firstAnim));
    },
    [dirty, profileDirty, rigs],
  );

  const handleReload = useCallback(async () => {
    const current = workingRef.current;
    if (!current) return;
    if ((dirty || profileDirty) && !window.confirm('Recarregar do servidor e descartar as alterações não salvas?')) return;
    try {
      const res = await rigApi.get(current.rigId);
      setWorking(res.rig);
      setRigs((prev) => prev.map((r) => (r.rigId === res.rig.rigId ? res.rig : r)));
      setDirty(false);
      setWorkingProfile(null); // auto-resolve re-selects
      setProfileDirty(false);
      void loadWeaponData();
      undoRef.current = [];
      redoRef.current = [];
      setHistoryVersion((v) => v + 1);
      setSelection(null);
      setSaveError(null);
      setSaveDetails([]);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, [dirty, profileDirty, loadWeaponData]);

  const openCrud = useCallback(
    (mode: 'new' | 'duplicate' | 'rename') => {
      setCrudMode(mode);
      setCrudError(null);
      const current = workingRef.current;
      if (mode === 'new') {
        setCrudId('');
        setCrudName('');
      } else if (mode === 'duplicate' && current) {
        setCrudId(`${current.rigId}-copy`);
        setCrudName(`${current.displayName} (Cópia)`);
      } else if (mode === 'rename' && current) {
        setCrudId(current.rigId);
        setCrudName(current.displayName);
      }
    },
    [],
  );

  const submitCrud = useCallback(async () => {
    const current = workingRef.current;
    setCrudError(null);

    if (crudMode === 'rename') {
      if (!crudName.trim()) {
        setCrudError('Informe um nome.');
        return;
      }
      mutateRig((rig) => {
        rig.displayName = crudName.trim();
      });
      setCrudMode(null);
      return;
    }

    const id = crudId.trim();
    const name = crudName.trim() || id;
    if (!RIG_ID_RE.test(id)) {
      setCrudError('ID inválido: use minúsculas, números e hífens (ex.: meu-rig-v1).');
      return;
    }
    if (rigs.some((r) => r.rigId === id)) {
      setCrudError(`Já existe um rig com o ID "${id}".`);
      return;
    }
    const rig = crudMode === 'duplicate' && current ? cloneRigConfig(current) : newRigTemplate(id, name);
    rig.rigId = id;
    rig.displayName = name;

    setCrudBusy(true);
    try {
      await rigApi.create(rig);
      setRigs((prev) => [...prev, rig].sort((a, b) => a.rigId.localeCompare(b.rigId)));
      setUpdatedAt((prev) => ({ ...prev, [id]: new Date().toISOString() }));
      setWorking(cloneRigConfig(rig));
      setDirty(false);
      undoRef.current = [];
      redoRef.current = [];
      setHistoryVersion((v) => v + 1);
      setSelection(null);
      setLocalFrame(0);
      setCrudMode(null);
    } catch (e) {
      if (e instanceof RigApiError && e.tableMissing) {
        setTableMissing(true);
        setTableSql(e.tableSql ?? tableSql);
        setCrudError('Tabela rig_configs não existe — rode o SQL indicado no topo da página.');
      } else {
        setCrudError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setCrudBusy(false);
    }
  }, [crudMode, crudId, crudName, rigs, mutateRig, tableSql]);

  const handleDeleteRig = useCallback(async () => {
    const current = workingRef.current;
    if (!current) return;
    if (!window.confirm(`Excluir o rig "${current.displayName}" (${current.rigId})? Esta ação não pode ser desfeita.`)) {
      return;
    }
    try {
      await rigApi.remove(current.rigId);
      await loadList();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, [loadList]);

  // ------------------------------------------------ weapon profile handlers
  const handleWeaponChange = useCallback((w: PreviewWeapon | null) => {
    setPreviewWeapon((prev) => (prev?.assetId === w?.assetId ? prev : w));
  }, []);

  const applyWeaponApiError = useCallback((e: unknown) => {
    if (e instanceof RigApiError) {
      setWeaponError(e.message);
      if (e.tableMissing) {
        setWeaponTablesMissing(true);
        setWeaponTableSql(e.tableSql ?? null);
      }
    } else {
      setWeaponError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** Associates (or dissociates, profileId=null) a family — saved IMMEDIATELY. */
  const handleAssociateFamily = useCallback(
    async (familyId: string, profileId: string | null) => {
      setWeaponBusy(true);
      setWeaponError(null);
      try {
        const existing = familiesRef.current[familyId];
        const config: WeaponFamilyConfig = {
          familyId,
          ...(existing?.displayName ? { displayName: existing.displayName } : {}),
          // Preserva os levels por item já salvos — associação e níveis são
          // campos independentes do mesmo registro.
          ...(existing?.variants ? { variants: existing.variants } : {}),
          weaponHitboxProfileId: profileId,
        };
        await weaponApi.families.save(config);
        setFamilies((prev) => ({ ...prev, [familyId]: config }));
      } catch (e) {
        applyWeaponApiError(e);
      } finally {
        setWeaponBusy(false);
      }
    },
    [applyWeaponApiError],
  );

  /** Salva os levels (dano/velocidade) de UM item específico da família. */
  const handleSaveVariantLevels = useCallback(
    async (familyId: string, variantId: string, levels: WeaponLevelStats[]) => {
      setWeaponBusy(true);
      setWeaponError(null);
      try {
        const existing = familiesRef.current[familyId];
        const config: WeaponFamilyConfig = {
          familyId,
          ...(existing?.displayName ? { displayName: existing.displayName } : {}),
          weaponHitboxProfileId: existing?.weaponHitboxProfileId ?? null,
          // Merge por variação: preserva a config de projétil já salva.
          variants: {
            ...(existing?.variants ?? {}),
            [variantId]: { ...(existing?.variants?.[variantId] ?? {}), levels },
          },
        };
        const res = await weaponApi.families.save(config);
        setFamilies((prev) => ({ ...prev, [familyId]: res.family ?? config }));
        return true;
      } catch (e) {
        applyWeaponApiError(e);
        return false;
      } finally {
        setWeaponBusy(false);
      }
    },
    [applyWeaponApiError],
  );

  /** Salva a config do PROJÉTIL (alcance/hitbox da flecha) de uma variação. */
  const handleSaveVariantProjectile = useCallback(
    async (familyId: string, variantId: string, projectile: WeaponProjectileConfig) => {
      setWeaponBusy(true);
      setWeaponError(null);
      try {
        const existing = familiesRef.current[familyId];
        const config: WeaponFamilyConfig = {
          familyId,
          ...(existing?.displayName ? { displayName: existing.displayName } : {}),
          weaponHitboxProfileId: existing?.weaponHitboxProfileId ?? null,
          // Merge por variação: preserva os levels já salvos da flecha.
          variants: {
            ...(existing?.variants ?? {}),
            [variantId]: { ...(existing?.variants?.[variantId] ?? {}), projectile },
          },
        };
        const res = await weaponApi.families.save(config);
        setFamilies((prev) => ({ ...prev, [familyId]: res.family ?? config }));
        return true;
      } catch (e) {
        applyWeaponApiError(e);
        return false;
      } finally {
        setWeaponBusy(false);
      }
    },
    [applyWeaponApiError],
  );

  const handleCreateProfile = useCallback(
    async (opts: { id: string; displayName: string; animationId: string; duplicate: boolean }) => {
      const rig = workingRef.current;
      if (!rig) return;
      if (
        profileDirtyRef.current &&
        !window.confirm('O perfil atual tem alterações não salvas. Descartar e criar outro perfil?')
      ) {
        return;
      }
      setWeaponBusy(true);
      setWeaponError(null);
      try {
        const source = workingProfileRef.current;
        const base: WeaponHitboxProfile =
          opts.duplicate && source
            ? { ...cloneWeaponProfile(source), id: opts.id, displayName: opts.displayName }
            : newWeaponProfileTemplate(opts.id, opts.displayName, rig.rigId, opts.animationId);
        const vp = validateWeaponHitboxProfile(JSON.parse(JSON.stringify(base)), rig);
        if (!vp.ok) {
          setWeaponError(vp.errors[0] ?? 'Perfil inválido.');
          return;
        }
        const res = await weaponApi.profiles.create(vp.config);
        setProfiles((prev) => [...prev, res.profile].sort((a, b) => a.id.localeCompare(b.id)));
        setWorkingProfile(cloneWeaponProfile(res.profile));
        setProfileDirty(false);
      } catch (e) {
        applyWeaponApiError(e);
      } finally {
        setWeaponBusy(false);
      }
    },
    [applyWeaponApiError],
  );

  /** Delete with §28 in-use handling (409 → offer dissociate-all). */
  const handleDeleteProfile = useCallback(async () => {
    const profile = workingProfileRef.current;
    if (!profile) return;
    if (!window.confirm(`Excluir o perfil "${profile.displayName}" (${profile.id})? Esta ação não pode ser desfeita.`)) {
      return;
    }
    setWeaponBusy(true);
    setWeaponError(null);
    const clearLocal = () => {
      setProfiles((prev) => prev.filter((p) => p.id !== profile.id));
      setWorkingProfile(null);
      setProfileDirty(false);
      if (workingRef.current?.defaultWeaponHitboxProfileId === profile.id) {
        mutateRig((r) => {
          r.defaultWeaponHitboxProfileId = null;
        });
      }
    };
    try {
      await weaponApi.profiles.remove(profile.id);
      clearLocal();
    } catch (e) {
      if (e instanceof RigApiError && e.status === 409) {
        const inUseBy = e.details ?? [];
        const ok = window.confirm(
          `O perfil "${profile.id}" está em uso pelas famílias: ${inUseBy.join(', ')}.\n\n` +
            'OK → desassociar TODAS essas famílias (ficam sem perfil próprio) e excluir o perfil.\n' +
            'Cancelar → manter tudo como está.\n\n' +
            '(Para substituir por outro perfil, associe as famílias ao outro perfil antes de excluir; ' +
            'para preservar uma cópia, use "Duplicar" antes.)',
        );
        if (ok) {
          try {
            const res = await weaponApi.profiles.remove(profile.id, 'dissociate');
            setFamilies((prev) => {
              const next = { ...prev };
              for (const fid of res.dissociated ?? []) {
                if (next[fid]) next[fid] = { ...next[fid], weaponHitboxProfileId: null };
              }
              return next;
            });
            clearLocal();
          } catch (e2) {
            applyWeaponApiError(e2);
          }
        }
      } else {
        applyWeaponApiError(e);
      }
    } finally {
      setWeaponBusy(false);
    }
  }, [mutateRig, applyWeaponApiError]);

  /** Changing the profile's animation prunes frames beyond the new frame count. */
  const handleChangeProfileAnimation = useCallback(
    (animationId: string) => {
      const rig = workingRef.current;
      const profile = workingProfileRef.current;
      if (!rig || !profile || profile.animationId === animationId) return;
      const newCount = rig.animations[animationId]?.length ?? 0;
      let outOfRange = 0;
      for (const dir of Object.values(profile.directions)) {
        for (const key of Object.keys(dir.frames)) {
          if (parseInt(key, 10) >= newCount) outOfRange++;
        }
      }
      if (
        outOfRange > 0 &&
        !window.confirm(
          `A animação "${animationId}" tem ${newCount} frame(s); ${outOfRange} frame(s) configurados no perfil ` +
            'ficam fora do intervalo e serão removidos. Continuar?',
        )
      ) {
        return;
      }
      mutateProfile((p) => {
        p.animationId = animationId;
        for (const d of Object.keys(p.directions) as RigDirection[]) {
          const dir = p.directions[d];
          if (!dir) continue;
          for (const key of Object.keys(dir.frames)) {
            if (parseInt(key, 10) >= newCount) delete dir.frames[key];
          }
          if (Object.keys(dir.frames).length === 0) delete p.directions[d];
        }
      });
    },
    [mutateProfile],
  );

  const handleSetRigDefaultProfile = useCallback(
    (profileId: string | null) => {
      mutateRig((r) => {
        r.defaultWeaponHitboxProfileId = profileId;
      });
    },
    [mutateRig],
  );

  const handleGoToProfileAnimation = useCallback(() => {
    const p = workingProfileRef.current;
    if (!p) return;
    setPlaying(false);
    setAnimId(p.animationId);
    setLocalFrame(0);
    setSelection(null);
  }, []);

  // ------------------------------------------------------------- migration §17
  const legacyAnims = useMemo(
    () =>
      working
        ? rigAnimationsWithLegacyHitboxes(working).filter((a) => !working.animationConfigs[a]?.hitboxesMigratedTo)
        : [],
    [working],
  );
  const migratedBackupAnims = useMemo(
    () =>
      working
        ? rigAnimationsWithLegacyHitboxes(working).filter((a) => working.animationConfigs[a]?.hitboxesMigratedTo)
        : [],
    [working],
  );

  const handleMigrate = useCallback(async () => {
    const rig = workingRef.current;
    if (!rig || migrating) return;
    if (dirtyRef.current || profileDirtyRef.current) {
      setWeaponError('Salve as alterações pendentes antes de migrar as hitboxes antigas.');
      return;
    }
    // Duas passadas: primeiro os ids determinísticos DESEJADOS; um perfil
    // existente com exatamente esse id E mesmo rigId+animationId é órfão de
    // uma migração interrompida (perfis criados, marcador não salvo) —
    // reaproveite-o em vez de criar uma duplicata com sufixo.
    const probe = buildWeaponMigration(rig, []);
    const reusable = new Set<string>();
    for (const [anim, pid] of Object.entries(probe.animationProfileIds)) {
      const existing = profilesRef.current.find((p) => p.id === pid);
      if (existing && existing.rigId === rig.rigId && existing.animationId === anim) reusable.add(pid);
    }
    const result = buildWeaponMigration(
      rig,
      profilesRef.current.map((p) => p.id).filter((id) => !reusable.has(id)),
    );
    if (!result.ok) {
      setWeaponError(`Migração abortada: ${result.errors.join(' · ')}`);
      return;
    }
    if (result.profiles.length === 0) {
      setWeaponError('Nenhuma hitbox no formato antigo para migrar neste rig.');
      return;
    }
    if (
      !window.confirm(
        `Migrar as hitboxes antigas de ${result.profiles.length} animação(ões) para WeaponHitboxProfile(s)?\n` +
          `Retângulos a copiar: ${result.rectanglesCopied}/${result.rectanglesFound}.\n` +
          'Os dados antigos permanecem no rig como backup até você limpá-los explicitamente. ' +
          'Nenhuma família será associada automaticamente.',
      )
    ) {
      return;
    }
    setMigrating(true);
    setWeaponError(null);
    setMigrationMsg(null);
    const created: WeaponHitboxProfile[] = [];
    let failure: string | null = null;
    for (const p of result.profiles) {
      try {
        const res = reusable.has(p.id)
          ? await weaponApi.profiles.save(p) // órfão de migração interrompida — sobrescreve
          : await weaponApi.profiles.create(p);
        created.push(res.profile);
      } catch (e) {
        if (e instanceof RigApiError && e.tableMissing) {
          setWeaponTablesMissing(true);
          setWeaponTableSql(e.tableSql ?? null);
        }
        failure = e instanceof Error ? e.message : String(e);
        break;
      }
    }
    if (created.length > 0) {
      setProfiles((prev) => {
        const ids = new Set(created.map((p) => p.id));
        return [...prev.filter((p) => !ids.has(p.id)), ...created].sort((a, b) => a.id.localeCompare(b.id));
      });
      // Mark ONLY the animations whose profile was actually created.
      const nextRig = cloneRigConfig(rig);
      for (const [anim, pid] of Object.entries(result.animationProfileIds)) {
        if (!created.some((p) => p.id === pid)) continue;
        const cfg = nextRig.animationConfigs[anim];
        if (cfg) cfg.hitboxesMigratedTo = pid;
      }
      try {
        await rigApi.save(nextRig);
        setWorking(nextRig);
        setRigs((prev) => prev.map((r2) => (r2.rigId === nextRig.rigId ? nextRig : r2)));
        setUpdatedAt((prev) => ({ ...prev, [nextRig.rigId]: new Date().toISOString() }));
      } catch (e) {
        failure = `perfis criados, mas falha ao salvar os marcadores no rig: ${
          e instanceof Error ? e.message : String(e)
        } — repita a migração: os perfis já criados serão reaproveitados (sem duplicar).`;
      }
    }
    if (failure) {
      setWeaponError(`Migração incompleta: ${failure}`);
    } else {
      setMigrationMsg(
        'As Hitboxes globais antigas foram migradas para um WeaponHitboxProfile. ' +
          'Associe as famílias desejadas ao perfil migrado. ' +
          `(perfis criados: ${created.map((p) => p.id).join(', ')} · retângulos copiados: ` +
          `${result.rectanglesCopied}/${result.rectanglesFound})`,
      );
    }
    setMigrating(false);
  }, [migrating]);

  /** §17: remove the legacy backup — only after explicit confirmation. */
  const handleCleanLegacy = useCallback(() => {
    const rig = workingRef.current;
    if (!rig) return;
    const anims = rigAnimationsWithLegacyHitboxes(rig).filter((a) => rig.animationConfigs[a]?.hitboxesMigratedTo);
    if (anims.length === 0) return;
    if (
      !window.confirm(
        `Remover DEFINITIVAMENTE as hitboxes antigas (backup) das animações: ${anims.join(', ')}?\n` +
          'Os WeaponHitboxProfiles migrados NÃO são afetados. ' +
          'A remoção só é persistida quando você clicar em Salvar (Ctrl+Z desfaz antes disso).',
      )
    ) {
      return;
    }
    mutateRig((r) => {
      for (const anim of anims) {
        const cfg = r.animationConfigs[anim];
        if (!cfg) continue;
        for (const dir of Object.values(cfg.directions)) {
          for (const key of Object.keys(dir.frames)) {
            const f = dir.frames[key];
            f.hitbox = { enabled: false, rectangles: [] };
            if (frameIsEmpty(f)) delete dir.frames[key];
          }
        }
      }
    });
  }, [mutateRig]);

  // ---------------------------------------------------------------- playback
  useEffect(() => {
    if (!playing || frameCount <= 1) return;
    const interval = setInterval(() => {
      setLocalFrame((prev) => {
        const next = prev + 1;
        if (next >= frameCount) {
          if (!loop) {
            setPlaying(false);
            return prev;
          }
          return 0;
        }
        return next;
      });
    }, Math.max(20, 1000 / fps));
    return () => clearInterval(interval);
  }, [playing, fps, loop, frameCount]);

  // ---------------------------------------------------------------- keyboard
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
      return;
    }
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if ((meta && e.key.toLowerCase() === 'y') || (meta && e.shiftKey && e.key.toLowerCase() === 'z')) {
      e.preventDefault();
      redo();
      return;
    }
    if (meta && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      handleCopyFrameBoxes();
      return;
    }
    if (meta && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      handlePasteFrameBoxes();
      return;
    }
    if (!selection) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      handleDelete();
      return;
    }
    const step = e.shiftKey ? 5 : 1;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = move[e.key];
    if (delta) {
      e.preventDefault();
      const nudge = (r: LocalRectangle | undefined) => {
        if (r) {
          r.x += delta[0];
          r.y += delta[1];
        }
      };
      if (selection.kind === 'hitbox') {
        if (!profileMatchesAnim) return;
        mutateProfileFrame((f) => nudge(f.hitbox.rectangles[selection.index]), { undo: 'coalesce' });
      } else {
        mutateFrame((f) => nudge(f.hurtbox.rectangles[selection.index]), { undo: 'coalesce' });
      }
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // beforeunload guard
  useEffect(() => {
    if (!dirty && !profileDirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, profileDirty]);

  const handleSheetChange = useCallback((canvas: HTMLCanvasElement | null) => {
    setSheet(canvas);
  }, []);

  // ---------------------------------------------------------------- render
  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;
  void historyVersion;

  const savedAtLabel = working && updatedAt[working.rigId]
    ? new Date(updatedAt[working.rigId]).toLocaleString('pt-BR')
    : null;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-[1500px] mx-auto px-4 py-4">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link to="/admin" className="text-slate-400 hover:text-white inline-flex items-center gap-1 text-sm">
            <ArrowLeft size={15} /> Admin
          </Link>
          <h1 className="text-lg font-bold">
            Character Rig Controller
            <span className="ml-2 text-[10px] font-mono text-slate-500 align-middle">
              estrutura física/combate · schemaVersion 2
            </span>
          </h1>
          <div className="flex-1" />
          {(dirty || profileDirty) && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-amber-900/50 border border-amber-700 text-amber-300">
              alterações não salvas{profileDirty && !dirty ? ' (perfil de arma)' : ''}
            </span>
          )}
          {savedFlash && !dirty && !profileDirty && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-900/50 border border-emerald-700 text-emerald-300 inline-flex items-center gap-1">
              <Check size={11} /> salvo
            </span>
          )}
          {savedAtLabel && (
            <span className="text-[10px] text-slate-500">último salvamento: {savedAtLabel}</span>
          )}
        </div>

        {/* Rig CRUD bar */}
        <div className="mt-3 flex items-center gap-2 flex-wrap border border-slate-800 rounded-lg bg-slate-900/60 px-3 py-2">
          <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Rig</span>
          <select
            value={working?.rigId ?? ''}
            onChange={(e) => switchRig(e.target.value)}
            className={`${fieldCls} min-w-[260px]`}
            disabled={loading || rigs.length === 0}
          >
            {rigs.map((r) => (
              <option key={r.rigId} value={r.rigId}>
                {r.displayName} ({r.rigId})
              </option>
            ))}
          </select>
          <button type="button" onClick={() => openCrud('new')} className={neutralBtn} disabled={loading}>
            <Plus size={13} /> Novo
          </button>
          <button type="button" onClick={() => openCrud('duplicate')} className={neutralBtn} disabled={!working}>
            <Copy size={13} /> Duplicar
          </button>
          <button type="button" onClick={() => openCrud('rename')} className={neutralBtn} disabled={!working}>
            <Pencil size={13} /> Renomear
          </button>
          <button type="button" onClick={handleReload} className={neutralBtn} disabled={!working}>
            <RefreshCw size={13} /> Recarregar
          </button>
          <button
            type="button"
            onClick={handleDeleteRig}
            className={`${btn} border-red-800 bg-red-950/60 text-red-300 hover:bg-red-900/60`}
            disabled={!working}
          >
            <Trash2 size={13} /> Excluir
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleSave}
            disabled={!working || saving || (!dirty && !profileDirty)}
            className={`${btn} border-sky-600 bg-sky-700/60 text-white hover:bg-sky-600/60`}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>

        {/* CRUD sub-form */}
        {crudMode && (
          <div className="mt-2 border border-slate-700 rounded-lg bg-slate-900 px-3 py-2.5 flex items-end gap-2 flex-wrap">
            {crudMode !== 'rename' && (
              <label className="block">
                <span className="text-[10px] text-slate-500">rigId (minúsculas-com-hífens)</span>
                <input
                  value={crudId}
                  onChange={(e) => setCrudId(e.target.value)}
                  placeholder="meu-rig-v1"
                  className={`${fieldCls} block w-56`}
                />
              </label>
            )}
            <label className="block">
              <span className="text-[10px] text-slate-500">Nome de exibição</span>
              <input
                value={crudName}
                onChange={(e) => setCrudName(e.target.value)}
                placeholder="Meu Rig V1"
                className={`${fieldCls} block w-56`}
              />
            </label>
            <button type="button" onClick={submitCrud} disabled={crudBusy} className={`${btn} border-sky-600 bg-sky-700/60 text-white hover:bg-sky-600/60`}>
              {crudBusy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {crudMode === 'new' ? 'Criar' : crudMode === 'duplicate' ? 'Duplicar' : 'Renomear'}
            </button>
            <button type="button" onClick={() => setCrudMode(null)} className={neutralBtn}>
              Cancelar
            </button>
            {crudError && <span className="text-xs text-red-400">{crudError}</span>}
          </div>
        )}

        {/* Banners */}
        {tableMissing && (
          <div className="mt-3 border border-amber-800 bg-amber-950/40 rounded-lg p-3">
            <div className="flex items-center gap-2 text-amber-300 text-sm font-semibold">
              <TriangleAlert size={15} /> Tabela rig_configs não existe no Supabase — salvamentos vão falhar
            </div>
            <p className="text-xs text-amber-200/70 mt-1">
              Rode este SQL no Supabase (SQL Editor) e clique em "Verificar novamente". RLS fica habilitado sem
              policies: apenas o servidor (service role) acessa a tabela.
            </p>
            <pre className="mt-2 text-[10px] bg-slate-950 border border-slate-800 rounded p-2 overflow-x-auto text-slate-300">
              {tableSql ?? 'CREATE TABLE IF NOT EXISTS rig_configs (\n  rig_id text PRIMARY KEY,\n  config jsonb NOT NULL,\n  updated_at timestamptz NOT NULL DEFAULT now()\n);\nALTER TABLE rig_configs ENABLE ROW LEVEL SECURITY;'}
            </pre>
            <button type="button" onClick={() => loadList(working?.rigId)} className={`${neutralBtn} mt-2`}>
              <RefreshCw size={12} /> Verificar novamente
            </button>
          </div>
        )}
        {weaponTablesMissing && (
          <div className="mt-3 border border-amber-800 bg-amber-950/40 rounded-lg p-3">
            <div className="flex items-center gap-2 text-amber-300 text-sm font-semibold">
              <TriangleAlert size={15} /> Tabelas de armas não existem no Supabase — perfis e associações vão falhar
            </div>
            <p className="text-xs text-amber-200/70 mt-1">
              Rode este SQL no Supabase (SQL Editor) e clique em "Verificar novamente". RLS fica habilitado sem
              policies: apenas o servidor (service role) acessa as tabelas.
            </p>
            <pre className="mt-2 text-[10px] bg-slate-950 border border-slate-800 rounded p-2 overflow-x-auto text-slate-300 whitespace-pre-wrap">
              {weaponTableSql ?? '—'}
            </pre>
            <button type="button" onClick={() => void loadWeaponData()} className={`${neutralBtn} mt-2`}>
              <RefreshCw size={12} /> Verificar novamente
            </button>
          </div>
        )}
        {working && legacyAnims.length > 0 && (
          <div className="mt-3 border border-amber-800 bg-amber-950/40 rounded-lg p-3">
            <div className="flex items-center gap-2 text-amber-300 text-sm font-semibold">
              <TriangleAlert size={15} /> Hitboxes no formato antigo detectadas: {legacyAnims.join(', ')}
            </div>
            <p className="text-xs text-amber-200/70 mt-1">
              Este rig ainda guarda hitboxes globais por animação (formato antigo, não usadas pelo jogo após esta
              atualização). Migre-as para WeaponHitboxProfiles — os dados antigos ficam no rig como backup até você
              limpá-los explicitamente, e nenhuma família é associada automaticamente.
            </p>
            <button
              type="button"
              onClick={() => void handleMigrate()}
              className={`${btn} border-amber-700 bg-amber-800/40 text-amber-200 hover:bg-amber-700/40 mt-2`}
              disabled={migrating || weaponTablesMissing}
            >
              {migrating ? <Loader2 size={13} className="animate-spin" /> : <TriangleAlert size={13} />}
              {migrating ? 'Migrando…' : 'Migrar hitboxes antigas'}
            </button>
          </div>
        )}
        {working && migratedBackupAnims.length > 0 && (
          <div className="mt-3 border border-slate-700 bg-slate-900/60 rounded-lg p-3">
            <div className="text-xs text-slate-300">
              Backup da migração presente nas animações: <span className="font-mono">{migratedBackupAnims.join(', ')}</span>.
              Esses dados antigos não são usados pelo jogo; quando tiver certeza, remova-os (a remoção só é
              persistida ao Salvar).
            </div>
            <button type="button" onClick={handleCleanLegacy} className={`${neutralBtn} mt-2`}>
              <Trash2 size={12} /> Limpar dados antigos (backup)
            </button>
          </div>
        )}
        {migrationMsg && (
          <div className="mt-3 border border-emerald-800 bg-emerald-950/40 rounded-lg p-3 text-xs text-emerald-200 flex items-start gap-2">
            <Check size={14} className="mt-0.5 shrink-0" />
            <div className="flex-1">{migrationMsg}</div>
            <button
              type="button"
              onClick={() => setMigrationMsg(null)}
              className="text-emerald-400 hover:text-white text-[11px] shrink-0"
            >
              fechar
            </button>
          </div>
        )}
        {invalidIds.length > 0 && (
          <div className="mt-3 border border-red-900 bg-red-950/40 rounded-lg p-2.5 text-xs text-red-300">
            Rigs com JSON inválido no banco (ignorados): {invalidIds.join(', ')}
          </div>
        )}
        {saveError && (
          <div className="mt-3 border border-red-900 bg-red-950/40 rounded-lg p-2.5 text-xs text-red-300">
            <div className="font-semibold">{saveError}</div>
            {saveDetails.length > 0 && (
              <ul className="mt-1 list-disc list-inside text-red-300/80">
                {saveDetails.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {loadError && (
          <div className="mt-3 border border-red-900 bg-red-950/40 rounded-lg p-3 text-sm text-red-300">
            <div>{loadError}</div>
            <button type="button" onClick={() => loadList()} className={`${neutralBtn} mt-2`}>
              <RefreshCw size={12} /> Tentar novamente
            </button>
          </div>
        )}

        {loading ? (
          <div className="mt-10 flex items-center justify-center gap-2 text-slate-400 text-sm">
            <Loader2 size={16} className="animate-spin" /> Carregando rigs…
          </div>
        ) : !working ? (
          !loadError && (
            <div className="mt-10 text-center text-slate-500 text-sm">Nenhum rig disponível. Crie um com "Novo".</div>
          )
        ) : (
          <div className="mt-4 grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)_320px] gap-4">
            {/* Left: appearance + weapon profile */}
            <div className="space-y-3 min-w-0">
              <AppearancePanel
                rigId={working.rigId}
                recipe={working.previewAppearance}
                onSaveRecipe={handleSaveRecipe}
                onSheetChange={handleSheetChange}
                onWeaponChange={handleWeaponChange}
              />
              <WeaponProfilePanel
                rig={working}
                profiles={profiles}
                families={families}
                catalog={weaponCatalog}
                workingProfile={workingProfile}
                profileDirty={profileDirty}
                previewWeapon={previewWeapon}
                animId={animId}
                busy={weaponBusy}
                weaponTablesMissing={weaponTablesMissing}
                error={weaponError}
                onSelectProfile={selectProfile}
                onCreateProfile={handleCreateProfile}
                onDeleteProfile={handleDeleteProfile}
                onMutateProfile={mutateProfile}
                onChangeProfileAnimation={handleChangeProfileAnimation}
                onAssociateFamily={handleAssociateFamily}
                onSaveVariantLevels={handleSaveVariantLevels}
                isShooter={previewProjectileFamilyId !== null}
                projectileFamilyId={previewProjectileFamilyId}
                onSaveVariantProjectile={handleSaveVariantProjectile}
                weaponDataEpoch={weaponDataEpoch}
                onSetRigDefaultProfile={handleSetRigDefaultProfile}
                onGoToProfileAnimation={handleGoToProfileAnimation}
              />
            </div>

            {/* Center: canvas + nav */}
            <div className="min-w-0">
              {/* Animation / direction */}
              <div className="flex items-center gap-2 flex-wrap">
                <select value={animId} onChange={(e) => { setAnimId(e.target.value); setLocalFrame(0); setSelection(null); }} className={fieldCls}>
                  {animNames.map((a) => (
                    <option key={a} value={a}>
                      {a} ({working.animations[a].length}f)
                    </option>
                  ))}
                </select>
                <div className="flex gap-1">
                  {dirNames.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setDirId(d);
                        setSelection(null);
                      }}
                      className={`${btn} ${
                        dirId === d
                          ? 'border-sky-500 bg-sky-600/30 text-white'
                          : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                      title={`linha ${working.directions[d]}`}
                    >
                      {DIRECTION_LABELS[d].split(' ')[0]}
                    </button>
                  ))}
                </div>
                <div className="flex-1" />
                <label className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} className="accent-sky-500" />
                  caixas
                </label>
                <select value={zoom} onChange={(e) => setZoom(parseInt(e.target.value, 10))} className={fieldCls}>
                  {[2, 3, 4, 5, 6].map((z) => (
                    <option key={z} value={z}>
                      {z}×
                    </option>
                  ))}
                </select>
              </div>

              {/* Canvas */}
              <div className="mt-3 flex justify-center border border-slate-800 rounded-lg bg-slate-900/40 p-4 overflow-auto">
                <RigCanvas
                  image={sheet}
                  frameWidth={fw}
                  frameHeight={fh}
                  rowIndex={rowIndex}
                  sheetColumn={sheetColumn}
                  scale={zoom}
                  origin={working.origin}
                  body={working.collisionBody}
                  frame={frame}
                  showBoxes={showBoxes}
                  selection={selection}
                  tool={tool}
                  snap1px={snap1px}
                  onInteractionStart={handleInteractionStart}
                  onOriginChange={handleOriginChange}
                  onBodyChange={handleBodyChange}
                  onRectChange={handleRectChange}
                  onRectAdd={handleRectAdd}
                  onSelect={setSelection}
                />
              </div>

              {/* Frame timeline + playback */}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setPlaying((p) => !p)}
                  className={`${btn} ${playing ? 'border-amber-600 bg-amber-700/40 text-amber-200' : 'border-emerald-700 bg-emerald-800/40 text-emerald-200'}`}
                  disabled={frameCount <= 1}
                >
                  {playing ? <Pause size={13} /> : <Play size={13} />}
                  {playing ? 'Pausar' : 'Play'}
                </button>
                <label className="text-[11px] text-slate-400 flex items-center gap-1">
                  FPS
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={fps}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v)) setFps(Math.max(1, Math.min(60, v)));
                    }}
                    className={`${fieldCls} w-14`}
                  />
                </label>
                <label className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} className="accent-sky-500" />
                  loop
                </label>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => { setPlaying(false); setLocalFrame((f) => Math.max(0, f - 1)); setSelection(null); }}
                  disabled={localFrame <= 0}
                  className={neutralBtn}
                >
                  <ChevronLeft size={13} />
                </button>
                <div className="flex gap-1">
                  {animFrames.map((col, i) => {
                    const fc = getRigFrameConfig(working, animId, dirId, i);
                    const hasHurt = fc.hurtbox.enabled && fc.hurtbox.rectangles.length > 0;
                    const pf =
                      profileMatchesAnim && workingProfile ? getWeaponProfileFrame(workingProfile, dirId, i) : null;
                    const hasHit = !!pf && pf.hitbox.enabled && pf.hitbox.rectangles.length > 0;
                    const hasLegacy = fc.hitbox.enabled && fc.hitbox.rectangles.length > 0;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setPlaying(false); setLocalFrame(i); setSelection(null); }}
                        className={`relative px-2 py-1.5 rounded border text-[11px] font-mono ${
                          i === localFrame
                            ? 'border-sky-500 bg-sky-600/30 text-white'
                            : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                        title={`frame local ${i} → coluna ${col} da sheet`}
                      >
                        {i + 1}
                        <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                          {hasHurt && <span className="w-1 h-1 rounded-full bg-emerald-400" title="hurtbox (rig)" />}
                          {hasHit && <span className="w-1 h-1 rounded-full bg-fuchsia-400" title="hitbox (perfil de arma)" />}
                          {hasLegacy && <span className="w-1 h-1 rounded-full bg-amber-400" title="hitbox antiga (backup no rig)" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => { setPlaying(false); setLocalFrame((f) => Math.min(frameCount - 1, f + 1)); setSelection(null); }}
                  disabled={localFrame >= frameCount - 1}
                  className={neutralBtn}
                >
                  <ChevronRight size={13} />
                </button>
              </div>

              <p className="mt-2 text-[10px] text-slate-600 font-mono">
                {working.rigId} · {animId} · {DIRECTION_LABELS[dirId]} · frame local {localFrame + 1}/{frameCount} · coluna {sheetColumn} · linha {rowIndex} · frame {fw}×{fh}px
              </p>

              {/* Undo/redo */}
              <div className="mt-2 flex gap-1.5">
                <button type="button" onClick={undo} disabled={!canUndo} className={neutralBtn}>
                  ↶ Desfazer (Ctrl+Z)
                </button>
                <button type="button" onClick={redo} disabled={!canRedo} className={neutralBtn}>
                  ↷ Refazer (Ctrl+Shift+Z)
                </button>
              </div>
            </div>

            {/* Right: tools */}
            <div className="space-y-3 min-w-0">
              {/* Origin & body */}
              <div className="border border-slate-800 rounded-lg p-3 bg-slate-900/60">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
                  Origin & corpo de colisão (globais do rig)
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="block">
                    <span className="text-[10px] text-slate-500 font-mono">origin.x (0–1)</span>
                    <input
                      type="number" step={0.001} min={0} max={1} value={working.origin.x}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v)) mutateRig((r) => { r.origin.x = Math.max(0, Math.min(1, v)); }, { undo: 'coalesce' });
                      }}
                      className={`${fieldCls} w-full`}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-slate-500 font-mono">origin.y (0–1)</span>
                    <input
                      type="number" step={0.001} min={0} max={1} value={working.origin.y}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v)) mutateRig((r) => { r.origin.y = Math.max(0, Math.min(1, v)); }, { undo: 'coalesce' });
                      }}
                      className={`${fieldCls} w-full`}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-slate-500 font-mono">body.offsetX</span>
                    <input
                      type="number" step={0.1} value={working.collisionBody.offsetX}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v)) mutateRig((r) => { r.collisionBody.offsetX = v; }, { undo: 'coalesce' });
                      }}
                      className={`${fieldCls} w-full`}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-slate-500 font-mono">body.offsetY</span>
                    <input
                      type="number" step={0.1} value={working.collisionBody.offsetY}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v)) mutateRig((r) => { r.collisionBody.offsetY = v; }, { undo: 'coalesce' });
                      }}
                      className={`${fieldCls} w-full`}
                    />
                  </label>
                  <label className="block col-span-2">
                    <span className="text-[10px] text-slate-500 font-mono">body.radius</span>
                    <input
                      type="number" step={0.5} min={1} value={working.collisionBody.radius}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v) && v > 0) mutateRig((r) => { r.collisionBody.radius = v; }, { undo: 'coalesce' });
                      }}
                      className={`${fieldCls} w-full`}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => mutateRig((r) => { r.origin = { x: 0.5, y: 0.5 }; })}
                  className={`${neutralBtn} mt-2`}
                >
                  <Crosshair size={12} /> Centralizar origin
                </button>
              </div>

              {/* Combat settings moved to the weapon hitbox profile (left column). */}
              <BoxTools
                frame={frame}
                selection={selection}
                tool={tool}
                snap1px={snap1px}
                context={{ animation: animId, direction: dirId, localFrame, frameCount }}
                canCopyPrev={localFrame > 0}
                canCopyNext={localFrame < frameCount - 1}
                canPaste={clipboard !== null}
                mirrorTarget={mirrorTarget}
                hitboxEditable={profileMatchesAnim}
                hitboxHint={hitboxHint}
                onToolChange={setTool}
                onSnapChange={setSnap1px}
                onToggleGroup={handleToggleGroup}
                onRectEdit={handleRectEdit}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                onCopyFrom={handleCopyFrom}
                onCopyFrameBoxes={handleCopyFrameBoxes}
                onPasteFrameBoxes={handlePasteFrameBoxes}
                onCopyHurtboxToDirection={handleCopyHurtboxToDirection}
                onCopyHurtboxToAllDirections={handleCopyHurtboxToAllDirections}
                onMirrorHitboxToOpposite={handleMirrorHitboxToOpposite}
                onClearFrame={handleClearFrame}
                onClearAnimation={handleClearAnimation}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
