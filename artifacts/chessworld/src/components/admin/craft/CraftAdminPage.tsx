/**
 * /admin/craft — Manual de Receitas (spec deste round).
 *
 * Coluna 1: TODOS os itens do jogo num acordeão por categoria — ferramentas
 *           e armas (manifest do gerador), recursos do Mundo de Coleta e
 *           itens criados no admin. "+ Novo item" abre o cadastro (modal).
 * Coluna 2: receita do item selecionado — QUALQUER item pode ter receita e
 *           qualquer item (menos o próprio) pode ser ingrediente. Até 9
 *           ingredientes com quantidade (1..999); a ordem NUNCA importa.
 *           O contador "produz" define quantas unidades do alvo saem por
 *           craft (1..999, padrão 1 — igual às receitas antigas).
 *
 * Ids canônicos (ver CraftShapes): ferramentas/armas usam a MESMA ref do
 * equipamento (gen:crafttools/axe/stone), recursos usam a chave crua do
 * inventário de coleta (mineral:pedra), itens criados usam slug. Receitas
 * legadas com id de asset ("axe_stone") são migradas silenciosamente para a
 * ref nova no primeiro load (o runtime ainda não consome receitas).
 *
 * Rascunhos são locais por alvo e NUNCA persistem sozinhos; "Salvar receita"
 * grava via API. Rascunhos são descartados em recarga (lição do editor de
 * rigs: rascunho velho jamais deve sobrescrever dados novos do servidor).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Copy,
  Hammer,
  Loader2,
  Minus,
  Pencil,
  Plus,
  PlusCircle,
  RefreshCw,
  Save,
  Swords,
  Trash2,
  X,
} from 'lucide-react';
import { fetchGeneratorManifest } from '../../../lib/character-generator/manifest';
import type { GeneratorManifest } from '../../../lib/character-generator/types';
import {
  CRAFTTOOLS_CATEGORY,
  WEAPON_CATEGORY,
  parseWeaponAssetId,
} from '../../../shared/combat/WeaponShapes';
import {
  MAX_INGREDIENT_QUANTITY,
  MAX_OUTPUT_QUANTITY,
  MAX_RECIPE_INGREDIENTS,
  MIN_INGREDIENT_QUANTITY,
  MIN_OUTPUT_QUANTITY,
  classifyCraftEntityId,
  recipeOutputQuantity,
  sameIngredientBag,
  slugifyCraftItemName,
  type CraftIngredient,
  type CraftItemConfig,
  type CraftRecipeConfig,
} from '../../../shared/craft/CraftShapes';
import {
  buildCraftCatalog,
  type CraftCatalogEntry,
  type CraftSectionId,
} from '../../../lib/craft/craftCatalog';
import { RigApiError } from '../rig-editor/rigApi';
import type { StationConfig } from '../../../shared/craft/StationShapes';
import { isPlaceableStationItemKey } from '../../../shared/craft/PlaceableStations';
import { stationsApi } from '../stations/stationsApi';
import { craftApi } from './craftApi';
import { CatalogThumb } from './CatalogThumb';
import { BadgeEditor, badgeChipClass } from './BadgeEditor';
import type { CraftBadgeMap } from '../../../shared/craft/CraftBadges';
import { ItemFormModal, type ItemFormMode, type ItemFormValues } from './ItemFormModal';

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
  /** Badges por item (tabela craft_item_badges). `badgeSql` = tabela ausente; null = rota indisponível. */
  const [badgeMap, setBadgeMap] = useState<CraftBadgeMap>({});
  const [badgesState, setBadgesState] = useState<'loading' | 'ready' | 'missing' | 'unavailable'>('loading');
  const [badgeSql, setBadgeSql] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  /** Rascunhos por alvo — nada persiste até "Salvar receita". */
  const [recipeDrafts, setRecipeDrafts] = useState<Record<string, CraftIngredient[]>>({});
  /** Rascunho da quantidade PRODUZIDA por alvo (só quando difere do salvo). */
  const [outputDrafts, setOutputDrafts] = useState<Record<string, number>>({});
  /** Texto cru dos inputs de quantidade (digitação livre, commit só de nº válido). */
  const [rawQty, setRawQty] = useState<Record<string, string>>({});
  /** Acordeão da coluna esquerda (ferramentas abertas por padrão). */
  const [openSections, setOpenSections] = useState<Partial<Record<CraftSectionId, boolean>>>({
    tools: true,
  });
  const [modal, setModal] = useState<ItemFormMode | null>(null);

  // Estações de criação (spec: /admin/stations): select de estação por item.
  const [stationList, setStationList] = useState<StationConfig[]>([]);
  const [stationMembers, setStationMembers] = useState<Record<string, string>>({});
  const [stationsReady, setStationsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    stationsApi
      .list()
      .then((res) => {
        if (cancelled) return;
        setStationList(res.stations ?? []);
        setStationMembers(res.members ?? {});
        setStationsReady(!res.tableMissing);
      })
      .catch(() => {
        // Tabelas/rota ausentes não podem quebrar o painel de receitas:
        // os selects ficam desabilitados com dica no title.
        if (!cancelled) setStationsReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Trocas de estação são serializadas POR ITEM (fila + sequência): mudanças
  // rápidas não chegam fora de ordem no servidor, e um erro só reverte AQUELE
  // item — e só se nenhuma troca mais nova tiver sido feita nele.
  const memberSeq = useRef<Record<string, number>>({});
  const memberChain = useRef<Record<string, Promise<void>>>({});

  const handleStationChange = useCallback(
    (itemId: string, stationId: string | null) => {
      const seq = (memberSeq.current[itemId] ?? 0) + 1;
      memberSeq.current[itemId] = seq;
      let prevValue: string | undefined;
      setStationMembers((m) => {
        prevValue = m[itemId];
        const next = { ...m };
        if (stationId) next[itemId] = stationId;
        else delete next[itemId];
        return next;
      });
      const run = async () => {
        if (memberSeq.current[itemId] !== seq) return; // já superado
        try {
          await stationsApi.setMember(itemId, stationId);
        } catch (e) {
          if (memberSeq.current[itemId] === seq) {
            setStationMembers((m) => {
              const next = { ...m };
              if (prevValue !== undefined) next[itemId] = prevValue;
              else delete next[itemId];
              return next;
            });
            applyApiError(e);
          }
        }
      };
      memberChain.current[itemId] = (memberChain.current[itemId] ?? Promise.resolve()).then(run);
    },
    [applyApiError],
  );

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
      setOutputDrafts({});
      setRawQty({});
    } catch (e) {
      applyApiError(e);
    } finally {
      setBusy(false);
      setLoaded(true);
    }
    // Badges: rota separada — servidor antigo (404) só desliga o editor.
    try {
      const badgesRes = await craftApi.badges.list();
      setBadgeMap(badgesRes.badges ?? {});
      setBadgesState(badgesRes.tableMissing ? 'missing' : 'ready');
      setBadgeSql(badgesRes.tableMissing ? (badgesRes.tableSql ?? null) : null);
    } catch (e) {
      setBadgeMap({});
      setBadgesState('unavailable');
      setBadgeSql(null);
      if (!(e instanceof RigApiError && e.status === 404)) applyApiError(e);
    }
  }, [applyApiError]);

  // Badges são salvas na hora, serializadas POR ITEM (fila + sequência) como
  // as estações: edições rápidas nunca chegam fora de ordem no servidor (a
  // fila espera a anterior) e a sequência pula gravações já superadas.
  const badgeSeq = useRef<Record<string, number>>({});
  const badgeChain = useRef<Record<string, Promise<void>>>({});
  const handleBadgesChange = useCallback(
    (itemId: string, next: string[]) => {
      const seq = (badgeSeq.current[itemId] ?? 0) + 1;
      badgeSeq.current[itemId] = seq;
      let prev: string[] | undefined;
      setBadgeMap((m) => {
        prev = m[itemId];
        const copy = { ...m };
        if (next.length > 0) copy[itemId] = next;
        else delete copy[itemId];
        return copy;
      });
      const run = async () => {
        if (badgeSeq.current[itemId] !== seq) return; // já superado por outra edição
        try {
          const res = await craftApi.badges.save(itemId, next);
          if (badgeSeq.current[itemId] !== seq) return;
          setBadgeMap((m) => {
            const copy = { ...m };
            if (res.badges.length > 0) copy[itemId] = res.badges;
            else delete copy[itemId];
            return copy;
          });
        } catch (e) {
          if (badgeSeq.current[itemId] !== seq) return;
          setBadgeMap((m) => {
            const copy = { ...m };
            if (prev && prev.length > 0) copy[itemId] = prev;
            else delete copy[itemId];
            return copy;
          });
          if (e instanceof RigApiError && e.tableMissing) {
            setBadgesState('missing');
            if (e.tableSql) setBadgeSql(e.tableSql);
          }
          setError(e instanceof Error ? e.message : String(e));
        }
      };
      badgeChain.current[itemId] = (badgeChain.current[itemId] ?? Promise.resolve()).then(run);
    },
    [],
  );
  const knownBadges = useMemo(() => {
    const all = new Set<string>();
    for (const list of Object.values(badgeMap)) for (const b of list) all.add(b);
    return [...all].sort();
  }, [badgeMap]);

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

  // ------------------------------------------------------ catálogo unificado
  const catalog = useMemo(() => buildCraftCatalog(manifest, items), [manifest, items]);

  // Item custom excluído (ou manifest trocado) → seleção morta é limpa.
  useEffect(() => {
    if (selectedTarget && manifest && loaded && !catalog.byId.has(selectedTarget)) {
      setSelectedTarget(null);
    }
  }, [selectedTarget, catalog, manifest, loaded]);

  // ---------------------------------------- migração de receitas legadas
  // Alvos antigos eram asset ids de crafttools ("axe_stone"). Reescreve cada
  // um para a ref canônica nova quando a família/variação existe no manifest.
  const migrationRan = useRef(false);
  useEffect(() => {
    if (migrationRan.current || !manifest || !loaded || tableMissing) return;
    const plan: { oldId: string; newId: string }[] = [];
    for (const oldId of Object.keys(recipes)) {
      if (catalog.byId.has(oldId)) continue; // id atual (gen/recurso/custom vivo)
      if (items[oldId] !== undefined) continue; // craft item real
      if (classifyCraftEntityId(oldId) !== 'custom') continue;
      const parsed = parseWeaponAssetId(oldId);
      const variantId = parsed.variantId === 'default' ? 'default' : parsed.variantId;
      for (const category of [CRAFTTOOLS_CATEGORY, WEAPON_CATEGORY]) {
        const family = (manifest.categories[category] ?? []).find((f) => f.id === parsed.familyId);
        if (family && family.variants.some((v) => v.id === variantId)) {
          const newId = `gen:${category}/${parsed.familyId}/${variantId}`;
          if (recipes[newId] === undefined) plan.push({ oldId, newId });
          break;
        }
      }
    }
    if (plan.length === 0) return;
    migrationRan.current = true;
    void (async () => {
      const next = { ...recipes };
      for (const { oldId, newId } of plan) {
        try {
          const res = await craftApi.recipes.save({
            targetId: newId,
            ingredients: recipes[oldId].ingredients,
            // Nunca perder a quantidade produzida na migração (ausente = 1).
            outputQuantity: recipeOutputQuantity(recipes[oldId]),
          });
          await craftApi.recipes.remove(oldId);
          delete next[oldId];
          next[newId] = res.recipe;
        } catch (e) {
          console.warn('[craft] migração de receita legada falhou:', oldId, e);
        }
      }
      setRecipes(next);
    })();
  }, [manifest, loaded, tableMissing, recipes, catalog, items]);

  // ----------------------------------------------------------- seleção/draft
  const selectedEntry: CraftCatalogEntry | null = selectedTarget
    ? (catalog.byId.get(selectedTarget) ?? null)
    : null;
  const persistedRecipe = selectedTarget ? (recipes[selectedTarget] ?? null) : null;
  const persisted = persistedRecipe?.ingredients ?? null;
  const draft: CraftIngredient[] = selectedTarget
    ? (recipeDrafts[selectedTarget] ?? persisted ?? [])
    : [];
  /** Quantidade produzida: baseline = receita salva (legado = 1) ou 1 sem receita. */
  const baselineOutput = recipeOutputQuantity(persistedRecipe);
  const draftOutput = selectedTarget ? (outputDrafts[selectedTarget] ?? baselineOutput) : 1;
  const outputDirty = selectedTarget ? outputDrafts[selectedTarget] !== undefined : false;
  const ingredientsDirty = selectedTarget
    ? persisted
      ? !sameIngredientBag(draft, persisted)
      : draft.length > 0
    : false;
  const dirty = ingredientsDirty || outputDirty;
  /** Refs mortas: só ids fora de qualquer classe ou craft items excluídos. */
  const unknownRefs = draft.filter((i) => {
    const kind = classifyCraftEntityId(i.itemId);
    return kind === null || (kind === 'custom' && items[i.itemId] === undefined);
  });

  const setDraftFor = (targetId: string, list: CraftIngredient[]) => {
    setRecipeDrafts((prev) => ({ ...prev, [targetId]: list }));
  };

  const clearDraftFor = (targetId: string) => {
    setRecipeDrafts((prev) => {
      const next = { ...prev };
      delete next[targetId];
      return next;
    });
    setOutputDrafts((prev) => {
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
    if (itemId === selectedTarget) return;
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

  /** Chave sentinela no rawQty para o input da quantidade produzida (nunca é itemId). */
  const OUTPUT_RAW_KEY = '__output__';

  const setOutputDraft = (value: number) => {
    if (!selectedTarget) return;
    const v = Math.max(MIN_OUTPUT_QUANTITY, Math.min(MAX_OUTPUT_QUANTITY, value));
    setOutputDrafts((prev) => {
      const next = { ...prev };
      // Igual ao salvo (ou ao padrão 1) = sem rascunho — o "não salvo" some sozinho.
      if (v === baselineOutput) delete next[selectedTarget];
      else next[selectedTarget] = v;
      return next;
    });
  };

  const commitOutputQty = (raw: string) => {
    if (raw.trim() === '') return;
    const v = Number(raw);
    if (!Number.isFinite(v) || !Number.isInteger(v)) return;
    setOutputDraft(v);
  };

  const qtyKey = (itemId: string) => `${selectedTarget}:${itemId}`;

  const handleSaveRecipe = async () => {
    if (!selectedTarget || draft.length === 0 || unknownRefs.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await craftApi.recipes.save({
        targetId: selectedTarget,
        ingredients: draft,
        outputQuantity: draftOutput,
      });
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
    const label = selectedEntry?.name ?? selectedTarget;
    if (!window.confirm(`Excluir a receita de "${label}"?`)) return;
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
    async (item: CraftItemConfig): Promise<void> => {
      if (!window.confirm(`Excluir o item "${item.name}" (${item.itemId})?`)) return;
      setBusy(true);
      setError(null);
      try {
        await craftApi.items.remove(item.itemId);
        setItems((prev) => {
          const next = { ...prev };
          delete next[item.itemId];
          return next;
        });
        // O servidor apaga junto a receita do próprio item — espelha no estado.
        setRecipes((prev) => {
          const next = { ...prev };
          delete next[item.itemId];
          return next;
        });
        if (selectedTarget === item.itemId) {
          setSelectedTarget(null);
          clearDraftFor(item.itemId);
        }
      } catch (e) {
        if (e instanceof RigApiError && e.status === 409 && e.details) {
          setError(`${e.message}. Receitas que usam o item: ${e.details.join(', ')}`);
        } else {
          applyApiError(e);
        }
      } finally {
        setBusy(false);
      }
    },
    [applyApiError, selectedTarget],
  );

  /** Modal → upload (se houver imagem nova) + save. true fecha o modal. */
  const handleModalSubmit = async (values: ItemFormValues): Promise<boolean> => {
    const editing = modal?.kind === 'edit' ? modal.item : null;
    const itemId = editing ? editing.itemId : slugifyCraftItemName(values.name);
    if (!itemId) return false;
    setError(null);
    let imageUrl = editing?.imageUrl ?? null;
    if (values.imageDataUrl) {
      try {
        const res = await craftApi.items.uploadImage(itemId, values.imageDataUrl);
        imageUrl = res.imageUrl;
      } catch (e) {
        applyApiError(e);
        return false;
      }
    }
    return handleSaveItem({
      itemId,
      name: values.name,
      imageUrl,
      repairsItemId: values.repairsItemId,
      ...(values.durability !== undefined ? { durability: values.durability } : {}),
    });
  };

  // ------------------------------------------------- picker de ingredientes
  /** Seções com as entradas ainda elegíveis (sem o alvo e sem as já usadas). */
  const pickerSections = useMemo(() => {
    const used = new Set(draft.map((d) => d.itemId));
    return catalog.sections
      .map((section) => ({
        ...section,
        entries: section.entries.filter((e) => e.id !== selectedTarget && !used.has(e.id)),
      }))
      .filter((section) => section.entries.length > 0);
  }, [catalog, draft, selectedTarget]);

  const toggleSection = (id: CraftSectionId) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

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
              Manual de Receitas
            </h1>
            <p className="text-[11px] text-slate-500 font-mono">
              qualquer item pode ter receita · ingredientes com quantidade · a ordem não importa
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className={`${btnCls} bg-cyan-600/90 hover:bg-cyan-500 text-white`}
              onClick={() => setModal({ kind: 'create' })}
              disabled={!loaded || tableMissing}
            >
              <PlusCircle className="w-3.5 h-3.5" /> Novo item
            </button>
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

        {badgesState === 'missing' && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            <p className="font-medium mb-1.5">
              A tabela de badges (craft_item_badges) ainda não existe no Supabase. Rode este SQL no SQL Editor e clique em
              Recarregar:
            </p>
            {badgeSql && (
              <div className="relative">
                <pre className="bg-slate-950/70 border border-amber-500/20 rounded-md p-2.5 overflow-x-auto text-[10px] leading-relaxed text-amber-100/90">
                  {badgeSql}
                </pre>
                <button
                  type="button"
                  title="Copiar SQL"
                  className="absolute top-1.5 right-1.5 p-1.5 rounded-md bg-slate-800/90 hover:bg-slate-700 text-slate-300"
                  onClick={() => void navigator.clipboard.writeText(badgeSql)}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,1.05fr)_minmax(380px,2fr)] gap-4 items-start">
          {/* ------------------------------------------- itens do jogo */}
          <section className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-3">
            <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-mono mb-2.5 px-1">
              Itens do jogo <span className="text-slate-600">· selecione para editar a receita</span>
            </h2>
            {!manifest && !manifestError && (
              <p className="text-xs text-slate-500 italic px-1 mb-2">Carregando manifest de assets…</p>
            )}
            <div className="flex flex-col gap-1.5">
              {catalog.sections.map((section) => {
                const open = openSections[section.id] === true;
                const recipeCount = section.entries.filter((e) => recipes[e.id] !== undefined).length;
                return (
                  <div key={section.id} className="rounded-lg border border-slate-700/50 bg-slate-950/40 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleSection(section.id)}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-slate-800/40 transition-colors"
                    >
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-slate-500 transition-transform ${open ? '' : '-rotate-90'}`}
                      />
                      <span className="text-xs font-medium text-slate-200">{section.label}</span>
                      <span className="text-[10px] font-mono text-slate-500">{section.entries.length}</span>
                      {recipeCount > 0 && (
                        <span className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                          {recipeCount} receita{recipeCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </button>
                    {open && (
                      <div className="flex flex-col gap-1 p-1.5 pt-0">
                        {section.id === 'custom' && (
                          <button
                            type="button"
                            onClick={() => setModal({ kind: 'create' })}
                            disabled={!loaded || tableMissing}
                            className="flex items-center gap-2 rounded-lg border border-dashed border-cyan-500/40 bg-cyan-500/[0.04] px-2 py-2 text-xs text-cyan-300 hover:bg-cyan-500/10 transition-colors disabled:opacity-40"
                          >
                            <PlusCircle className="w-4 h-4" /> Adicionar item do jogo…
                          </button>
                        )}
                        {section.entries.length === 0 && (
                          <p className="text-[11px] text-slate-600 italic px-2 py-1.5">
                            {section.id === 'custom'
                              ? 'Nenhum item criado ainda.'
                              : section.id === 'tools' || section.id === 'weapons'
                                ? manifest
                                  ? 'Nenhum PNG nessa pasta do gerador.'
                                  : 'Aguardando manifest…'
                                : 'Nenhum recurso nesse grupo.'}
                          </p>
                        )}
                        {section.entries.map((entry) => {
                          const selected = selectedTarget === entry.id;
                          const hasRecipe = recipes[entry.id] !== undefined;
                          const hasDraft =
                            recipeDrafts[entry.id] !== undefined ||
                            outputDrafts[entry.id] !== undefined;
                          const customItem = section.id === 'custom' ? items[entry.id] : undefined;
                          return (
                            <div
                              key={entry.id}
                              className={`flex items-center gap-2 rounded-lg border transition-all ${
                                selected
                                  ? 'border-cyan-400/70 bg-cyan-500/10 ring-1 ring-cyan-400/40'
                                  : 'border-slate-700/50 bg-slate-950/40 hover:border-slate-500/60'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedTarget(entry.id)}
                                className="flex items-center gap-2.5 flex-1 min-w-0 px-2 py-1.5 text-left"
                              >
                                <CatalogThumb thumb={entry.thumb} size={40} />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-xs text-slate-200 truncate">{entry.name}</span>
                                  {entry.detail && (
                                    <span className="block text-[10px] font-mono text-slate-500 truncate">
                                      {entry.detail}
                                    </span>
                                  )}
                                  {(badgeMap[entry.id]?.length ?? 0) > 0 && (
                                    <span className="mt-0.5 flex flex-wrap gap-1">
                                      {badgeMap[entry.id].slice(0, 4).map((badge) => (
                                        <span
                                          key={badge}
                                          className={`rounded-full border px-1.5 text-[9px] font-mono leading-4 ${badgeChipClass(badge)}`}
                                        >
                                          {badge}
                                        </span>
                                      ))}
                                      {badgeMap[entry.id].length > 4 && (
                                        <span className="text-[9px] font-mono text-slate-500">+{badgeMap[entry.id].length - 4}</span>
                                      )}
                                    </span>
                                  )}
                                </span>
                                {hasDraft && !hasRecipe && (
                                  <span className="text-[9px] font-mono text-amber-300/90 shrink-0">rascunho</span>
                                )}
                                {hasRecipe && <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />}
                              </button>
                              <select
                                value={stationMembers[entry.id] ?? ''}
                                disabled={!stationsReady}
                                title={
                                  stationsReady
                                    ? 'Estação de criação onde este item aparece'
                                    : 'Crie as tabelas de estações (painel Stations Controller) para vincular'
                                }
                                onChange={(e) => void handleStationChange(entry.id, e.target.value || null)}
                                className="shrink-0 mr-1.5 max-w-[110px] rounded-md border border-slate-700/60 bg-slate-900 px-1.5 py-1 text-[10px] text-slate-300 focus:outline-none focus:border-cyan-500/60 disabled:opacity-40"
                              >
                                <option value="">— sem estação —</option>
                                {stationList.map((s) => (
                                  <option key={s.stationId} value={s.stationId}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                              {customItem && (
                                <span className="flex items-center gap-0.5 pr-1.5 shrink-0">
                                  <button
                                    type="button"
                                    title="Editar item"
                                    className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-700/60 disabled:opacity-40"
                                    disabled={busy || tableMissing}
                                    onClick={() => setModal({ kind: 'edit', item: customItem })}
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  {!isPlaceableStationItemKey(customItem.itemId) && (
                                    <button
                                      type="button"
                                      title="Excluir item"
                                      className="p-1 rounded-md text-slate-400 hover:text-rose-300 hover:bg-slate-700/60 disabled:opacity-40"
                                      disabled={busy || tableMissing}
                                      onClick={() => void handleDeleteItem(customItem)}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---------------------------------------------------- receita */}
          <section className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-4">
            <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-mono mb-3">
              Receita <span className="text-slate-600">· como o jogador conquista o item</span>
            </h2>
            {!selectedEntry ? (
              <div className="py-14 text-center">
                <Hammer className="w-8 h-8 text-slate-700 mx-auto mb-3" />
                <p className="text-xs text-slate-500">
                  Selecione qualquer item à esquerda para configurar a combinação.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4 rounded-lg border border-slate-700/50 bg-slate-950/40 p-2.5">
                  <CatalogThumb thumb={selectedEntry.thumb} size={56} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-100 truncate">{selectedEntry.name}</p>
                    <p className="text-[10px] font-mono text-slate-500 truncate">{selectedEntry.id}</p>
                  </div>
                  <div
                    className="flex items-center gap-1 shrink-0 rounded-lg border border-slate-700/50 bg-slate-900/60 px-2 py-1.5"
                    title="Quantas unidades deste item a receita produz por craft"
                  >
                    <span className="text-[10px] font-mono text-slate-500">produz</span>
                    <button
                      type="button"
                      className="p-0.5 rounded bg-slate-800/90 border border-slate-700/60 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                      onClick={() => setOutputDraft(draftOutput - 1)}
                      disabled={busy || tableMissing || draftOutput <= MIN_OUTPUT_QUANTITY}
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <input
                      type="number"
                      min={MIN_OUTPUT_QUANTITY}
                      max={MAX_OUTPUT_QUANTITY}
                      value={rawQty[qtyKey(OUTPUT_RAW_KEY)] ?? String(draftOutput)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setRawQty((prev) => ({ ...prev, [qtyKey(OUTPUT_RAW_KEY)]: raw }));
                        commitOutputQty(raw);
                      }}
                      onBlur={() =>
                        setRawQty((prev) => {
                          const next = { ...prev };
                          delete next[qtyKey(OUTPUT_RAW_KEY)];
                          return next;
                        })
                      }
                      className="w-12 text-center bg-slate-900/80 border border-slate-700/70 rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:border-cyan-500/60"
                      disabled={busy || tableMissing}
                    />
                    <button
                      type="button"
                      className="p-0.5 rounded bg-slate-800/90 border border-slate-700/60 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                      onClick={() => setOutputDraft(draftOutput + 1)}
                      disabled={busy || tableMissing || draftOutput >= MAX_OUTPUT_QUANTITY}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
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

                {/* Badges do item — salvas na hora, independentes da receita */}
                {badgesState !== 'unavailable' && (
                  <div className="mb-4">
                    <BadgeEditor
                      badges={badgeMap[selectedEntry.id] ?? []}
                      onChange={(next) => handleBadgesChange(selectedEntry.id, next)}
                      disabled={busy || badgesState !== 'ready'}
                      known={knownBadges}
                    />
                    {badgesState === 'missing' && (
                      <p className="mt-1 text-[10px] text-amber-300/80">Crie a tabela de badges (aviso acima) para editar.</p>
                    )}
                  </div>
                )}

                {/* Grade 3×3 — até 9 ingredientes */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {Array.from({ length: MAX_RECIPE_INGREDIENTS }, (_, slot) => {
                    if (slot < draft.length) {
                      const entry = draft[slot];
                      const ingEntry = catalog.byId.get(entry.itemId) ?? null;
                      const unknown = unknownRefs.some((u) => u.itemId === entry.itemId);
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
                          <CatalogThumb thumb={ingEntry?.thumb ?? { kind: 'none' }} size={36} />
                          <p className="text-[10px] text-center leading-tight text-slate-300 truncate w-full">
                            {unknown ? (
                              <span className="text-rose-300">{entry.itemId} (removido)</span>
                            ) : (
                              ingEntry?.name ?? entry.itemId
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
                          {pickerSections.length === 0 ? (
                            <p className="text-[10px] text-slate-600 text-center leading-tight">
                              todos os itens já estão na receita
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
                              <option value="">+ adicionar ingrediente…</option>
                              {pickerSections.map((section) => (
                                <optgroup key={section.id} label={section.label}>
                                  {section.entries.map((it) => (
                                    <option key={it.id} value={it.id}>
                                      {it.name}
                                    </option>
                                  ))}
                                </optgroup>
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
                  {draft.length}/{MAX_RECIPE_INGREDIENTS} ingredientes · qualquer item do jogo (menos o
                  próprio) · quantidade {MIN_INGREDIENT_QUANTITY}–{MAX_INGREDIENT_QUANTITY}
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
        </div>
      </div>

      {modal && (
        <ItemFormModal
          mode={modal}
          catalog={catalog}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={handleModalSubmit}
        />
      )}
    </div>
  );
}
