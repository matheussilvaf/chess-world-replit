/**
 * /admin/craft — Painel de Craft (spec deste round).
 *
 * Coluna 1: ferramentas de craft (scan dinâmico da pasta `crafttools` via
 *           manifest do gerador — nada de nomes hardcoded).
 * Coluna 2: receita do item selecionado — até 9 craft items (ordem NÃO
 *           importa), cada um com quantidade própria (1..999).
 * Coluna 3: cadastro dos craft items (nome + imagem upload).
 *
 * Rascunhos são locais por alvo e NUNCA persistem sozinhos; "Salvar receita"
 * grava via API. Rascunhos são descartados em recarga (lição do editor de
 * rigs: rascunho velho jamais deve sobrescrever dados novos do servidor).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Hammer,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Swords,
  Trash2,
  X,
} from 'lucide-react';
import { fetchGeneratorManifest } from '../../../lib/character-generator/manifest';
import type { GeneratorManifest } from '../../../lib/character-generator/types';
import { CRAFTTOOLS_CATEGORY, weaponAssetId } from '../../../shared/combat/WeaponShapes';
import {
  MAX_INGREDIENT_QUANTITY,
  MAX_RECIPE_INGREDIENTS,
  MIN_INGREDIENT_QUANTITY,
  sameIngredientBag,
  type CraftIngredient,
  type CraftItemConfig,
  type CraftRecipeConfig,
} from '../../../shared/craft/CraftShapes';
import { RigApiError } from '../rig-editor/rigApi';
import { craftApi } from './craftApi';
import { ItemsManager } from './ItemsManager';
import { SpriteThumb } from './SpriteThumb';

interface ToolEntry {
  assetId: string;
  familyId: string;
  variantId: string;
  url: string;
}

const withBase = (url: string) => `${import.meta.env.BASE_URL}${url.replace(/^\//, '')}`;

const btnCls =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export function CraftAdminPage() {
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
  const [items, setItems] = useState<Record<string, CraftItemConfig>>({});
  const [recipes, setRecipes] = useState<Record<string, CraftRecipeConfig>>({});
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [tableSql, setTableSql] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  /** Rascunhos por alvo — nada persiste até "Salvar receita". */
  const [recipeDrafts, setRecipeDrafts] = useState<Record<string, CraftIngredient[]>>({});
  /** Texto cru dos inputs de quantidade (digitação livre, commit só de nº válido). */
  const [rawQty, setRawQty] = useState<Record<string, string>>({});

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
      const [itemsRes, recipesRes] = await Promise.all([craftApi.items.list(), craftApi.recipes.list()]);
      setItems(itemsRes.items ?? {});
      setRecipes(recipesRes.recipes ?? {});
      const missing = itemsRes.tableMissing || recipesRes.tableMissing;
      setTableMissing(missing);
      setTableSql(missing ? (itemsRes.tableSql ?? recipesRes.tableSql ?? null) : null);
      const invalid = [...(itemsRes.invalidIds ?? []), ...(recipesRes.invalidIds ?? [])];
      if (invalid.length > 0) {
        setError(`Registros de craft com JSON inválido no banco (ignorados): ${invalid.join(', ')}`);
      }
      // Recarga = fonte da verdade nova → rascunhos antigos morrem aqui.
      setRecipeDrafts({});
      setRawQty({});
    } catch (e) {
      applyApiError(e);
    } finally {
      setBusy(false);
      setLoaded(true);
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

  // ------------------------------------------------------------ ferramentas
  const toolFamilies = useMemo(() => manifest?.categories[CRAFTTOOLS_CATEGORY] ?? [], [manifest]);
  const toolByAsset = useMemo(() => {
    const map = new Map<string, ToolEntry>();
    for (const family of toolFamilies) {
      for (const v of family.variants) {
        const assetId = weaponAssetId(family.id, v.id);
        map.set(assetId, { assetId, familyId: family.id, variantId: v.id, url: withBase(v.url) });
      }
    }
    return map;
  }, [toolFamilies]);

  const selectedTool = selectedTarget ? (toolByAsset.get(selectedTarget) ?? null) : null;
  const persisted = selectedTarget ? (recipes[selectedTarget]?.ingredients ?? null) : null;
  const draft: CraftIngredient[] = selectedTarget
    ? (recipeDrafts[selectedTarget] ?? persisted ?? [])
    : [];
  const dirty = selectedTarget
    ? persisted
      ? !sameIngredientBag(draft, persisted)
      : draft.length > 0
    : false;
  const unknownRefs = draft.filter((i) => items[i.itemId] === undefined);

  const setDraftFor = (targetId: string, list: CraftIngredient[]) => {
    setRecipeDrafts((prev) => ({ ...prev, [targetId]: list }));
  };

  const clearDraftFor = (targetId: string) => {
    setRecipeDrafts((prev) => {
      const next = { ...prev };
      delete next[targetId];
      return next;
    });
    setRawQty((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) if (!k.startsWith(`${targetId}:`)) next[k] = v;
      return next;
    });
  };

  const addIngredient = (itemId: string) => {
    if (!selectedTarget || draft.length >= MAX_RECIPE_INGREDIENTS) return;
    if (draft.some((i) => i.itemId === itemId)) return;
    setDraftFor(selectedTarget, [...draft, { itemId, quantity: 1 }]);
  };

  const removeIngredient = (index: number) => {
    if (!selectedTarget) return;
    setDraftFor(selectedTarget, draft.filter((_, i) => i !== index));
  };

  const mutateQty = (index: number, delta: number) => {
    if (!selectedTarget) return;
    setDraftFor(
      selectedTarget,
      draft.map((e, i) =>
        i === index
          ? {
              ...e,
              quantity: Math.max(
                MIN_INGREDIENT_QUANTITY,
                Math.min(MAX_INGREDIENT_QUANTITY, e.quantity + delta),
              ),
            }
          : e,
      ),
    );
  };

  const commitQty = (index: number, raw: string) => {
    if (!selectedTarget || raw.trim() === '') return;
    const v = Number(raw);
    if (!Number.isFinite(v) || !Number.isInteger(v)) return;
    setDraftFor(
      selectedTarget,
      draft.map((e, i) =>
        i === index
          ? { ...e, quantity: Math.max(MIN_INGREDIENT_QUANTITY, Math.min(MAX_INGREDIENT_QUANTITY, v)) }
          : e,
      ),
    );
  };

  const qtyKey = (itemId: string) => `${selectedTarget}:${itemId}`;

  const handleSaveRecipe = async () => {
    if (!selectedTarget || draft.length === 0 || unknownRefs.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await craftApi.recipes.save({ targetId: selectedTarget, ingredients: draft });
      setRecipes((prev) => ({ ...prev, [selectedTarget]: res.recipe }));
      clearDraftFor(selectedTarget);
    } catch (e) {
      applyApiError(e);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRecipe = async () => {
    if (!selectedTarget || !recipes[selectedTarget]) return;
    if (!window.confirm(`Excluir a receita de "${selectedTarget}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await craftApi.recipes.remove(selectedTarget);
      setRecipes((prev) => {
        const next = { ...prev };
        delete next[selectedTarget];
        return next;
      });
      clearDraftFor(selectedTarget);
    } catch (e) {
      applyApiError(e);
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------- craft items CRUD
  const handleSaveItem = useCallback(
    async (config: CraftItemConfig): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const res = await craftApi.items.save(config);
        setItems((prev) => ({ ...prev, [config.itemId]: res.item ?? config }));
        return true;
      } catch (e) {
        applyApiError(e);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applyApiError],
  );

  const handleDeleteItem = useCallback(
    async (itemId: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await craftApi.items.remove(itemId);
        setItems((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
        return true;
      } catch (e) {
        if (e instanceof RigApiError && e.status === 409 && e.details) {
          setError(`${e.message}. Receitas que usam o item: ${e.details.join(', ')}`);
        } else {
          applyApiError(e);
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applyApiError],
  );

  const handleUploadImage = useCallback(
    async (itemId: string, dataUrl: string): Promise<string | null> => {
      setError(null);
      try {
        const res = await craftApi.items.uploadImage(itemId, dataUrl);
        return res.imageUrl;
      } catch (e) {
        applyApiError(e);
        return null;
      }
    },
    [applyApiError],
  );

  const availableForSlot = Object.values(items)
    .filter((it) => !draft.some((d) => d.itemId === it.itemId))
    .sort((a, b) => a.name.localeCompare(b.name));

  // ------------------------------------------------------------------ JSX
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 [background-image:radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.06),transparent_45%),radial-gradient(circle_at_80%_100%,rgba(139,92,246,0.06),transparent_45%)]">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <header className="flex flex-wrap items-center gap-3 mb-5">
          <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
            <Hammer className="w-5 h-5 text-cyan-300" />
          </div>
          <div>
            <h1 className="text-xl font-semibold bg-gradient-to-r from-cyan-300 via-sky-300 to-violet-300 bg-clip-text text-transparent">
              Painel de Craft
            </h1>
            <p className="text-[11px] text-slate-500 font-mono">
              receitas das ferramentas · craft items · ordem dos ingredientes não importa
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
              As tabelas de craft ainda não existem no Supabase. Rode este SQL no SQL Editor e clique em
              Recarregar:
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

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(250px,1fr)_minmax(360px,1.5fr)_minmax(300px,1.15fr)] gap-4 items-start">
          {/* ------------------------------------------------ ferramentas */}
          <section className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-4">
            <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-mono mb-3">
              Ferramentas <span className="text-slate-600">· pasta crafttools</span>
            </h2>
            {toolFamilies.length === 0 ? (
              <p className="text-xs text-slate-500 italic">
                {manifest
                  ? 'Nenhum PNG na pasta crafttools ainda.'
                  : 'Carregando manifest de assets…'}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {toolFamilies.map((family) => (
                  <div key={family.id}>
                    <p className="text-[10px] font-mono text-slate-500 mb-1.5">
                      {family.id} <span className="text-slate-600">· {family.variants.length} item(ns)</span>
                    </p>
                    <div className="flex flex-col gap-1">
                      {family.variants.map((v) => {
                        const assetId = weaponAssetId(family.id, v.id);
                        const selected = selectedTarget === assetId;
                        const hasRecipe = recipes[assetId] !== undefined;
                        const hasDraft = recipeDrafts[assetId] !== undefined;
                        return (
                          <button
                            key={assetId}
                            type="button"
                            onClick={() => setSelectedTarget(assetId)}
                            className={`flex items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-all ${
                              selected
                                ? 'border-cyan-400/70 bg-cyan-500/10 ring-1 ring-cyan-400/40'
                                : 'border-slate-700/50 bg-slate-950/40 hover:border-slate-500/60'
                            }`}
                          >
                            <SpriteThumb url={withBase(v.url)} size={44} />
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs text-slate-200 font-mono truncate">{assetId}</span>
                              <span className="block text-[10px] text-slate-500">
                                {v.id === 'default' ? 'base' : `variação ${v.id}`}
                              </span>
                            </span>
                            {hasDraft && !hasRecipe && (
                              <span className="text-[9px] font-mono text-amber-300/90 shrink-0">rascunho</span>
                            )}
                            {hasRecipe && <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ---------------------------------------------------- receita */}
          <section className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-4">
            <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-mono mb-3">
              Receita <span className="text-slate-600">· como o jogador conquista o item</span>
            </h2>
            {!selectedTool ? (
              <div className="py-14 text-center">
                <Hammer className="w-8 h-8 text-slate-700 mx-auto mb-3" />
                <p className="text-xs text-slate-500">
                  Selecione uma ferramenta à esquerda para configurar a combinação.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4 rounded-lg border border-slate-700/50 bg-slate-950/40 p-2.5">
                  <SpriteThumb url={selectedTool.url} size={56} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-mono text-slate-100 truncate">{selectedTool.assetId}</p>
                    <p className="text-[10px] text-slate-500">
                      família {selectedTool.familyId} ·{' '}
                      {selectedTool.variantId === 'default' ? 'base' : `variação ${selectedTool.variantId}`}
                    </p>
                  </div>
                  {dirty ? (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
                      não salvo
                    </span>
                  ) : persisted ? (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shrink-0">
                      receita salva
                    </span>
                  ) : (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-700/40 text-slate-400 border border-slate-600/40 shrink-0">
                      sem receita
                    </span>
                  )}
                </div>

                {/* Grade 3×3 — até 9 ingredientes */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {Array.from({ length: MAX_RECIPE_INGREDIENTS }, (_, slot) => {
                    if (slot < draft.length) {
                      const entry = draft[slot];
                      const item = items[entry.itemId];
                      const unknown = item === undefined;
                      return (
                        <div
                          key={`${entry.itemId}-${slot}`}
                          className={`relative rounded-lg border p-2 flex flex-col items-center gap-1.5 ${
                            unknown
                              ? 'border-rose-500/50 bg-rose-500/[0.06]'
                              : 'border-slate-600/60 bg-slate-950/60'
                          }`}
                        >
                          <button
                            type="button"
                            title="Remover da receita"
                            className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-slate-800 border border-slate-600/70 text-slate-400 hover:text-rose-300"
                            onClick={() => removeIngredient(slot)}
                            disabled={busy}
                          >
                            <X className="w-3 h-3" />
                          </button>
                          {item?.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              className="w-9 h-9 object-contain rounded bg-slate-900/80"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded bg-slate-900/80 border border-dashed border-slate-700/60" />
                          )}
                          <p className="text-[10px] text-center leading-tight text-slate-300 truncate w-full">
                            {unknown ? (
                              <span className="text-rose-300">{entry.itemId} (removido)</span>
                            ) : (
                              item.name
                            )}
                          </p>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="p-0.5 rounded bg-slate-800/90 border border-slate-700/60 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                              onClick={() => mutateQty(slot, -1)}
                              disabled={busy || entry.quantity <= MIN_INGREDIENT_QUANTITY}
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input
                              type="number"
                              min={MIN_INGREDIENT_QUANTITY}
                              max={MAX_INGREDIENT_QUANTITY}
                              value={rawQty[qtyKey(entry.itemId)] ?? String(entry.quantity)}
                              onChange={(e) => {
                                const raw = e.target.value;
                                setRawQty((prev) => ({ ...prev, [qtyKey(entry.itemId)]: raw }));
                                commitQty(slot, raw);
                              }}
                              onBlur={() =>
                                setRawQty((prev) => {
                                  const next = { ...prev };
                                  delete next[qtyKey(entry.itemId)];
                                  return next;
                                })
                              }
                              className="w-12 text-center bg-slate-900/80 border border-slate-700/70 rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:border-cyan-500/60"
                              disabled={busy}
                            />
                            <button
                              type="button"
                              className="p-0.5 rounded bg-slate-800/90 border border-slate-700/60 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                              onClick={() => mutateQty(slot, 1)}
                              disabled={busy || entry.quantity >= MAX_INGREDIENT_QUANTITY}
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    }
                    if (slot === draft.length && draft.length < MAX_RECIPE_INGREDIENTS) {
                      return (
                        <div
                          key="add-slot"
                          className="rounded-lg border border-dashed border-cyan-500/30 bg-cyan-500/[0.03] p-2 flex items-center justify-center min-h-[104px]"
                        >
                          {availableForSlot.length === 0 ? (
                            <p className="text-[10px] text-slate-600 text-center leading-tight">
                              {Object.keys(items).length === 0 ? 'cadastre craft items →' : 'todos os itens já estão na receita'}
                            </p>
                          ) : (
                            <select
                              value=""
                              className="w-full bg-slate-900/80 border border-slate-700/70 rounded-md px-1.5 py-1.5 text-[11px] text-slate-300 focus:outline-none focus:border-cyan-500/60"
                              onChange={(e) => {
                                if (e.target.value) addIngredient(e.target.value);
                              }}
                              disabled={busy || tableMissing}
                            >
                              <option value="">+ adicionar item…</option>
                              {availableForSlot.map((it) => (
                                <option key={it.itemId} value={it.itemId}>
                                  {it.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={`empty-${slot}`}
                        className="rounded-lg border border-slate-800/80 bg-slate-950/30 min-h-[104px]"
                      />
                    );
                  })}
                </div>

                <p className="text-[10px] font-mono text-slate-500 mb-3">
                  {draft.length}/{MAX_RECIPE_INGREDIENTS} itens · a ordem não importa · quantidade{' '}
                  {MIN_INGREDIENT_QUANTITY}–{MAX_INGREDIENT_QUANTITY} por item
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={`${btnCls} bg-cyan-600/90 hover:bg-cyan-500 text-white`}
                    onClick={() => void handleSaveRecipe()}
                    disabled={busy || !dirty || draft.length === 0 || unknownRefs.length > 0 || tableMissing}
                  >
                    <Save className="w-3.5 h-3.5" /> Salvar receita
                  </button>
                  {dirty && (
                    <button
                      type="button"
                      className={`${btnCls} bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60`}
                      onClick={() => selectedTarget && clearDraftFor(selectedTarget)}
                      disabled={busy}
                    >
                      Descartar
                    </button>
                  )}
                  {persisted && (
                    <button
                      type="button"
                      className={`${btnCls} ml-auto bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40`}
                      onClick={() => void handleDeleteRecipe()}
                      disabled={busy}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Excluir receita
                    </button>
                  )}
                </div>
                {unknownRefs.length > 0 && (
                  <p className="mt-2 text-[10px] text-rose-300">
                    Remova os itens marcados em vermelho (foram excluídos do cadastro) antes de salvar.
                  </p>
                )}
              </>
            )}
          </section>

          {/* ------------------------------------------------ craft items */}
          <ItemsManager
            items={items}
            busy={busy || !loaded}
            disabled={tableMissing}
            onSaveItem={handleSaveItem}
            onDeleteItem={handleDeleteItem}
            onUploadImage={handleUploadImage}
            onLocalError={setError}
          />
        </div>
      </div>
    </div>
  );
}
