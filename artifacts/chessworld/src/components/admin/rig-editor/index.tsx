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
  defaultRigCombat,
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

  // CRUD sub-form: null | 'new' | 'duplicate' | 'rename'
  const [crudMode, setCrudMode] = useState<null | 'new' | 'duplicate' | 'rename'>(null);
  const [crudId, setCrudId] = useState('');
  const [crudName, setCrudName] = useState('');
  const [crudBusy, setCrudBusy] = useState(false);
  const [crudError, setCrudError] = useState<string | null>(null);

  // Undo/redo (whole-config snapshots, coalesced in time)
  const undoRef = useRef<RigConfig[]>([]);
  const redoRef = useRef<RigConfig[]>([]);
  const lastUndoPushRef = useRef(0);
  const [historyVersion, setHistoryVersion] = useState(0); // re-render for button states

  const workingRef = useRef<RigConfig | null>(null);
  workingRef.current = working;

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
  const frame: RigFrameConfig = working
    ? getRigFrameConfig(working, animId, dirId, localFrame)
    : emptyRigFrame();
  const combat = working ? (working.animationConfigs[animId]?.combat ?? defaultRigCombat()) : defaultRigCombat();
  const mirrorTarget = RIG_OPPOSITE_DIRECTION[dirId] ?? null;
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
  const pushUndo = useCallback((coalesce = false) => {
    const current = workingRef.current;
    if (!current) return;
    const now = Date.now();
    if (coalesce && now - lastUndoPushRef.current < UNDO_COALESCE_MS) return;
    lastUndoPushRef.current = now;
    undoRef.current.push(cloneRigConfig(current));
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
    redoRef.current = [];
    setHistoryVersion((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    const current = workingRef.current;
    const prev = undoRef.current.pop();
    if (!current || !prev) return;
    redoRef.current.push(cloneRigConfig(current));
    setWorking(prev);
    setDirty(true);
    setPlaying(false);
    setHistoryVersion((v) => v + 1);
  }, []);

  const redo = useCallback(() => {
    const current = workingRef.current;
    const next = redoRef.current.pop();
    if (!current || !next) return;
    undoRef.current.push(cloneRigConfig(current));
    setWorking(next);
    setDirty(true);
    setPlaying(false);
    setHistoryVersion((v) => v + 1);
  }, []);

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
        const anim = (rig.animationConfigs[animId] ??= { combat: defaultRigCombat(), directions: {} });
        const dir = (anim.directions[dirId] ??= { frames: {} });
        const key = String(localFrame);
        const f = (dir.frames[key] ??= emptyRigFrame());
        fn(f);
        if (frameIsEmpty(f)) delete dir.frames[key];
      }, opts);
    },
    [mutateRig, animId, dirId, localFrame],
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
      mutateFrame(
        (f) => {
          if (f[kind].rectangles[index]) f[kind].rectangles[index] = rect;
        },
        { undo: 'skip' }, // snapshot taken at interaction start
      );
    },
    [mutateFrame],
  );

  const handleRectAdd = useCallback(
    (kind: BoxKind, rect: LocalRectangle) => {
      mutateFrame(
        (f) => {
          const id = nextRectId(kind, f[kind]);
          f[kind].rectangles.push({ ...rect, id });
          f[kind].enabled = true;
          setSelection({ kind, index: f[kind].rectangles.length - 1 });
        },
        { undo: 'skip' }, // snapshot taken at draw start
      );
      setTool('select');
    },
    [mutateFrame],
  );

  // Tool actions
  const handleToggleGroup = useCallback(
    (kind: BoxKind, enabled: boolean) => {
      mutateFrame((f) => {
        f[kind].enabled = enabled;
      });
    },
    [mutateFrame],
  );

  const handleRectEdit = useCallback(
    (kind: BoxKind, index: number, patch: Partial<LocalRectangle>) => {
      mutateFrame(
        (f) => {
          const r = f[kind].rectangles[index];
          if (r) f[kind].rectangles[index] = { ...r, ...patch };
        },
        { undo: 'coalesce' },
      );
    },
    [mutateFrame],
  );

  const handleDuplicate = useCallback(() => {
    if (!selection) return;
    mutateFrame((f) => {
      const src = f[selection.kind].rectangles[selection.index];
      if (!src) return;
      const id = nextRectId(selection.kind, f[selection.kind]);
      f[selection.kind].rectangles.push({ ...src, id, x: src.x + 4, y: src.y + 4 });
      setSelection({ kind: selection.kind, index: f[selection.kind].rectangles.length - 1 });
    });
  }, [mutateFrame, selection]);

  const handleDelete = useCallback(() => {
    if (!selection) return;
    mutateFrame((f) => {
      f[selection.kind].rectangles.splice(selection.index, 1);
    });
    setSelection(null);
  }, [mutateFrame, selection]);

  const handleCopyFrom = useCallback(
    (offset: -1 | 1) => {
      if (!working) return;
      const srcIdx = localFrame + offset;
      if (srcIdx < 0 || srcIdx >= frameCount) return;
      const src = getRigFrameConfig(working, animId, dirId, srcIdx);
      mutateFrame((f) => {
        f.hurtbox = JSON.parse(JSON.stringify(src.hurtbox));
        f.hitbox = JSON.parse(JSON.stringify(src.hitbox));
      });
      setSelection(null);
    },
    [working, localFrame, frameCount, animId, dirId, mutateFrame],
  );

  const handleCopyFrameBoxes = useCallback(() => {
    if (!working) return;
    setClipboard(JSON.parse(JSON.stringify(getRigFrameConfig(working, animId, dirId, localFrame))));
  }, [working, animId, dirId, localFrame]);

  const handlePasteFrameBoxes = useCallback(() => {
    if (!clipboard) return;
    mutateFrame((f) => {
      f.hurtbox = JSON.parse(JSON.stringify(clipboard.hurtbox));
      f.hitbox = JSON.parse(JSON.stringify(clipboard.hitbox));
    });
    setSelection(null);
  }, [clipboard, mutateFrame]);

  const handleCopyHurtboxToDirection = useCallback(() => {
    if (!working) return;
    const src = getRigFrameConfig(working, animId, dirId, localFrame);
    mutateRig((rig) => {
      const anim = (rig.animationConfigs[animId] ??= { combat: defaultRigCombat(), directions: {} });
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
      const anim = (rig.animationConfigs[animId] ??= { combat: defaultRigCombat(), directions: {} });
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

  const handleMirrorHitboxToOpposite = useCallback(() => {
    if (!working || !mirrorTarget) return;
    mutateRig((rig) => {
      const anim = (rig.animationConfigs[animId] ??= { combat: defaultRigCombat(), directions: {} });
      const srcDir = anim.directions[dirId];
      const dstDir = (anim.directions[mirrorTarget] ??= { frames: {} });
      if (!srcDir) return;
      for (const [key, srcFrame] of Object.entries(srcDir.frames)) {
        const mirrored = mirrorRigFrameConfig(srcFrame);
        const dst = (dstDir.frames[key] ??= emptyRigFrame());
        dst.hitbox = mirrored.hitbox;
        if (frameIsEmpty(dst)) delete dstDir.frames[key];
      }
    });
  }, [working, mirrorTarget, animId, dirId, mutateRig]);

  const handleClearFrame = useCallback(() => {
    if (!window.confirm(`Limpar TODAS as caixas do frame ${localFrame + 1} (${animId} · ${DIRECTION_LABELS[dirId]})?`)) return;
    mutateFrame((f) => {
      f.hurtbox = { enabled: false, rectangles: [] };
      f.hitbox = { enabled: false, rectangles: [] };
    });
    setSelection(null);
  }, [mutateFrame, localFrame, animId, dirId]);

  const handleClearAnimation = useCallback(() => {
    if (!window.confirm(`Limpar TODAS as caixas da animação "${animId}" (todas as direções)? As configurações de dano são mantidas.`)) return;
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
    setSaveError(null);
    setSaveDetails([]);
    const validated = validateRigConfig(JSON.parse(JSON.stringify(current)));
    if (!validated.ok) {
      setSaveError('Config inválida — nada foi salvo.');
      setSaveDetails(validated.errors.slice(0, 8));
      return;
    }
    setSaving(true);
    try {
      await rigApi.save(validated.config);
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      setUpdatedAt((prev) => ({ ...prev, [validated.config.rigId]: new Date().toISOString() }));
      setRigs((prev) => prev.map((r) => (r.rigId === validated.config.rigId ? validated.config : r)));
      setTableMissing(false);
    } catch (e) {
      if (e instanceof RigApiError) {
        setSaveError(e.message);
        setSaveDetails(e.details ?? []);
        if (e.tableMissing) {
          setTableMissing(true);
          setTableSql(e.tableSql ?? tableSql);
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
      if (dirty && !window.confirm('Há alterações não salvas. Descartar e trocar de rig?')) return;
      const target = rigs.find((r) => r.rigId === rigId);
      if (!target) return;
      setWorking(cloneRigConfig(target));
      setDirty(false);
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
    [dirty, rigs],
  );

  const handleReload = useCallback(async () => {
    const current = workingRef.current;
    if (!current) return;
    if (dirty && !window.confirm('Recarregar do servidor e descartar as alterações não salvas?')) return;
    try {
      const res = await rigApi.get(current.rigId);
      setWorking(res.rig);
      setRigs((prev) => prev.map((r) => (r.rigId === res.rig.rigId ? res.rig : r)));
      setDirty(false);
      undoRef.current = [];
      redoRef.current = [];
      setHistoryVersion((v) => v + 1);
      setSelection(null);
      setSaveError(null);
      setSaveDetails([]);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, [dirty]);

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
      mutateFrame(
        (f) => {
          const r = f[selection.kind].rectangles[selection.index];
          if (r) {
            r.x += delta[0];
            r.y += delta[1];
          }
        },
        { undo: 'coalesce' },
      );
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // beforeunload guard
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

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
          {dirty && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-amber-900/50 border border-amber-700 text-amber-300">
              alterações não salvas
            </span>
          )}
          {savedFlash && !dirty && (
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
            disabled={!working || saving || !dirty}
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
            {/* Left: appearance */}
            <div className="space-y-3 min-w-0">
              <AppearancePanel
                rigId={working.rigId}
                recipe={working.previewAppearance}
                onSaveRecipe={handleSaveRecipe}
                onSheetChange={handleSheetChange}
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
                    const hasHit = fc.hitbox.enabled && fc.hitbox.rectangles.length > 0;
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
                          {hasHurt && <span className="w-1 h-1 rounded-full bg-emerald-400" />}
                          {hasHit && <span className="w-1 h-1 rounded-full bg-fuchsia-400" />}
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

              {/* Combat per animation */}
              <div className="border border-slate-800 rounded-lg p-3 bg-slate-900/60">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
                  Combate — animação "{animId}"
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={combat.enabled}
                    onChange={(e) =>
                      mutateRig((r) => {
                        const anim = (r.animationConfigs[animId] ??= { combat: defaultRigCombat(), directions: {} });
                        anim.combat.enabled = e.target.checked;
                      })
                    }
                    className="accent-fuchsia-500"
                  />
                  Animação causa dano
                </label>
                <label className="block mt-2">
                  <span className="text-[10px] text-slate-500 font-mono">damagePerHit</span>
                  <input
                    type="number" min={0} max={1000} step={1} value={combat.damagePerHit}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v))
                        mutateRig((r) => {
                          const anim = (r.animationConfigs[animId] ??= { combat: defaultRigCombat(), directions: {} });
                          anim.combat.damagePerHit = Math.max(0, Math.min(1000, v));
                        }, { undo: 'coalesce' });
                    }}
                    className={`${fieldCls} w-full`}
                  />
                </label>
                <label className="flex items-center gap-2 mt-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={combat.singleHitPerTarget}
                    onChange={(e) =>
                      mutateRig((r) => {
                        const anim = (r.animationConfigs[animId] ??= { combat: defaultRigCombat(), directions: {} });
                        anim.combat.singleHitPerTarget = e.target.checked;
                      })
                    }
                    className="accent-fuchsia-500"
                  />
                  Um hit por alvo por ataque
                </label>
              </div>

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
