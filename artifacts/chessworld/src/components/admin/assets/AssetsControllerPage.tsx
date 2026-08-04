/**
 * /admin/assets-controller — Assets Controller (spec deste round).
 *
 * Objetivo: separar os assets em categorias/subcategorias ADMINISTRATIVAS
 * ("default character", "shop assets", "level up"…) para que prompts e
 * features futuras possam permitir/negar assets por categoria. O jogo ainda
 * não consome isso.
 *
 * Coluna 1: árvore de categorias (máx. 2 níveis) + criação.
 * Coluna 2: biblioteca (famílias/variações do manifest + craft items).
 * Coluna 3: conteúdo da categoria selecionada + salvar/excluir.
 *
 * Rascunhos são locais por categoria e morrem em recarga/salvamento (lição
 * dos editores anteriores: rascunho velho jamais sobrescreve dado novo).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Boxes, Copy, Hammer, Loader2, RefreshCw, Swords } from 'lucide-react';
import { fetchGeneratorManifest } from '../../../lib/character-generator/manifest';
import type { GeneratorManifest } from '../../../lib/character-generator/types';
import type { CraftItemConfig } from '../../../shared/craft/CraftShapes';
import {
  MAX_ASSET_REFS_PER_CATEGORY,
  slugifyCategoryName,
  type AssetCategoryConfig,
} from '../../../shared/assets/AssetCategoryShapes';
import { RigApiError } from '../rig-editor/rigApi';
import { craftApi } from '../craft/craftApi';
import { assetsApi } from './assetsApi';
import { AssetLibraryPanel } from './AssetLibraryPanel';
import { CategoryTreePanel } from './CategoryTreePanel';
import { SelectedCategoryPanel } from './SelectedCategoryPanel';

const btnCls =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

const sameConfig = (a: AssetCategoryConfig, b: AssetCategoryConfig): boolean =>
  a.name === b.name &&
  a.parentId === b.parentId &&
  a.assetRefs.length === b.assetRefs.length &&
  [...a.assetRefs].sort().join('\n') === [...b.assetRefs].sort().join('\n');

export function AssetsControllerPage() {
  // O jogo força overflow:hidden no html/body/#root — libera o scroll aqui.
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

  const [manifest, setManifest] = useState<GeneratorManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [craftItems, setCraftItems] = useState<Record<string, CraftItemConfig>>({});
  const [craftItemsNote, setCraftItemsNote] = useState<string | null>(null);
  const [categories, setCategories] = useState<Record<string, AssetCategoryConfig>>({});
  const [drafts, setDrafts] = useState<Record<string, AssetCategoryConfig>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [tableSql, setTableSql] = useState<string | null>(null);

  const applyApiError = useCallback((e: unknown) => {
    if (e instanceof RigApiError) {
      const details = e.details && e.details.length > 0 ? ` — ${e.details.join(', ')}` : '';
      setError(`${e.message}${details}`);
      if (e.tableMissing) {
        setTableMissing(true);
        if (e.tableSql) setTableSql(e.tableSql);
      }
      return;
    }
    setError(e instanceof Error ? e.message : String(e));
  }, []);

  const loadAll = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await assetsApi.categories.list();
      setCategories(res.categories ?? {});
      setTableMissing(res.tableMissing);
      setTableSql(res.tableMissing ? (res.tableSql ?? null) : null);
      if ((res.invalidIds ?? []).length > 0) {
        setError(`Categorias com JSON inválido no banco (ignoradas): ${res.invalidIds.join(', ')}`);
      }
      // Recarga = fonte da verdade nova → rascunhos antigos morrem aqui.
      setDrafts({});
    } catch (e) {
      applyApiError(e);
    } finally {
      setBusy(false);
    }
    // Craft items são complemento da biblioteca — falha não bloqueia a página.
    try {
      const items = await craftApi.items.list();
      setCraftItems(items.items ?? {});
      setCraftItemsNote(items.tableMissing ? 'Tabelas de craft ainda não criadas no Supabase.' : null);
    } catch (e) {
      setCraftItems({});
      setCraftItemsNote(
        `Indisponíveis agora (${e instanceof RigApiError ? e.message : 'erro ao carregar'}).`,
      );
    }
  }, [applyApiError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    let cancelled = false;
    fetchGeneratorManifest()
      .then((m) => {
        if (!cancelled) setManifest(m);
      })
      .catch((e) => {
        if (!cancelled) setManifestError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------------------------------- derivados
  const effective = useMemo(() => {
    const map: Record<string, AssetCategoryConfig> = { ...categories };
    for (const [id, draft] of Object.entries(drafts)) map[id] = draft;
    return map;
  }, [categories, drafts]);

  const dirtyIds = useMemo(() => {
    const set = new Set<string>();
    for (const [id, draft] of Object.entries(drafts)) {
      const persisted = categories[id];
      if (!persisted || !sameConfig(draft, persisted)) set.add(id);
    }
    return set;
  }, [drafts, categories]);

  const selected = selectedId ? (effective[selectedId] ?? null) : null;
  const selectedHasChildren = useMemo(
    () => Object.values(effective).some((c) => c.parentId === selectedId),
    [effective, selectedId],
  );

  /** ref → nomes de categorias (efetivas) que a contêm — selo "em N". */
  const refIndex = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const cat of Object.values(effective)) {
      for (const ref of cat.assetRefs) {
        const list = map.get(ref) ?? [];
        list.push(cat.name);
        map.set(ref, list);
      }
    }
    return map;
  }, [effective]);

  const parentOptions = useMemo(
    () =>
      Object.values(effective)
        .filter((c) => c.parentId === null && c.categoryId !== selectedId)
        .map((c) => ({ categoryId: c.categoryId, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [effective, selectedId],
  );

  // ---------------------------------------------------------------- ações
  const mutateSelected = (mutate: (cfg: AssetCategoryConfig) => AssetCategoryConfig) => {
    if (!selectedId) return;
    const base = drafts[selectedId] ?? categories[selectedId];
    if (!base) return;
    setDrafts((prev) => ({ ...prev, [selectedId]: mutate({ ...base, assetRefs: [...base.assetRefs] }) }));
  };

  const handleToggleRef = (ref: string) => {
    mutateSelected((cfg) => {
      const has = cfg.assetRefs.includes(ref);
      if (has) return { ...cfg, assetRefs: cfg.assetRefs.filter((r) => r !== ref) };
      if (cfg.assetRefs.length >= MAX_ASSET_REFS_PER_CATEGORY) {
        setError(`Limite de ${MAX_ASSET_REFS_PER_CATEGORY} refs por categoria atingido.`);
        return cfg;
      }
      return { ...cfg, assetRefs: [...cfg.assetRefs, ref] };
    });
  };

  const handleCreate = async (name: string, parentId: string | null) => {
    const categoryId = slugifyCategoryName(name);
    if (!categoryId || effective[categoryId]) return;
    setBusy(true);
    setError(null);
    try {
      const res = await assetsApi.categories.save({ categoryId, name, parentId, assetRefs: [] });
      setCategories((prev) => ({ ...prev, [categoryId]: res.category }));
      setSelectedId(categoryId);
    } catch (e) {
      applyApiError(e);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!selectedId) return;
    const draft = drafts[selectedId];
    if (!draft || draft.name.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const res = await assetsApi.categories.save({ ...draft, name: draft.name.trim() });
      setCategories((prev) => ({ ...prev, [selectedId]: res.category }));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[selectedId];
        return next;
      });
    } catch (e) {
      applyApiError(e);
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = () => {
    if (!selectedId) return;
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[selectedId];
      return next;
    });
  };

  const handleDelete = async (categoryId: string) => {
    const cat = effective[categoryId];
    if (!cat) return;
    if (!window.confirm(`Excluir a categoria "${cat.name}" (${categoryId})?`)) return;
    setBusy(true);
    setError(null);
    try {
      await assetsApi.categories.remove(categoryId);
      setCategories((prev) => {
        const next = { ...prev };
        delete next[categoryId];
        return next;
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[categoryId];
        return next;
      });
      if (selectedId === categoryId) setSelectedId(null);
    } catch (e) {
      if (e instanceof RigApiError && e.status === 409 && e.details) {
        setError(`${e.message}. Subcategorias: ${e.details.join(', ')}`);
      } else {
        applyApiError(e);
      }
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------------ JSX
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 [background-image:radial-gradient(circle_at_20%_0%,rgba(16,185,129,0.06),transparent_45%),radial-gradient(circle_at_80%_100%,rgba(34,211,238,0.05),transparent_45%)]">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <header className="flex flex-wrap items-center gap-3 mb-5">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <Boxes className="w-5 h-5 text-emerald-300" />
          </div>
          <div>
            <h1 className="text-xl font-semibold bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300 bg-clip-text text-transparent">
              Assets Controller
            </h1>
            <p className="text-[11px] text-slate-500 font-mono">
              categorias de permissão · quem pode aparecer onde · o jogo ainda não consome
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className={`${btnCls} bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60`}
              onClick={() => void loadAll()}
              disabled={busy}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Recarregar
            </button>
            <Link to="/admin/rigs" className={`${btnCls} bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60`}>
              <Swords className="w-3.5 h-3.5" /> Rigs & armas
            </Link>
            <Link to="/admin/craft" className={`${btnCls} bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60`}>
              <Hammer className="w-3.5 h-3.5" /> Craft
            </Link>
            <Link to="/admin" className={`${btnCls} bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60`}>
              <ArrowLeft className="w-3.5 h-3.5" /> /admin
            </Link>
          </div>
        </header>

        {manifestError && (
          <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            Manifest de assets indisponível: {manifestError}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}
        {tableMissing && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            <p className="font-medium mb-1.5">
              A tabela de categorias ainda não existe no Supabase. Rode este SQL no SQL Editor e clique
              em Recarregar:
            </p>
            {tableSql && (
              <div className="relative">
                <pre className="bg-slate-950/70 border border-amber-500/20 rounded-md p-2.5 overflow-x-auto text-[10px] leading-relaxed text-amber-100/90">
                  {tableSql}
                </pre>
                <button
                  type="button"
                  title="Copiar SQL"
                  className="absolute top-1.5 right-1.5 p-1.5 rounded-md bg-slate-800/90 hover:bg-slate-700 text-slate-300"
                  onClick={() => void navigator.clipboard.writeText(tableSql)}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,1fr)_minmax(380px,1.6fr)_minmax(300px,1.15fr)] gap-4 items-start">
          <CategoryTreePanel
            effective={effective}
            dirtyIds={dirtyIds}
            selectedId={selectedId}
            busy={busy}
            disabled={tableMissing}
            onSelect={setSelectedId}
            onCreate={(name, parentId) => void handleCreate(name, parentId)}
            onDelete={(id) => void handleDelete(id)}
          />
          <AssetLibraryPanel
            manifest={manifest}
            craftItems={craftItems}
            craftItemsNote={craftItemsNote}
            selected={selected}
            refIndex={refIndex}
            busy={busy || tableMissing}
            onToggleRef={handleToggleRef}
          />
          <SelectedCategoryPanel
            selected={selected}
            hasChildren={selectedHasChildren}
            dirty={selectedId ? dirtyIds.has(selectedId) : false}
            isPersisted={selectedId ? categories[selectedId] !== undefined : false}
            busy={busy}
            disabled={tableMissing}
            parentOptions={parentOptions}
            manifest={manifest}
            craftItems={craftItems}
            onRename={(name) => mutateSelected((cfg) => ({ ...cfg, name }))}
            onReparent={(parentId) => mutateSelected((cfg) => ({ ...cfg, parentId }))}
            onRemoveRef={handleToggleRef}
            onSave={() => void handleSave()}
            onDiscard={handleDiscard}
            onDelete={() => selectedId && void handleDelete(selectedId)}
          />
        </div>
      </div>
    </div>
  );
}
