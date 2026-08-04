/**
 * Coluna 2 do /admin/assets-controller — biblioteca de TODOS os assets
 * atribuíveis: famílias/variações do gerador (manifest dinâmico) + craft items
 * cadastrados. Clique alterna a presença na categoria selecionada.
 *
 * Granularidade: o botão da família adiciona `gen:<camada>/<família>` (todas
 * as cores); os chips adicionam `gen:<camada>/<família>/<variação>`.
 */
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { CraftItemConfig } from '../../../shared/craft/CraftShapes';
import {
  craftItemRef,
  genFamilyRef,
  genVariantRef,
  type AssetCategoryConfig,
} from '../../../shared/assets/AssetCategoryShapes';
import type { GeneratorManifest } from '../../../lib/character-generator/types';
import { SpriteThumb } from '../craft/SpriteThumb';

const withBase = (url: string) => `${import.meta.env.BASE_URL}${url.replace(/^\//, '')}`;

/** Ordem/rótulos de exibição; camadas desconhecidas do manifest vão ao final. */
const LAYER_LABELS: Record<string, string> = {
  head: 'Corpo / Cabeça',
  hair: 'Cabelos',
  backhair: 'Cabelos (trás)',
  hat: 'Chapéus',
  top: 'Tops (torso)',
  bottom: 'Bottoms (pernas)',
  weapon: 'Armas',
  crafttools: 'Ferramentas de craft',
  backextra: 'Extras (trás)',
  frontextra: 'Extras (frente)',
  shadow: 'Sombra',
};
const LAYER_DISPLAY_ORDER = Object.keys(LAYER_LABELS);

interface Props {
  manifest: GeneratorManifest | null;
  craftItems: Record<string, CraftItemConfig>;
  craftItemsNote: string | null;
  /** Config efetiva da categoria selecionada (null = nenhuma). */
  selected: AssetCategoryConfig | null;
  /** ref → nomes das categorias que a contêm (para o selo "em N"). */
  refIndex: Map<string, string[]>;
  busy: boolean;
  onToggleRef: (ref: string) => void;
}

export function AssetLibraryPanel(props: Props) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const layers = useMemo(() => {
    const cats = props.manifest?.categories ?? {};
    const known = LAYER_DISPLAY_ORDER.filter((k) => (cats[k] ?? []).length > 0);
    const extra = Object.keys(cats)
      .filter((k) => !LAYER_DISPLAY_ORDER.includes(k) && cats[k].length > 0)
      .sort();
    return [...known, ...extra];
  }, [props.manifest]);

  const selectedRefs = useMemo(() => new Set(props.selected?.assetRefs ?? []), [props.selected]);
  const canEdit = props.selected !== null && !props.busy;

  const membershipBadge = (refs: string[]) => {
    const names = new Set<string>();
    for (const ref of refs) for (const n of props.refIndex.get(ref) ?? []) names.add(n);
    if (names.size === 0) return null;
    const list = [...names].sort();
    return (
      <span
        title={`Em: ${list.join(', ')}`}
        className="shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30"
      >
        em {list.length}
      </span>
    );
  };

  const craftList = useMemo(
    () =>
      Object.values(props.craftItems)
        .filter((it) => q === '' || it.name.toLowerCase().includes(q) || it.itemId.includes(q))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [props.craftItems, q],
  );

  return (
    <section className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-4">
      <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-mono mb-3">
        Biblioteca de assets{' '}
        <span className="text-slate-600">· clique para incluir na categoria selecionada</span>
      </h2>

      <div className="relative mb-3">
        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          placeholder="filtrar por nome/id…"
          className="w-full bg-slate-950/60 border border-slate-700/70 rounded-md pl-8 pr-2 py-1.5 text-xs focus:outline-none focus:border-emerald-500/60"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {props.selected === null && (
        <p className="mb-3 rounded-md border border-slate-700/60 bg-slate-950/50 px-2.5 py-2 text-[11px] text-slate-400">
          Selecione (ou crie) uma categoria à esquerda para começar a atribuir assets.
        </p>
      )}

      {!props.manifest && (
        <p className="text-xs text-slate-500 italic mb-3">Carregando manifest de assets…</p>
      )}

      <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto pr-1">
        {layers.map((layer) => {
          const families = (props.manifest?.categories[layer] ?? []).filter(
            (f) =>
              q === '' ||
              f.id.toLowerCase().includes(q) ||
              layer.toLowerCase().includes(q) ||
              (LAYER_LABELS[layer] ?? '').toLowerCase().includes(q),
          );
          if (families.length === 0) return null;
          return (
            <div key={layer}>
              <p className="text-[10px] uppercase tracking-wider font-mono text-slate-500 mb-1.5">
                {LAYER_LABELS[layer] ?? layer}{' '}
                <span className="text-slate-700">· {layer} · {families.length} família(s)</span>
              </p>
              <div className="flex flex-col gap-1.5">
                {families.map((family) => {
                  const famRef = genFamilyRef(layer, family.id);
                  const famSelected = selectedRefs.has(famRef);
                  const anyVariantSelected = family.variants.some((v) =>
                    selectedRefs.has(genVariantRef(layer, family.id, v.id)),
                  );
                  return (
                    <div
                      key={family.id}
                      className={`rounded-lg border p-2 ${
                        famSelected || anyVariantSelected
                          ? 'border-emerald-400/50 bg-emerald-500/[0.06]'
                          : 'border-slate-700/50 bg-slate-950/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <SpriteThumb url={withBase(family.default.url)} size={40} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-mono text-slate-200 truncate">{family.id}</span>
                          <span className="block text-[10px] text-slate-500">
                            {family.variants.length} variação(ões)
                          </span>
                        </span>
                        {membershipBadge([
                          famRef,
                          ...family.variants.map((v) => genVariantRef(layer, family.id, v.id)),
                        ])}
                        <button
                          type="button"
                          className={`shrink-0 text-[10px] font-mono px-2 py-1 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                            famSelected
                              ? 'bg-emerald-600/80 border-emerald-500/60 text-white'
                              : 'bg-slate-800/80 border-slate-600/60 text-slate-300 hover:border-emerald-500/50'
                          }`}
                          onClick={() => props.onToggleRef(famRef)}
                          disabled={!canEdit}
                          title="Família inteira (todas as cores)"
                        >
                          {famSelected ? '✓ família' : '+ família'}
                        </button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {family.variants.map((v) => {
                          const ref = genVariantRef(layer, family.id, v.id);
                          const on = selectedRefs.has(ref);
                          return (
                            <button
                              key={v.id}
                              type="button"
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                on
                                  ? 'bg-emerald-600/70 border-emerald-500/60 text-white'
                                  : famSelected
                                    ? 'bg-slate-900/60 border-slate-700/40 text-slate-500'
                                    : 'bg-slate-900/80 border-slate-700/60 text-slate-400 hover:border-emerald-500/40'
                              }`}
                              onClick={() => props.onToggleRef(ref)}
                              disabled={!canEdit}
                              title={
                                famSelected
                                  ? 'A família inteira já está incluída; use variações para granularidade fina'
                                  : `Só a variação ${v.id}`
                              }
                            >
                              {v.id}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* ------------------------------------------------- craft items */}
        <div>
          <p className="text-[10px] uppercase tracking-wider font-mono text-slate-500 mb-1.5">
            Craft items <span className="text-slate-700">· cadastrados no /admin/craft</span>
          </p>
          {props.craftItemsNote && (
            <p className="text-[10px] text-slate-500 italic mb-1.5">{props.craftItemsNote}</p>
          )}
          {craftList.length === 0 && !props.craftItemsNote ? (
            <p className="text-[10px] text-slate-600 italic">Nenhum craft item cadastrado ainda.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {craftList.map((it) => {
                const ref = craftItemRef(it.itemId);
                const on = selectedRefs.has(ref);
                return (
                  <button
                    key={it.itemId}
                    type="button"
                    className={`flex items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      on
                        ? 'border-emerald-400/60 bg-emerald-500/[0.08]'
                        : 'border-slate-700/50 bg-slate-950/40 hover:border-emerald-500/40'
                    }`}
                    onClick={() => props.onToggleRef(ref)}
                    disabled={!canEdit}
                  >
                    {it.imageUrl ? (
                      <img src={it.imageUrl} alt="" className="w-8 h-8 object-contain rounded bg-slate-900/80 shrink-0" />
                    ) : (
                      <span className="w-8 h-8 rounded bg-slate-900/80 border border-dashed border-slate-700/60 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-slate-200 truncate">{it.name}</span>
                      <span className="block text-[10px] font-mono text-slate-500 truncate">{it.itemId}</span>
                    </span>
                    {membershipBadge([ref])}
                    {on && <span className="text-[10px] font-mono text-emerald-300 shrink-0">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
