/**
 * StationPreview — o painel de estação EXATAMENTE como aparecerá no jogo
 * (spec: /admin/stations), com afford​ances de edição opcionais por cima.
 *
 * O mesmo componente serve os dois mundos:
 *   - /admin/stations passa `edit` (drag-and-drop de itens, "+" de aba,
 *     lápis no botão de criação) e um inventário SIMULADO;
 *   - o jogo (integração futura) renderiza sem `edit`, com o inventário real
 *     do jogador e onClose ligado.
 *
 * Regras do layout (spec do usuário):
 *   - itens em LINHAS horizontais; cada linha rola na horizontal SEM barra
 *     visível (classe .no-scrollbar + máscara de fade nas bordas);
 *   - o jogador vê até 3 linhas (~248px); mais linhas = rolagem vertical;
 *   - clicar num item mostra nome + receita (precisa/tem, verde/vermelho),
 *     quantidade (− n + Máx) e o botão da aba (rótulo configurável);
 *   - criar = loader fictício → item + quantidade + "Já disponível no
 *     inventário" (a integração real troca o loader pela chamada de craft).
 *
 * IMPORTANTE: o pai deve passar `station` já SANITIZADA (rows filtradas para
 * itens que existem no catálogo e pertencem à estação) — os índices de drop
 * apontam direto para os arrays de `rows`.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  Flame,
  FlaskConical,
  Hammer,
  Loader2,
  Pencil,
  Plus,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  recipeOutputQuantity,
  type CraftRecipeConfig,
} from '../../../shared/craft/CraftShapes';
import {
  DEFAULT_BUTTON_LABEL,
  type StationConfig,
  type StationIconKey,
} from '../../../shared/craft/StationShapes';
import type { CraftThumb } from '../../../lib/craft/craftCatalog';
import { CatalogThumb } from '../craft/CatalogThumb';

export const STATION_ICONS: Record<StationIconKey, LucideIcon> = {
  hammer: Hammer,
  tools: Wrench,
  flame: Flame,
  flask: FlaskConical,
};

export interface StationItemView {
  name: string;
  thumb: CraftThumb;
}

export interface StationDrop {
  rowIndex: number;
  colIndex: number;
  newRow: boolean;
  itemId: string;
}

export interface StationEditHandlers {
  /** Item sendo arrastado agora (da lista lateral OU de uma célula). */
  draggingId: string | null;
  onDragStart: (itemId: string) => void;
  onDragEnd: () => void;
  onDropItem: (drop: StationDrop) => void;
  onRemoveItem: (itemId: string) => void;
  onAddTab: () => void;
  onEditButtonLabel: (tabId: string) => void;
}

type CellState = 'ok' | 'missing' | 'none';
type Phase = 'idle' | 'crafting' | 'done';

const CELL = 64;
const ROW_FADE: React.CSSProperties = {
  maskImage: 'linear-gradient(to right, transparent, black 14px, black calc(100% - 14px), transparent)',
  WebkitMaskImage:
    'linear-gradient(to right, transparent, black 14px, black calc(100% - 14px), transparent)',
};

export function StationPreview({
  station,
  activeTabIndex,
  onSelectTab,
  resolveItem,
  recipes,
  inventory,
  edit,
  onClose,
  onCraft,
  banner,
}: {
  station: StationConfig;
  activeTabIndex: number;
  onSelectTab: (index: number) => void;
  resolveItem: (id: string) => StationItemView | null;
  recipes: Readonly<Record<string, CraftRecipeConfig>>;
  inventory: Readonly<Record<string, number>>;
  edit?: StationEditHandlers;
  /** Provided by the game runtime; admin preview intentionally omits it. */
  onClose?: () => void;
  /** Real crafting hook. When omitted the admin keeps its simulated loader. */
  onCraft?: (targetId: string, quantity: number) => Promise<void>;
  /** Faixa extra logo abaixo do cabeçalho (ex.: estado da estação portátil). */
  banner?: ReactNode;
}) {
  const tabs = station.tabs;
  const tabIndex = Math.min(Math.max(activeTabIndex, 0), Math.max(tabs.length - 1, 0));
  const activeTab = tabs[tabIndex];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [phase, setPhase] = useState<Phase>('idle');
  /** Posição de inserção durante o arrasto: barra antes de rows[r][c]. */
  const [hoverSlot, setHoverSlot] = useState<{ r: number; c: number } | null>(null);
  const craftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelCraftTimer = () => {
    if (craftTimer.current) {
      clearTimeout(craftTimer.current);
      craftTimer.current = null;
    }
  };

  // Troca de estação/aba = seleção, fluxo e loader pendente zerados (espelha
  // o jogo — um timer da aba anterior nunca pode "completar" na nova).
  useEffect(() => {
    cancelCraftTimer();
    setSelectedId(null);
    setQty(1);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station.stationId, tabIndex]);

  useEffect(() => {
    if (!edit?.draggingId) setHoverSlot(null);
  }, [edit?.draggingId]);

  useEffect(
    () => () => {
      if (craftTimer.current) clearTimeout(craftTimer.current);
    },
    [],
  );

  const cellState = (itemId: string): CellState => {
    const recipe = recipes[itemId];
    if (!recipe) return 'none';
    for (const ing of recipe.ingredients) {
      if ((inventory[ing.itemId] ?? 0) < ing.quantity) return 'missing';
    }
    return 'ok';
  };

  const selectedView = selectedId ? resolveItem(selectedId) : null;
  const selectedRecipe = selectedId ? (recipes[selectedId] ?? null) : null;
  const output = selectedRecipe ? recipeOutputQuantity(selectedRecipe) : 1;

  const maxCraftable = useMemo(() => {
    if (!selectedRecipe) return 1;
    let max = Infinity;
    for (const ing of selectedRecipe.ingredients) {
      max = Math.min(max, Math.floor((inventory[ing.itemId] ?? 0) / ing.quantity));
    }
    return Math.max(1, Math.min(Number.isFinite(max) ? max : 1, 999));
  }, [selectedRecipe, inventory]);

  const canCraft =
    !!selectedRecipe &&
    selectedRecipe.ingredients.every((ing) => (inventory[ing.itemId] ?? 0) >= ing.quantity * qty);

  const startCraft = async () => {
    if (!canCraft || phase !== 'idle') return;
    setPhase('crafting');
    if (onCraft && selectedId) {
      try {
        await onCraft(selectedId, qty);
        setPhase('done');
      } catch {
        setPhase('idle');
      }
      return;
    }
    craftTimer.current = setTimeout(() => {
      craftTimer.current = null;
      setPhase('done');
    }, 1300);
  };

  const selectItem = (id: string) => {
    if (edit?.draggingId) return;
    cancelCraftTimer();
    setSelectedId((prev) => (prev === id ? prev : id));
    setQty(1);
    setPhase('idle');
  };

  // ------------------------------------------------------------------ drag
  const allowDrop = (e: React.DragEvent) => {
    if (!edit?.draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const droppedId = (e: React.DragEvent): string | null => {
    const id = e.dataTransfer.getData('text/plain');
    return id || edit?.draggingId || null;
  };
  const dropAt = (e: React.DragEvent, drop: Omit<StationDrop, 'itemId'>) => {
    e.preventDefault();
    e.stopPropagation();
    setHoverSlot(null);
    const itemId = droppedId(e);
    if (itemId && edit) edit.onDropItem({ ...drop, itemId });
  };

  const accent = station.color;
  const HeaderIcon = STATION_ICONS[station.icon] ?? Hammer;

  // ------------------------------------------------------------------ render
  return (
    <div className="w-[380px] max-w-full rounded-[26px] overflow-hidden bg-[#0c0c0e] border border-neutral-800 shadow-2xl select-none">
      {/* Cabeçalho colorido da estação */}
      <div className="flex items-center gap-3 px-5 py-4" style={{ backgroundColor: accent }}>
        <HeaderIcon className="w-6 h-6 text-white shrink-0" />
        <h2 className="text-white text-xl font-bold flex-1 truncate">{station.name}</h2>
        <button type="button" onClick={onClose} className="p-1 rounded-md text-white/85 hover:text-white" title="Fechar">
          <X className="w-6 h-6" />
        </button>
      </div>
      {banner}

      {/* Abas */}
      <div className="bg-[#141416] flex items-stretch">
        <div className="flex-1 flex overflow-x-auto no-scrollbar px-1">
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(i)}
              className={`relative px-4 py-3.5 text-[15px] font-medium whitespace-nowrap transition-colors ${
                i === tabIndex ? 'text-white' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {tab.name}
              {i === tabIndex && (
                <span
                  className="absolute left-3 right-3 bottom-0 h-[3px] rounded-full"
                  style={{ backgroundColor: accent }}
                />
              )}
            </button>
          ))}
          {tabs.length === 0 && (
            <span className="px-4 py-3.5 text-[13px] text-neutral-500 italic whitespace-nowrap">
              Nenhuma aba criada
            </span>
          )}
        </div>
        {edit && (
          <button
            type="button"
            onClick={edit.onAddTab}
            className="px-3 my-2 mr-2 rounded-lg border border-dashed border-neutral-600 text-neutral-400 hover:text-white hover:border-neutral-400 transition-colors shrink-0"
            title="Nova aba"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Grade de itens: linhas com scroll horizontal; 3 linhas visíveis */}
      <div className="bg-[#141416] border-t border-black/40 px-4 pt-3 pb-4">
        {!activeTab ? (
          <div className="py-8 text-center text-[13px] text-neutral-500">
            Crie uma aba para começar a montar o layout.
          </div>
        ) : (
          <div className="max-h-[252px] overflow-y-auto no-scrollbar">
            {activeTab.rows.length === 0 && (
              <div
                onDragOver={allowDrop}
                onDrop={(e) => dropAt(e, { rowIndex: 0, colIndex: 0, newRow: true })}
                className={`h-24 rounded-2xl border-2 border-dashed flex items-center justify-center text-[13px] transition-colors ${
                  edit?.draggingId
                    ? 'border-neutral-400 text-neutral-300 bg-white/5'
                    : 'border-neutral-700/80 text-neutral-500'
                }`}
              >
                {edit
                  ? edit.draggingId
                    ? 'Solte aqui para criar a primeira linha'
                    : 'Arraste itens da lista ao lado para cá'
                  : 'Nenhum item nesta aba ainda'}
              </div>
            )}
            {activeTab.rows.map((row, r) => (
              <div key={r}>
                <div
                  className="flex items-center gap-3 overflow-x-auto no-scrollbar py-1.5"
                  style={ROW_FADE}
                  onDragOver={(e) => {
                    allowDrop(e);
                    if (edit?.draggingId) setHoverSlot({ r, c: row.length });
                  }}
                  onDrop={(e) => dropAt(e, { rowIndex: r, colIndex: row.length, newRow: false })}
                >
                  {row.map((itemId, c) => {
                    const view = resolveItem(itemId);
                    if (!view) return null;
                    const state = cellState(itemId);
                    const selected = itemId === selectedId;
                    return (
                      <span key={itemId} className="flex items-center gap-0 shrink-0">
                        {hoverSlot && hoverSlot.r === r && hoverSlot.c === c && (
                          <span className="w-[3px] h-14 rounded bg-white/80 mr-2" />
                        )}
                        <span className="relative group">
                          <button
                            type="button"
                            draggable={!!edit}
                            onDragStart={(e) => {
                              if (!edit) return;
                              e.dataTransfer.setData('text/plain', itemId);
                              e.dataTransfer.effectAllowed = 'move';
                              edit.onDragStart(itemId);
                            }}
                            onDragEnd={() => edit?.onDragEnd()}
                            onDragOver={(e) => {
                              if (!edit?.draggingId) return;
                              e.preventDefault();
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              const before = e.clientX - rect.left < rect.width / 2;
                              setHoverSlot({ r, c: before ? c : c + 1 });
                            }}
                            onDrop={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const before = e.clientX - rect.left < rect.width / 2;
                              dropAt(e, { rowIndex: r, colIndex: before ? c : c + 1, newRow: false });
                            }}
                            onClick={() => selectItem(itemId)}
                            className={`rounded-2xl border-2 flex items-center justify-center transition-all ${
                              state === 'ok'
                                ? 'bg-[#eaf4e2] border-[#5a9e3d]'
                                : state === 'missing'
                                  ? 'bg-[#f8ecd9] border-[#d9a04a]'
                                  : 'bg-[#1d1d20] border-[#2c2c30]'
                            } ${selected ? 'scale-[1.05]' : 'hover:scale-[1.03]'} ${
                              edit?.draggingId === itemId ? 'opacity-40' : ''
                            }`}
                            style={{
                              width: CELL,
                              height: CELL,
                              boxShadow: selected ? `0 0 0 2px #141416, 0 0 0 4px ${accent}` : undefined,
                            }}
                            title={view.name}
                          >
                            <span className={state === 'none' ? 'opacity-45' : ''}>
                              <CatalogThumb thumb={view.thumb} size={46} bare />
                            </span>
                          </button>
                          {edit && !edit.draggingId && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                edit.onRemoveItem(itemId);
                              }}
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white hidden group-hover:flex items-center justify-center shadow"
                              title="Remover do layout"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                        {hoverSlot && hoverSlot.r === r && hoverSlot.c === row.length && c === row.length - 1 && (
                          <span className="w-[3px] h-14 rounded bg-white/80 ml-2" />
                        )}
                      </span>
                    );
                  })}
                </div>
                {edit?.draggingId && (
                  <div
                    onDragOver={allowDrop}
                    onDrop={(e) => dropAt(e, { rowIndex: r + 1, colIndex: 0, newRow: true })}
                    className="h-8 my-1 rounded-xl border-2 border-dashed border-neutral-600/70 flex items-center justify-center text-[11px] text-neutral-400 bg-white/[0.03]"
                  >
                    solte aqui para nova linha
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detalhe do item selecionado */}
      <div className="bg-[#0c0c0e] border-t border-neutral-800 px-5 py-4 min-h-[120px]">
        {!selectedView || !selectedId ? (
          <p className="py-6 text-center text-[13px] text-neutral-500">
            Toque em um item para ver a receita
          </p>
        ) : phase === 'crafting' ? (
          <div className="py-8 flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-neutral-300 animate-spin" />
            <p className="text-[13px] text-neutral-400">
              {(activeTab?.buttonLabel ?? DEFAULT_BUTTON_LABEL) === DEFAULT_BUTTON_LABEL
                ? 'Criando'
                : activeTab?.buttonLabel}
              …
            </p>
          </div>
        ) : phase === 'done' ? (
          <div className="py-5 flex flex-col items-center gap-2">
            <div className="rounded-2xl bg-[#1d1d20] border border-neutral-700 p-2">
              <CatalogThumb thumb={selectedView.thumb} size={56} bare />
            </div>
            <p className="text-white text-lg font-bold">
              {selectedView.name} <span className="text-neutral-400 font-medium">x {qty * output}</span>
            </p>
            <p className="text-[14px] text-green-500 font-medium">Já disponível no inventário</p>
            <button
              type="button"
              onClick={() => setPhase('idle')}
              className="mt-1 text-[12px] text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              ← voltar
            </button>
          </div>
        ) : (
          <>
            <h3 className="text-white text-[19px] font-bold">{selectedView.name}</h3>
            <div className="my-3 border-t border-neutral-800" />
            {!selectedRecipe ? (
              <p className="pb-2 text-[13px] text-neutral-500">
                Sem receita definida para este item (configure no painel de receitas).
              </p>
            ) : (
              <>
                <div className="space-y-0.5">
                  {selectedRecipe.ingredients.map((ing) => {
                    const need = ing.quantity * qty;
                    const have = inventory[ing.itemId] ?? 0;
                    const ok = have >= need;
                    return (
                      <div key={ing.itemId} className="flex items-center justify-between py-1">
                        <span className="text-[15px] text-neutral-200">
                          {resolveItem(ing.itemId)?.name ?? ing.itemId}
                        </span>
                        <span
                          className={`flex items-center gap-1.5 text-[15px] font-semibold ${
                            ok ? 'text-green-500' : 'text-red-400'
                          }`}
                        >
                          {need} / {have}
                          {ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    className="w-11 h-11 rounded-xl bg-[#1d1d20] border border-neutral-700 text-white text-xl leading-none hover:border-neutral-500 transition-colors"
                  >
                    −
                  </button>
                  <span className="w-10 text-center text-white text-lg font-semibold">{qty}</span>
                  <button
                    type="button"
                    onClick={() => setQty((q) => Math.min(999, q + 1))}
                    className="w-11 h-11 rounded-xl bg-[#1d1d20] border border-neutral-700 text-white text-xl leading-none hover:border-neutral-500 transition-colors"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => setQty(maxCraftable)}
                    className={`px-4 h-11 rounded-xl border text-[15px] font-medium transition-colors ${
                      qty === maxCraftable && maxCraftable > 1
                        ? 'text-white'
                        : 'bg-[#1d1d20] border-neutral-700 text-neutral-200 hover:border-neutral-500'
                    }`}
                    style={
                      qty === maxCraftable && maxCraftable > 1
                        ? { backgroundColor: `${accent}26`, borderColor: accent }
                        : undefined
                    }
                  >
                    Máx
                  </button>
                </div>
                {(qty > 1 || output > 1) && (
                  <p className="mt-2 text-[12px] text-neutral-500">
                    {qty * output}x {selectedView.name} ={' '}
                    {selectedRecipe.ingredients
                      .map((ing) => `${ing.quantity * qty}x ${resolveItem(ing.itemId)?.name ?? ing.itemId}`)
                      .join(' + ')}
                  </p>
                )}
              </>
            )}
            <div className="relative mt-4">
              <button
                type="button"
                onClick={startCraft}
                disabled={!canCraft}
                className={`w-full h-12 rounded-xl text-[17px] font-semibold transition-colors ${
                  canCraft
                    ? 'bg-white text-black hover:bg-neutral-200'
                    : 'bg-[#1d1d20] text-neutral-500 cursor-not-allowed'
                }`}
              >
                {activeTab?.buttonLabel ?? DEFAULT_BUTTON_LABEL}
              </button>
              {edit && activeTab && (
                <button
                  type="button"
                  onClick={() => edit.onEditButtonLabel(activeTab.id)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                  title="Renomear o botão desta aba"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
