/**
 * Livro de Receitas — modal aberto pelo botão de livro no HUD. Lista TODOS os
 * itens que têm receita, agrupados pela estação que os cria (filiação do
 * admin de estações), com chips de filtro por estação e busca por texto
 * (nome do item OU de um ingrediente). Tocar num item abre a receita:
 * ingredientes com "tem/precisa" do inventário atual, alternativas ("ou") e
 * tempo de preparo, quantidade produzida e custo em gambits.
 *
 * Mobile: lista e detalhe alternam na mesma tela (botão voltar); desktop:
 * duas colunas lado a lado. Esc ou toque no fundo fecha.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Check, ChevronRight, Clock3, Coins, Search, X } from 'lucide-react';
import { CatalogThumb } from '../admin/craft/CatalogThumb';
import { STATION_ICONS } from '../admin/stations/StationPreview';
import { useRecipeBookData, type RecipeBookData } from '../../lib/craft/recipeBookData';
import type { CraftCatalogEntry } from '../../lib/craft/craftCatalog';
import {
  ingredientHasAlternatives,
  ingredientOptionPrepSeconds,
  ingredientOptionQuantity,
  ingredientOptions,
  recipeGambitsCost,
  recipeOutputQuantity,
  type CraftIngredient,
  type CraftRecipeConfig,
} from '../../shared/craft/CraftShapes';
import type { StationConfig } from '../../shared/craft/StationShapes';
import { useCollectionInventoryStore } from '../../stores/collectionInventoryStore';
import { useRecipeBookStore } from '../../stores/recipeBookStore';

/** Chip para receitas cujo item não pertence a nenhuma estação. */
const OTHER_STATION_ID = '__outros__';

interface BookEntry {
  id: string;
  entry: CraftCatalogEntry;
  recipe: CraftRecipeConfig;
  stationId: string;
  /** Texto normalizado para a busca: nome do item + nomes de todos os ingredientes. */
  haystack: string;
}

interface BookGroup {
  stationId: string;
  station: StationConfig | null;
  entries: BookEntry[];
}

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

function stationOf(data: RecipeBookData, stationId: string): StationConfig | null {
  return data.stations.find((station) => station.stationId === stationId) ?? null;
}

/** Nome exibido de um id (item do catálogo ou, na falta, o próprio id). */
function nameOf(data: RecipeBookData, itemId: string): string {
  return data.catalog.byId.get(itemId)?.name ?? itemId;
}

function buildEntries(data: RecipeBookData): BookEntry[] {
  const entries: BookEntry[] = [];
  for (const [id, recipe] of Object.entries(data.recipes)) {
    const entry = data.catalog.byId.get(id);
    if (!entry || recipe.ingredients.length === 0) continue;
    const stationId = data.members[id] && stationOf(data, data.members[id]) ? data.members[id] : OTHER_STATION_ID;
    const ingredientNames = recipe.ingredients.flatMap((ing) => ingredientOptions(ing).map((option) => nameOf(data, option.itemId)));
    entries.push({ id, entry, recipe, stationId, haystack: normalize([entry.name, ...ingredientNames].join(' ')) });
  }
  return entries.sort((a, b) => a.entry.name.localeCompare(b.entry.name, 'pt-BR'));
}

export function RecipeBookModal() {
  const closeBook = useRecipeBookStore((s) => s.closeBook);
  const selectedId = useRecipeBookStore((s) => s.selectedId);
  const select = useRecipeBookStore((s) => s.select);
  const inventory = useCollectionInventoryStore((s) => s.items);
  const { data, error } = useRecipeBookData();
  const [query, setQuery] = useState('');
  const [stationFilter, setStationFilter] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeBook();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeBook]);

  // Foco na busca só com mouse/trackpad — no celular abriria o teclado por cima da lista.
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)').matches) searchRef.current?.focus();
  }, []);

  const entries = useMemo(() => (data ? buildEntries(data) : []), [data]);
  const hasOthers = entries.some((item) => item.stationId === OTHER_STATION_ID);
  const normalizedQuery = normalize(query);

  const groups = useMemo((): BookGroup[] => {
    if (!data) return [];
    const visible = entries.filter(
      (item) => (!stationFilter || item.stationId === stationFilter) && (!normalizedQuery || item.haystack.includes(normalizedQuery)),
    );
    const order = [...data.stations.map((station) => String(station.stationId)), OTHER_STATION_ID];
    return order
      .map((stationId) => ({
        stationId,
        station: stationId === OTHER_STATION_ID ? null : stationOf(data, stationId),
        entries: visible.filter((item) => item.stationId === stationId),
      }))
      .filter((group) => group.entries.length > 0);
  }, [data, entries, stationFilter, normalizedQuery]);

  const selected = selectedId ? (entries.find((item) => item.id === selectedId) ?? null) : null;
  const visibleCount = groups.reduce((sum, group) => sum + group.entries.length, 0);

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/55 p-2 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeBook();
      }}
      data-testid="recipe-book"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Livro de Receitas"
        className="flex h-full w-full flex-col overflow-hidden rounded-xl border-[3px] border-[#8a5a2b] bg-[#2a1a0e] text-amber-50 shadow-[0_0_0_1px_#1a0f07,0_18px_40px_rgba(0,0,0,.7)] sm:h-[min(640px,calc(100vh-48px))] sm:w-[min(780px,100%)]"
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between gap-2 border-b border-[#8a5a2b] bg-gradient-to-b from-[#4a2e15] to-[#33200f] px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {selected && (
              <button
                type="button"
                onClick={() => select(null)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-amber-200/80 hover:bg-black/30 hover:text-white sm:hidden"
                title="Voltar à lista"
                data-testid="recipe-book-back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <BookOpen className="h-4 w-4 shrink-0 text-amber-300" />
            <span className="truncate text-sm font-bold uppercase tracking-[0.12em] text-amber-100">Livro de Receitas</span>
            {data && (
              <span className="hidden whitespace-nowrap rounded-md border border-[#8a5a2b]/70 bg-[#1e130a] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-200/90 sm:inline">
                {visibleCount} de {entries.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={closeBook}
            className="flex h-7 w-7 items-center justify-center rounded-md text-amber-200/80 transition-colors hover:bg-black/30 hover:text-white"
            title="Fechar (Esc)"
            data-testid="recipe-book-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Busca + filtros por estação (escondidos no celular enquanto o detalhe está aberto) */}
        <div className={`border-b border-[#8a5a2b]/60 bg-[#1e130a] px-3 py-2 ${selected ? 'hidden sm:block' : ''}`}>
          <label className="flex items-center gap-2 rounded-lg border border-[#8a5a2b]/70 bg-[#120a04] px-2.5 py-1.5 focus-within:border-amber-400/70">
            <Search className="h-4 w-4 shrink-0 text-amber-200/60" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar item ou ingrediente…"
              className="min-w-0 flex-1 bg-transparent text-sm text-amber-50 placeholder:text-amber-200/40 focus:outline-none"
              data-testid="recipe-book-search"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="text-amber-200/60 hover:text-white" title="Limpar busca">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
          {data && (
            <div className="no-scrollbar -mx-3 mt-2 flex gap-1.5 overflow-x-auto px-3" data-testid="recipe-book-stations">
              <StationChip active={stationFilter === null} label="Todas" onClick={() => setStationFilter(null)} />
              {data.stations.map((station) => (
                <StationChip
                  key={station.stationId}
                  active={stationFilter === station.stationId}
                  label={station.name}
                  color={station.color}
                  icon={station.icon}
                  count={entries.filter((item) => item.stationId === station.stationId).length}
                  onClick={() => setStationFilter(stationFilter === station.stationId ? null : String(station.stationId))}
                />
              ))}
              {hasOthers && (
                <StationChip
                  active={stationFilter === OTHER_STATION_ID}
                  label="Outros"
                  count={entries.filter((item) => item.stationId === OTHER_STATION_ID).length}
                  onClick={() => setStationFilter(stationFilter === OTHER_STATION_ID ? null : OTHER_STATION_ID)}
                />
              )}
            </div>
          )}
        </div>

        {/* Corpo: lista | detalhe */}
        <div className="flex min-h-0 flex-1">
          <div
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 [scrollbar-color:#6b4a26_#1a0f07] sm:w-[46%] sm:flex-none sm:border-r sm:border-[#8a5a2b]/60 ${
              selected ? 'hidden sm:block' : ''
            }`}
            data-testid="recipe-book-list"
          >
            {error ? (
              <p className="px-2 py-10 text-center text-xs text-rose-300">{error}</p>
            ) : !data ? (
              <p className="px-2 py-10 text-center text-xs text-amber-200/70">Carregando receitas…</p>
            ) : entries.length === 0 ? (
              <p className="px-2 py-10 text-center text-xs text-amber-200/70">Nenhuma receita cadastrada ainda.</p>
            ) : groups.length === 0 ? (
              <p className="px-2 py-10 text-center text-xs text-amber-200/70">Nenhuma receita encontrada para essa busca.</p>
            ) : (
              groups.map((group) => (
                <section key={group.stationId} className="mb-3" data-testid={`recipe-book-group-${group.stationId}`}>
                  <StationHeading station={group.station} count={group.entries.length} />
                  <ul className="space-y-1">
                    {group.entries.map((item) => {
                      const active = item.id === selectedId;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => select(item.id)}
                            aria-pressed={active}
                            data-testid={`recipe-book-item-${item.id}`}
                            className={`flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                              active
                                ? 'border-amber-400/70 bg-[#3b2411]'
                                : 'border-[#8a5a2b]/40 bg-[#1e130a] hover:border-[#8a5a2b] hover:bg-[#2f1d0f]'
                            }`}
                          >
                            <span className="rounded-md border border-[#8a5a2b]/60 bg-[#120a04]">
                              <CatalogThumb thumb={item.entry.thumb} size={34} bare />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-amber-50">{item.entry.name}</span>
                              <span className="block truncate text-[11px] text-amber-200/60">{recipeSummary(item.recipe)}</span>
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-amber-200/40" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>

          <div
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-color:#6b4a26_#1a0f07] ${selected ? '' : 'hidden sm:block'}`}
            data-testid="recipe-book-detail"
          >
            {!data ? null : !selected ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-amber-200/60">
                <BookOpen className="h-8 w-8 opacity-50" />
                <p className="text-xs">Toque em um item para ver a receita</p>
              </div>
            ) : (
              <RecipeDetail data={data} item={selected} inventory={inventory} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function recipeSummary(recipe: CraftRecipeConfig): string {
  const count = recipe.ingredients.length;
  const parts = [`${count} ingrediente${count === 1 ? '' : 's'}`];
  const output = recipeOutputQuantity(recipe);
  if (output > 1) parts.push(`produz ${output}`);
  if (recipe.ingredients.some(ingredientHasAlternatives)) parts.push('com opções');
  return parts.join(' · ');
}

function StationChip({
  active,
  label,
  color,
  icon,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  color?: string;
  icon?: StationConfig['icon'];
  count?: number;
  onClick: () => void;
}) {
  const Icon = icon ? STATION_ICONS[icon] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        active ? 'border-amber-400/80 bg-[#3b2411] text-amber-50' : 'border-[#8a5a2b]/60 bg-[#120a04] text-amber-200/80 hover:border-[#8a5a2b] hover:text-amber-50'
      }`}
      style={active && color ? { borderColor: color } : undefined}
    >
      {Icon && <Icon className="h-3 w-3" style={color ? { color } : undefined} />}
      {label}
      {count !== undefined && <span className="tabular-nums text-amber-200/50">{count}</span>}
    </button>
  );
}

function StationHeading({ station, count }: { station: StationConfig | null; count: number }) {
  const Icon = station ? STATION_ICONS[station.icon] : null;
  return (
    <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-200/70">
      {Icon && <Icon className="h-3 w-3" style={{ color: station?.color }} />}
      <span className="truncate">{station?.name ?? 'Outros'}</span>
      <span className="tabular-nums text-amber-200/40">{count}</span>
      <span className="ml-1 h-px flex-1 bg-[#8a5a2b]/40" />
    </div>
  );
}

function RecipeDetail({ data, item, inventory }: { data: RecipeBookData; item: BookEntry; inventory: Readonly<Record<string, number>> }) {
  const station = item.stationId === OTHER_STATION_ID ? null : stationOf(data, item.stationId);
  const StationIcon = station ? STATION_ICONS[station.icon] : null;
  const output = recipeOutputQuantity(item.recipe);
  const gambits = recipeGambitsCost(item.recipe);
  return (
    <div data-testid={`recipe-book-detail-${item.id}`}>
      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-[#8a5a2b]/70 bg-[#120a04] p-1">
          <CatalogThumb thumb={item.entry.thumb} size={56} bare />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-amber-50">{item.entry.name}</h3>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-amber-200/70">
            <span className="flex items-center gap-1">
              {StationIcon && <StationIcon className="h-3 w-3" style={{ color: station?.color }} />}
              {station ? `Criado em: ${station.name}` : 'Sem estação definida'}
            </span>
            {output > 1 && <span>· produz x{output}</span>}
            {gambits > 0 && (
              <span className="flex items-center gap-1">
                · <Coins className="h-3 w-3 text-amber-300" /> {gambits} gambit{gambits === 1 ? '' : 's'}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="my-3 h-px bg-[#8a5a2b]/50" />
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-200/60">Ingredientes</p>
      <ul className="space-y-1.5">
        {item.recipe.ingredients.map((ing) => (
          <IngredientRow key={ing.itemId} data={data} ingredient={ing} inventory={inventory} />
        ))}
      </ul>
      {item.recipe.ingredients.some(ingredientHasAlternatives) && (
        <p className="mt-3 text-[11px] leading-snug text-amber-200/50">
          "ou" = qualquer uma das opções serve; na estação você escolhe qual usar. Opções com tempo exigem esperar o preparo.
        </p>
      )}
    </div>
  );
}

function IngredientRow({
  data,
  ingredient,
  inventory,
}: {
  data: RecipeBookData;
  ingredient: CraftIngredient;
  inventory: Readonly<Record<string, number>>;
}) {
  const options = ingredientOptions(ingredient);
  const hasAlternatives = options.length > 1;
  return (
    <li className="rounded-lg border border-[#8a5a2b]/40 bg-[#1e130a] px-2 py-1.5">
      {options.map((option, index) => {
        const entry = data.catalog.byId.get(option.itemId) ?? null;
        const have = inventory[option.itemId] ?? 0;
        // Cada opção do "ou" tem a própria quantidade.
        const quantity = ingredientOptionQuantity(ingredient, option.itemId);
        const ok = have >= quantity;
        const seconds = ingredientOptionPrepSeconds(ingredient, option.itemId);
        return (
          <div key={option.itemId} className={`flex items-center gap-2 ${index > 0 ? 'mt-1 border-t border-dashed border-[#8a5a2b]/40 pt-1' : ''}`}>
            {hasAlternatives && (
              <span className={`w-5 shrink-0 text-[9px] font-bold uppercase tracking-wide ${index > 0 ? 'text-amber-300/90' : 'text-transparent'}`}>
                ou
              </span>
            )}
            <span className="rounded-md border border-[#8a5a2b]/50 bg-[#120a04]">
              <CatalogThumb thumb={entry?.thumb ?? { kind: 'none' }} size={28} bare />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-amber-50">
                {entry?.name ?? option.itemId} <span className="text-amber-200/60">x{quantity}</span>
              </span>
              {seconds > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-amber-200/60">
                  <Clock3 className="h-3 w-3" /> {seconds}s de preparo
                </span>
              )}
            </span>
            <span
              className={`flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums ${ok ? 'text-emerald-400' : 'text-rose-300'}`}
              title={ok ? 'Você tem o suficiente' : 'Faltam no inventário'}
            >
              {have}/{quantity}
              {ok && <Check className="h-3.5 w-3.5" />}
            </span>
          </div>
        );
      })}
    </li>
  );
}
