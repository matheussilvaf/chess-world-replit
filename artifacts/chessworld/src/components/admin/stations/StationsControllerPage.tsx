/**
 * Stations Controller (spec: /admin/stations) — configuração das 4 estações
 * de criação fixas (Forja, Mesa de Crafting, Fornalha, Estação de Poções).
 *
 * - O preview central é o ESPELHO EXATO do painel que o jogador verá no jogo
 *   (mesmo componente StationPreview que a integração futura vai renderizar),
 *   com inventário SIMULADO determinístico só para demonstrar os estados.
 * - Abas são dinâmicas por estação (nenhuma vem criada); o rótulo do botão de
 *   criação é editável POR ABA (lapisinho sobre o próprio botão do preview).
 * - O layout dos itens é montado arrastando da lista lateral para o preview:
 *   soltar ao lado de um item = mesma linha; soltar abaixo = nova linha.
 * - O vínculo item→estação é feito no painel de receitas (/admin/craft), via
 *   select em cada card de item; aqui só aparecem os itens já vinculados.
 * - Tabelas ausentes no Supabase → banner com o SQL pronto (mesmo padrão do
 *   painel de craft): a leitura devolve as estações default e os saves dão 503.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Factory,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { fetchGeneratorManifest } from '../../../lib/character-generator/manifest';
import type { GeneratorManifest } from '../../../lib/character-generator/types';
import type { CraftItemConfig, CraftRecipeConfig } from '../../../shared/craft/CraftShapes';
import {
  DEFAULT_BUTTON_LABEL,
  MAX_BUTTON_LABEL_LEN,
  MAX_LAYOUT_ROWS,
  MAX_ROW_ITEMS,
  MAX_STATION_TABS,
  MAX_TAB_NAME_LEN,
  tabIdFromName,
  type StationConfig,
  type StationTabConfig,
} from '../../../shared/craft/StationShapes';
import { buildCraftCatalog } from '../../../lib/craft/craftCatalog';
import { RigApiError } from '../rig-editor/rigApi';
import { craftApi } from '../craft/craftApi';
import { CatalogThumb } from '../craft/CatalogThumb';
import { stationsApi } from './stationsApi';
import {
  STATION_ICONS,
  StationPreview,
  type StationDrop,
  type StationEditHandlers,
  type StationItemView,
} from './StationPreview';

export function StationsControllerPage() {
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

  // ------------------------------------------------------------------ dados
  const [manifest, setManifest] = useState<GeneratorManifest | null>(null);
  const [items, setItems] = useState<Record<string, CraftItemConfig>>({});
  const [recipes, setRecipes] = useState<Record<string, CraftRecipeConfig>>({});
  const [stations, setStations] = useState<StationConfig[]>([]);
  const [members, setMembers] = useState<Record<string, string>>({});
  const [tableMissing, setTableMissing] = useState(false);
  const [tableSql, setTableSql] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [savingCount, setSavingCount] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);
  const [copied, setCopied] = useState(false);

  // ---------------------------------------------------------------- seleção
  const [selStationId, setSelStationId] = useState<string>('forja');
  const [tabIndexByStation, setTabIndexByStation] = useState<Record<string, number>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingTab, setEditingTab] = useState<{ tabId: string; focus: 'name' | 'label' } | null>(null);
  const [newTabName, setNewTabName] = useState('');

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
      const [itemsRes, recipesRes, stRes] = await Promise.all([
        craftApi.items.list(),
        craftApi.recipes.list(),
        stationsApi.list(),
      ]);
      setItems(itemsRes.items ?? {});
      setRecipes(recipesRes.recipes ?? {});
      setStations(stRes.stations ?? []);
      setMembers(stRes.members ?? {});
      // Recarga = nova fonte da verdade; saves em voo ficam órfãos de
      // propósito (a checagem de identidade dos refs descarta as respostas).
      desiredRef.current = {};
      savedRef.current = {};
      setTableMissing(stRes.tableMissing);
      setTableSql(stRes.tableMissing ? (stRes.tableSql ?? null) : null);
      if (stRes.invalidIds && stRes.invalidIds.length > 0) {
        setError(`Registros de estação com JSON inválido no banco (ignorados): ${stRes.invalidIds.join(', ')}`);
      }
      setSelStationId((prev) =>
        (stRes.stations ?? []).some((s) => s.stationId === prev)
          ? prev
          : (stRes.stations?.[0]?.stationId ?? prev),
      );
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
      .catch(() => {
        /* thumbs dos itens built-in ficam sem sprite; nomes ainda aparecem */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!savedFlash) return;
    const t = setTimeout(() => setSavedFlash(false), 1600);
    return () => clearTimeout(t);
  }, [savedFlash]);

  // ---------------------------------------------------------------- derivados
  const catalog = useMemo(() => buildCraftCatalog(manifest, items), [manifest, items]);

  const station = useMemo(
    () => stations.find((s) => s.stationId === selStationId) ?? stations[0] ?? null,
    [stations, selStationId],
  );

  /**
   * Cópia SANITIZADA da estação ativa: rows só com itens que (a) ainda são
   * membros desta estação e (b) existem no catálogo. O preview e TODAS as
   * mutações de layout trabalham sobre ela — qualquer save persiste a versão
   * limpa (auto-cura de referências penduradas).
   */
  const displayStation = useMemo(() => {
    if (!station) return null;
    return {
      ...station,
      tabs: station.tabs.map((t) => ({
        ...t,
        rows: t.rows
          .map((row) => row.filter((id) => members[id] === station.stationId && catalog.byId.has(id)))
          .filter((row) => row.length > 0),
      })),
    };
  }, [station, members, catalog]);

  const activeTabIndex = useMemo(() => {
    const n = displayStation?.tabs.length ?? 0;
    const raw = tabIndexByStation[displayStation?.stationId ?? ''] ?? 0;
    return Math.min(Math.max(raw, 0), Math.max(n - 1, 0));
  }, [displayStation, tabIndexByStation]);

  const resolveItem = useCallback(
    (id: string): StationItemView | null => {
      const entry = catalog.byId.get(id);
      return entry ? { name: entry.name, thumb: entry.thumb } : null;
    },
    [catalog],
  );

  /** Inventário SIMULADO determinístico (hash do id) — só para o preview. */
  const simulatedInventory = useMemo(() => {
    const inv: Record<string, number> = {};
    for (const id of catalog.byId.keys()) {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      inv[id] = h % 5 === 0 ? 0 : h % 41;
    }
    return inv;
  }, [catalog]);

  /** Itens vinculados à estação ativa, separados em posicionados/livres. */
  const stationItems = useMemo(() => {
    if (!displayStation) return { placed: [], free: [] as { id: string; view: StationItemView }[] };
    const placedSet = new Set<string>();
    for (const tab of displayStation.tabs) for (const row of tab.rows) for (const id of row) placedSet.add(id);
    const placed: { id: string; view: StationItemView }[] = [];
    const free: { id: string; view: StationItemView }[] = [];
    for (const [id, stId] of Object.entries(members)) {
      if (stId !== displayStation.stationId) continue;
      const view = resolveItem(id);
      if (!view) continue;
      (placedSet.has(id) ? placed : free).push({ id, view });
    }
    const byName = (a: { view: StationItemView }, b: { view: StationItemView }) =>
      a.view.name.localeCompare(b.view.name);
    placed.sort(byName);
    free.sort(byName);
    return { placed, free };
  }, [displayStation, members, resolveItem]);

  // ------------------------------------------------------------------ saves
  // A config da estação é salva como documento COMPLETO, então os PUTs são
  // serializados POR ESTAÇÃO com "latest wins": arrastos rápidos coalescem no
  // estado mais novo, respostas antigas nunca sobrescrevem estado novo e um
  // PUT atrasado nunca vira o valor final no banco.
  const desiredRef = useRef<Record<string, StationConfig>>({});
  const savedRef = useRef<Record<string, StationConfig>>({});
  const saveInFlight = useRef<Set<string>>(new Set());

  const pumpSave = useCallback(
    async (stationId: string) => {
      if (saveInFlight.current.has(stationId)) return;
      saveInFlight.current.add(stationId);
      try {
        while (
          desiredRef.current[stationId] &&
          desiredRef.current[stationId] !== savedRef.current[stationId]
        ) {
          const desired = desiredRef.current[stationId];
          if (!desired) break;
          setSavingCount((n) => n + 1);
          try {
            const res = await stationsApi.saveStation(desired);
            savedRef.current[stationId] = desired;
            if (desiredRef.current[stationId] === desired) {
              // Ainda é o desejo mais novo → adota a versão normalizada.
              desiredRef.current[stationId] = res.station;
              savedRef.current[stationId] = res.station;
              setStations((prev) => prev.map((s) => (s.stationId === stationId ? res.station : s)));
              setSavedFlash(true);
            }
          } catch (e) {
            if (desiredRef.current[stationId] === desired) {
              // Erro no estado mais novo: mantém o otimista na tela e mostra o
              // erro (sem loadAll automático — evitaria snapshot parcial com
              // saves em voo). O próximo save reenvia a config completa.
              applyApiError(e);
              break;
            }
            // Superado por config mais nova → tenta ela na próxima volta.
          } finally {
            setSavingCount((n) => n - 1);
          }
        }
      } finally {
        saveInFlight.current.delete(stationId);
      }
    },
    [applyApiError],
  );

  const persistStation = useCallback(
    (next: StationConfig) => {
      setStations((prev) => prev.map((s) => (s.stationId === next.stationId ? next : s)));
      desiredRef.current[next.stationId] = next;
      void pumpSave(next.stationId);
    },
    [pumpSave],
  );

  // ---------------------------------------------------------------- abas
  const handleAddTab = useCallback(() => {
    if (!displayStation) return;
    if (displayStation.tabs.length >= MAX_STATION_TABS) {
      setError(`Máximo de ${MAX_STATION_TABS} abas por estação.`);
      return;
    }
    const name = (newTabName.trim() || `Aba ${displayStation.tabs.length + 1}`).slice(0, MAX_TAB_NAME_LEN);
    const id = tabIdFromName(name, new Set(displayStation.tabs.map((t) => t.id)));
    const next: StationConfig = {
      ...displayStation,
      tabs: [...displayStation.tabs, { id, name, buttonLabel: DEFAULT_BUTTON_LABEL, rows: [] }],
    };
    setNewTabName('');
    setTabIndexByStation((m) => ({ ...m, [next.stationId]: next.tabs.length - 1 }));
    void persistStation(next);
  }, [displayStation, newTabName, persistStation]);

  const updateTab = useCallback(
    (tabId: string, patch: Partial<StationTabConfig>) => {
      if (!displayStation) return;
      const next: StationConfig = {
        ...displayStation,
        tabs: displayStation.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)),
      };
      void persistStation(next);
    },
    [displayStation, persistStation],
  );

  const deleteTab = useCallback(
    (tab: StationTabConfig) => {
      if (!displayStation) return;
      if (!window.confirm(`Excluir a aba "${tab.name}"? Os itens dela voltam para a lista de disponíveis.`)) {
        return;
      }
      const next: StationConfig = {
        ...displayStation,
        tabs: displayStation.tabs.filter((t) => t.id !== tab.id),
      };
      setTabIndexByStation((m) => ({ ...m, [next.stationId]: 0 }));
      setEditingTab(null);
      void persistStation(next);
    },
    [displayStation, persistStation],
  );

  const moveTab = useCallback(
    (index: number, dir: -1 | 1) => {
      if (!displayStation) return;
      const j = index + dir;
      if (j < 0 || j >= displayStation.tabs.length) return;
      const tabs = [...displayStation.tabs];
      [tabs[index], tabs[j]] = [tabs[j], tabs[index]];
      setTabIndexByStation((m) => ({ ...m, [displayStation.stationId]: j }));
      void persistStation({ ...displayStation, tabs });
    },
    [displayStation, persistStation],
  );

  // ---------------------------------------------------------------- layout
  const handleDrop = useCallback(
    (drop: StationDrop) => {
      if (!displayStation) return;
      const tab = displayStation.tabs[activeTabIndex];
      if (!tab) return;
      if (members[drop.itemId] !== displayStation.stationId) return;

      // Posição original DENTRO da aba ativa (para corrigir índices no move).
      let src: { r: number; c: number } | null = null;
      for (let r = 0; r < tab.rows.length && !src; r++) {
        const c = tab.rows[r].indexOf(drop.itemId);
        if (c >= 0) src = { r, c };
      }

      let { rowIndex, colIndex } = drop;
      // Remove o item de TODAS as abas da estação (mover entre abas não duplica).
      const cleanTabs = displayStation.tabs.map((t) => ({
        ...t,
        rows: t.rows.map((row) => row.filter((id) => id !== drop.itemId)),
      }));
      let rows = cleanTabs[activeTabIndex].rows;
      if (src) {
        if (!drop.newRow && src.r === rowIndex && src.c < colIndex) colIndex -= 1;
        if (rows[src.r]?.length === 0) {
          rows = rows.filter((_, i) => i !== src.r);
          if (src.r < rowIndex) rowIndex -= 1;
        }
      }
      rows = rows.filter((row) => row.length > 0);

      if (drop.newRow) {
        if (rows.length >= MAX_LAYOUT_ROWS) {
          setError(`Máximo de ${MAX_LAYOUT_ROWS} linhas por aba.`);
          return;
        }
        rows.splice(Math.min(Math.max(rowIndex, 0), rows.length), 0, [drop.itemId]);
      } else if (rows.length === 0) {
        rows = [[drop.itemId]];
      } else {
        const r = Math.min(Math.max(rowIndex, 0), rows.length - 1);
        const target = [...rows[r]];
        if (target.length >= MAX_ROW_ITEMS) {
          setError(`Máximo de ${MAX_ROW_ITEMS} itens por linha.`);
          return;
        }
        target.splice(Math.min(Math.max(colIndex, 0), target.length), 0, drop.itemId);
        rows = rows.map((row, i) => (i === r ? target : row));
      }

      const nextTabs = cleanTabs.map((t, i) =>
        i === activeTabIndex ? { ...t, rows } : { ...t, rows: t.rows.filter((row) => row.length > 0) },
      );
      void persistStation({ ...displayStation, tabs: nextTabs });
    },
    [displayStation, activeTabIndex, members, persistStation],
  );

  const handleRemoveItem = useCallback(
    (itemId: string) => {
      if (!displayStation) return;
      const nextTabs = displayStation.tabs.map((t) => ({
        ...t,
        rows: t.rows.map((row) => row.filter((id) => id !== itemId)).filter((row) => row.length > 0),
      }));
      void persistStation({ ...displayStation, tabs: nextTabs });
    },
    [displayStation, persistStation],
  );

  const editHandlers: StationEditHandlers | undefined = displayStation
    ? {
        draggingId,
        onDragStart: (id) => setDraggingId(id),
        onDragEnd: () => setDraggingId(null),
        onDropItem: handleDrop,
        onRemoveItem: handleRemoveItem,
        onAddTab: handleAddTab,
        onEditButtonLabel: (tabId) => setEditingTab({ tabId, focus: 'label' }),
      }
    : undefined;

  const copySql = async () => {
    if (!tableSql) return;
    try {
      await navigator.clipboard.writeText(tableSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard bloqueado — usuário copia manualmente do <pre> */
    }
  };

  // ---------------------------------------------------------------- render
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-20">
      <div className="max-w-7xl mx-auto px-4 pt-6">
        {/* Cabeçalho */}
        <div className="flex items-center gap-3 mb-5">
          <a
            href="/admin"
            className="flex items-center justify-center w-10 h-10 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-slate-300" />
          </a>
          <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
            <Factory className="w-5 h-5 text-orange-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-white">Stations Controller</h1>
            <p className="text-sm text-slate-400">
              Estações de criação: abas, layout dos itens e preview idêntico ao do jogo
            </p>
          </div>
          {savingCount > 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-slate-300">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvando…
            </span>
          ) : savedFlash ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <Check className="w-3.5 h-3.5" /> Salvo
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Recarregar
          </button>
        </div>

        {/* Banners */}
        {error && (
          <div className="mb-4 px-4 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-sm text-rose-300 flex items-start justify-between gap-3">
            <span className="min-w-0 break-words">{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200 shrink-0">
              ×
            </button>
          </div>
        )}
        {tableMissing && (
          <div className="mb-4 rounded-lg bg-amber-500/10 border border-amber-500/30 p-4">
            <p className="text-sm text-amber-300 font-medium mb-1">
              As tabelas das estações ainda não existem no Supabase
            </p>
            <p className="text-xs text-amber-200/80 mb-3">
              Rode o SQL abaixo no Supabase (SQL Editor) e clique em “Re-checar”. Até lá dá para navegar,
              mas nada é salvo.
            </p>
            {tableSql && (
              <pre className="text-[11px] leading-relaxed text-amber-100/90 bg-black/50 rounded-md p-3 overflow-x-auto mb-3">
                {tableSql}
              </pre>
            )}
            <div className="flex gap-2">
              {tableSql && (
                <button
                  type="button"
                  onClick={() => void copySql()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" /> {copied ? 'Copiado!' : 'Copiar SQL'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void loadAll()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors disabled:opacity-40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Re-checar
              </button>
            </div>
          </div>
        )}

        {!loaded ? (
          <div className="py-24 flex items-center justify-center gap-3 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" /> Carregando estações…
          </div>
        ) : !displayStation ? (
          <p className="py-24 text-center text-sm text-slate-500">
            Nenhuma estação disponível — verifique o login e o servidor.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)_290px] gap-5 items-start">
            {/* ---------------------------------------------- coluna: estações + abas */}
            <aside className="space-y-4">
              <section className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-3">
                <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-mono mb-2 px-1">
                  Estações
                </h2>
                <div className="flex flex-col gap-1.5">
                  {stations.map((s) => {
                    const Icon = STATION_ICONS[s.icon] ?? Factory;
                    const active = s.stationId === displayStation.stationId;
                    const memberCount = Object.values(members).filter((v) => v === s.stationId).length;
                    return (
                      <button
                        key={s.stationId}
                        type="button"
                        onClick={() => setSelStationId(s.stationId)}
                        className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all ${
                          active
                            ? 'border-slate-500 bg-slate-800/80 ring-1 ring-slate-500/50'
                            : 'border-slate-700/50 bg-slate-950/40 hover:border-slate-500/60'
                        }`}
                      >
                        <span
                          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `${s.color}33` }}
                        >
                          <Icon className="w-4 h-4" style={{ color: s.color }} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium text-slate-200 truncate">{s.name}</span>
                          <span className="block text-[10px] text-slate-500">
                            {s.tabs.length} aba{s.tabs.length === 1 ? '' : 's'} · {memberCount} ite
                            {memberCount === 1 ? 'm' : 'ns'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-3">
                <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-mono mb-2 px-1">
                  Abas de {displayStation.name}
                </h2>
                <div className="flex flex-col gap-1.5">
                  {displayStation.tabs.length === 0 && (
                    <p className="text-xs text-slate-500 italic px-1 py-1">
                      Nenhuma aba ainda — crie a primeira abaixo.
                    </p>
                  )}
                  {displayStation.tabs.map((tab, i) =>
                    editingTab?.tabId === tab.id ? (
                      <TabEditor
                        key={tab.id}
                        tab={tab}
                        focus={editingTab.focus}
                        onSave={(name, label) => {
                          updateTab(tab.id, {
                            name: name.trim().slice(0, MAX_TAB_NAME_LEN) || tab.name,
                            buttonLabel: label.trim().slice(0, MAX_BUTTON_LABEL_LEN) || DEFAULT_BUTTON_LABEL,
                          });
                          setEditingTab(null);
                        }}
                        onCancel={() => setEditingTab(null)}
                      />
                    ) : (
                      <div
                        key={tab.id}
                        className={`flex items-center gap-1 rounded-lg border px-1.5 py-1.5 ${
                          i === activeTabIndex
                            ? 'border-slate-500 bg-slate-800/80'
                            : 'border-slate-700/50 bg-slate-950/40'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setTabIndexByStation((m) => ({ ...m, [displayStation.stationId]: i }))
                          }
                          className="flex-1 min-w-0 text-left px-1"
                        >
                          <span className="block text-xs text-slate-200 truncate">{tab.name}</span>
                          <span className="block text-[10px] text-slate-500 truncate">
                            botão: “{tab.buttonLabel}”
                          </span>
                        </button>
                        <button
                          type="button"
                          title="Subir"
                          disabled={i === 0}
                          onClick={() => moveTab(i, -1)}
                          className="p-1 rounded text-slate-500 hover:text-slate-200 disabled:opacity-30"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Descer"
                          disabled={i === displayStation.tabs.length - 1}
                          onClick={() => moveTab(i, 1)}
                          className="p-1 rounded text-slate-500 hover:text-slate-200 disabled:opacity-30"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Renomear aba e botão"
                          onClick={() => setEditingTab({ tabId: tab.id, focus: 'name' })}
                          className="p-1 rounded text-slate-400 hover:text-slate-100"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Excluir aba"
                          onClick={() => deleteTab(tab)}
                          className="p-1 rounded text-slate-400 hover:text-rose-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ),
                  )}
                  <div className="flex gap-1.5 mt-1">
                    <input
                      value={newTabName}
                      onChange={(e) => setNewTabName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddTab();
                      }}
                      maxLength={MAX_TAB_NAME_LEN}
                      placeholder="Nome da nova aba"
                      className="flex-1 min-w-0 rounded-md border border-slate-700/60 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/60"
                    />
                    <button
                      type="button"
                      onClick={handleAddTab}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Criar
                    </button>
                  </div>
                </div>
              </section>
            </aside>

            {/* ---------------------------------------------- coluna: preview */}
            <main className="flex flex-col items-center gap-3">
              <StationPreview
                station={displayStation}
                activeTabIndex={activeTabIndex}
                onSelectTab={(i) =>
                  setTabIndexByStation((m) => ({ ...m, [displayStation.stationId]: i }))
                }
                resolveItem={resolveItem}
                recipes={recipes}
                inventory={simulatedInventory}
                edit={editHandlers}
              />
              <p className="max-w-[380px] text-center text-[11px] text-slate-500 leading-relaxed">
                Espelho exato do painel do jogo. Os números do inventário são{' '}
                <span className="text-slate-400">simulados</span> aqui só para demonstrar os estados
                verde/vermelho — no jogo valem os itens reais do jogador.
              </p>
            </main>

            {/* ---------------------------------------------- coluna: itens */}
            <aside className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-3">
              <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-mono mb-2 px-1">
                Itens de {displayStation.name}
              </h2>
              {stationItems.free.length === 0 && stationItems.placed.length === 0 ? (
                <p className="text-xs text-slate-500 px-1 py-2 leading-relaxed">
                  Nenhum item vinculado a esta estação ainda. Vincule pelo select nos cards do{' '}
                  <a href="/admin/craft" className="text-cyan-400 hover:underline">
                    painel de receitas
                  </a>
                  .
                </p>
              ) : (
                <>
                  <p className="text-[10px] text-slate-500 px-1 mb-2">
                    Arraste para o preview: ao lado de um item = mesma linha; abaixo = nova linha.
                  </p>
                  <div className="flex flex-col gap-1.5 max-h-[420px] overflow-y-auto pr-1">
                    {stationItems.free.map(({ id, view }) => (
                      <div
                        key={id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', id);
                          e.dataTransfer.effectAllowed = 'move';
                          setDraggingId(id);
                        }}
                        onDragEnd={() => setDraggingId(null)}
                        className={`flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-950/40 px-2 py-1.5 cursor-grab active:cursor-grabbing hover:border-slate-500/60 transition-colors ${
                          draggingId === id ? 'opacity-40' : ''
                        }`}
                      >
                        <GripVertical className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                        <CatalogThumb thumb={view.thumb} size={32} />
                        <span className="text-xs text-slate-200 truncate">{view.name}</span>
                      </div>
                    ))}
                    {stationItems.placed.length > 0 && (
                      <p className="text-[10px] uppercase tracking-widest text-slate-600 font-mono px-1 pt-2">
                        No layout ({stationItems.placed.length})
                      </p>
                    )}
                    {stationItems.placed.map(({ id, view }) => (
                      <div
                        key={id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', id);
                          e.dataTransfer.effectAllowed = 'move';
                          setDraggingId(id);
                        }}
                        onDragEnd={() => setDraggingId(null)}
                        className={`flex items-center gap-2 rounded-lg border border-slate-800/60 bg-slate-950/20 px-2 py-1.5 cursor-grab active:cursor-grabbing opacity-60 hover:opacity-90 transition-opacity ${
                          draggingId === id ? 'opacity-30' : ''
                        }`}
                        title="Já está no layout — arraste para reposicionar"
                      >
                        <GripVertical className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                        <CatalogThumb thumb={view.thumb} size={32} />
                        <span className="text-xs text-slate-400 truncate">{view.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

/** Editor inline de uma aba: nome + rótulo do botão de criação. */
function TabEditor({
  tab,
  focus,
  onSave,
  onCancel,
}: {
  tab: StationTabConfig;
  focus: 'name' | 'label';
  onSave: (name: string, label: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(tab.name);
  const [label, setLabel] = useState(tab.buttonLabel);
  const nameRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (focus === 'label' ? labelRef : nameRef).current?.focus();
  }, [focus]);

  const submit = () => onSave(name, label);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="rounded-lg border border-cyan-500/40 bg-slate-950/60 p-2 space-y-1.5">
      <label className="block">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">Nome da aba</span>
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKey}
          maxLength={MAX_TAB_NAME_LEN}
          className="mt-0.5 w-full rounded-md border border-slate-700/60 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/60"
        />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">Rótulo do botão (ex.: Forjar)</span>
        <input
          ref={labelRef}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={onKey}
          maxLength={MAX_BUTTON_LABEL_LEN}
          className="mt-0.5 w-full rounded-md border border-slate-700/60 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/60"
        />
      </label>
      <div className="flex gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={submit}
          className="flex-1 px-2 py-1 rounded-md text-xs font-medium bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition-colors"
        >
          Salvar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1 rounded-md text-xs text-slate-400 hover:text-slate-200 border border-slate-700/60 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
