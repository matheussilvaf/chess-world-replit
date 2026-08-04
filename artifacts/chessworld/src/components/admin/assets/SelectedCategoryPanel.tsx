/**
 * Coluna 3 do /admin/assets-controller — detalhe da categoria selecionada:
 * renomear, mover (raiz ↔ subcategoria), revisar/remover refs e salvar.
 * Rascunho local por categoria; nada persiste sem "Salvar".
 */
import { useMemo } from 'react';
import { Boxes, Save, Trash2, X } from 'lucide-react';
import type { CraftItemConfig } from '../../../shared/craft/CraftShapes';
import {
  parseAssetRef,
  type AssetCategoryConfig,
} from '../../../shared/assets/AssetCategoryShapes';
import type { GeneratorManifest } from '../../../lib/character-generator/types';
import { SpriteThumb } from '../craft/SpriteThumb';

const withBase = (url: string) => `${import.meta.env.BASE_URL}${url.replace(/^\//, '')}`;
const btnCls =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

interface Props {
  selected: AssetCategoryConfig | null;
  hasChildren: boolean;
  dirty: boolean;
  isPersisted: boolean;
  busy: boolean;
  disabled: boolean;
  /** Raízes disponíveis como pai (sem a própria categoria). */
  parentOptions: { categoryId: string; name: string }[];
  manifest: GeneratorManifest | null;
  craftItems: Record<string, CraftItemConfig>;
  onRename: (name: string) => void;
  onReparent: (parentId: string | null) => void;
  onRemoveRef: (ref: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onDelete: () => void;
}

interface RefRow {
  ref: string;
  label: string;
  sub: string;
  thumbUrl: string | null;
  craftIconUrl: string | null;
  missing: boolean;
}

export function SelectedCategoryPanel(props: Props) {
  const rows = useMemo<RefRow[]>(() => {
    if (!props.selected) return [];
    return props.selected.assetRefs.map((ref) => {
      const parsed = parseAssetRef(ref);
      if (!parsed) return { ref, label: ref, sub: 'ref inválida', thumbUrl: null, craftIconUrl: null, missing: true };
      if (parsed.kind === 'craft') {
        const item = props.craftItems[parsed.itemId];
        return {
          ref,
          label: item?.name ?? parsed.itemId,
          sub: `craft item · ${parsed.itemId}`,
          thumbUrl: null,
          craftIconUrl: item?.imageUrl ?? null,
          missing: item === undefined,
        };
      }
      const family = (props.manifest?.categories[parsed.layer] ?? []).find((f) => f.id === parsed.familyId);
      const variant = parsed.variantId
        ? family?.variants.find((v) => v.id === parsed.variantId)
        : family?.default;
      return {
        ref,
        label: parsed.familyId + (parsed.variantId ? ` · ${parsed.variantId}` : ''),
        sub: `${parsed.layer} · ${parsed.variantId ? 'variação específica' : 'família inteira'}`,
        thumbUrl: variant ? withBase(variant.url) : null,
        craftIconUrl: null,
        missing: props.manifest !== null && variant === undefined,
      };
    });
  }, [props.selected, props.manifest, props.craftItems]);

  if (!props.selected) {
    return (
      <section className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-4">
        <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-mono mb-3">Categoria</h2>
        <div className="py-14 text-center">
          <Boxes className="w-8 h-8 text-slate-700 mx-auto mb-3" />
          <p className="text-xs text-slate-500">Selecione uma categoria para editar o conteúdo dela.</p>
        </div>
      </section>
    );
  }

  const cat = props.selected;
  const missingCount = rows.filter((r) => r.missing).length;

  return (
    <section className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-4">
      <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-mono mb-3">
        Categoria{' '}
        {props.dirty ? (
          <span className="ml-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
            não salvo
          </span>
        ) : props.isPersisted ? (
          <span className="ml-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            salva
          </span>
        ) : null}
      </h2>

      <label className="block text-[10px] font-mono text-slate-500 mb-1">nome</label>
      <input
        type="text"
        value={cat.name}
        maxLength={60}
        className="w-full bg-slate-950/60 border border-slate-700/70 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-500/60 mb-2.5"
        onChange={(e) => props.onRename(e.target.value)}
        disabled={props.busy || props.disabled}
      />

      <label className="block text-[10px] font-mono text-slate-500 mb-1">posição na árvore</label>
      {props.hasChildren ? (
        <p className="text-[10px] text-slate-500 mb-2.5 rounded-md border border-slate-700/50 bg-slate-950/40 px-2 py-1.5">
          Categoria raiz com subcategorias — não pode virar subcategoria.
        </p>
      ) : (
        <select
          value={cat.parentId ?? ''}
          className="w-full bg-slate-950/60 border border-slate-700/70 rounded-md px-1.5 py-1.5 text-[11px] text-slate-300 focus:outline-none focus:border-emerald-500/60 mb-2.5"
          onChange={(e) => props.onReparent(e.target.value === '' ? null : e.target.value)}
          disabled={props.busy || props.disabled}
        >
          <option value="">raiz</option>
          {props.parentOptions.map((r) => (
            <option key={r.categoryId} value={r.categoryId}>
              dentro de: {r.name}
            </option>
          ))}
        </select>
      )}

      <p className="text-[10px] font-mono text-slate-500 mb-2">
        id: {cat.categoryId} · {cat.assetRefs.length} asset(s)
        {missingCount > 0 && <span className="text-rose-300"> · {missingCount} não encontrado(s)</span>}
      </p>

      <div className="flex flex-col gap-1 max-h-[46vh] overflow-y-auto pr-1 mb-3">
        {rows.length === 0 ? (
          <p className="text-[11px] text-slate-500 italic py-4 text-center">
            Vazia — clique nos assets da biblioteca ao lado para incluí-los.
          </p>
        ) : (
          rows.map((r) => (
            <div
              key={r.ref}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                r.missing ? 'border-rose-500/40 bg-rose-500/[0.05]' : 'border-slate-700/50 bg-slate-950/40'
              }`}
            >
              {r.thumbUrl ? (
                <SpriteThumb url={r.thumbUrl} size={34} />
              ) : r.craftIconUrl ? (
                <img src={r.craftIconUrl} alt="" className="w-[34px] h-[34px] object-contain rounded bg-slate-900/80 shrink-0" />
              ) : (
                <span className="w-[34px] h-[34px] rounded bg-slate-900/80 border border-dashed border-slate-700/60 shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                <span className={`block text-[11px] truncate ${r.missing ? 'text-rose-300' : 'text-slate-200'}`}>
                  {r.label}
                  {r.missing && ' (não encontrado)'}
                </span>
                <span className="block text-[9px] font-mono text-slate-500 truncate">{r.sub}</span>
              </span>
              <button
                type="button"
                title="Remover da categoria"
                className="p-1 rounded text-slate-500 hover:text-rose-300 shrink-0"
                onClick={() => props.onRemoveRef(r.ref)}
                disabled={props.busy || props.disabled}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`${btnCls} bg-emerald-600/90 hover:bg-emerald-500 text-white`}
          onClick={props.onSave}
          disabled={props.busy || props.disabled || !props.dirty}
        >
          <Save className="w-3.5 h-3.5" /> Salvar
        </button>
        {props.dirty && (
          <button
            type="button"
            className={`${btnCls} bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60`}
            onClick={props.onDiscard}
            disabled={props.busy}
          >
            Descartar
          </button>
        )}
        <button
          type="button"
          className={`${btnCls} ml-auto bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40`}
          onClick={props.onDelete}
          disabled={props.busy || props.disabled || props.hasChildren}
          title={props.hasChildren ? 'Remova as subcategorias antes' : 'Excluir categoria'}
        >
          <Trash2 className="w-3.5 h-3.5" /> Excluir
        </button>
      </div>
    </section>
  );
}
