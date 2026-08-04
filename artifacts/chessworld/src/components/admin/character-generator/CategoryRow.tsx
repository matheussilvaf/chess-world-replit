import { Eye, EyeOff, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CategorySelection, GeneratorFamily } from '../../../lib/character-generator/types';

interface CategoryRowProps {
  categoryKey: string;
  label: string;
  families: GeneratorFamily[];
  selection: CategorySelection;
  onChange: (patch: Partial<CategorySelection>) => void;
}

function variantLabel(id: string): string {
  return id === 'default' ? 'Padrão' : id.toUpperCase();
}

/** One category: eye toggle + item selector + variant selector with prev/next. */
export function CategoryRow({ categoryKey, label, families, selection, onChange }: CategoryRowProps) {
  const family = families.find((f) => f.id === selection.familyId) ?? null;
  const familyIndex = family ? families.indexOf(family) : -1;
  const variants = family?.variants ?? [];
  const rawVariantIndex = variants.findIndex((v) => v.id === selection.variantId);
  const variantIndex = rawVariantIndex >= 0 ? rawVariantIndex : 0;
  const empty = families.length === 0;

  const stepFamily = (dir: 1 | -1) => {
    if (empty) return;
    const next = families[(familyIndex + dir + families.length) % families.length];
    onChange({ familyId: next.id, variantId: next.default.id });
  };

  const stepVariant = (dir: 1 | -1) => {
    if (variants.length < 2) return;
    const next = variants[(variantIndex + dir + variants.length) % variants.length];
    onChange({ variantId: next.id });
  };

  const navBtn =
    'p-1 rounded border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-30 disabled:pointer-events-none';
  const selectCls =
    'flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white disabled:opacity-40';

  return (
    <div className={`py-2.5 ${selection.visible ? '' : 'opacity-50'}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          title={selection.visible ? 'Ocultar camada' : 'Mostrar camada'}
          aria-label={`${selection.visible ? 'Ocultar' : 'Mostrar'} ${label}`}
          onClick={() => onChange({ visible: !selection.visible })}
          disabled={empty}
          className={`p-1.5 rounded border ${
            selection.visible
              ? 'border-emerald-600/60 bg-emerald-600/10 text-emerald-400'
              : 'border-slate-700 bg-slate-800 text-slate-500'
          } disabled:opacity-30`}
        >
          {selection.visible ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <span className="text-sm font-medium text-slate-200">{label}</span>
        <span className="text-[11px] text-slate-500 font-mono">{categoryKey}</span>
        <span className="ml-auto text-[11px] text-slate-500 tabular-nums">
          {empty ? '0 itens' : `${familyIndex + 1}/${families.length}`}
        </span>
      </div>

      {empty ? (
        <p className="mt-1.5 pl-9 text-xs text-slate-500">— sem itens nesta categoria —</p>
      ) : (
        <div className="mt-1.5 pl-9 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <button type="button" className={navBtn} onClick={() => stepFamily(-1)} aria-label={`Item anterior de ${label}`}>
              <ChevronLeft size={14} />
            </button>
            <select
              className={selectCls}
              value={family?.id ?? ''}
              onChange={(e) => {
                const next = families.find((f) => f.id === e.target.value);
                if (next) onChange({ familyId: next.id, variantId: next.default.id });
              }}
            >
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.id}
                </option>
              ))}
            </select>
            <button type="button" className={navBtn} onClick={() => stepFamily(1)} aria-label={`Próximo item de ${label}`}>
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={navBtn}
              onClick={() => stepVariant(-1)}
              disabled={variants.length < 2}
              aria-label={`Variante anterior de ${label}`}
            >
              <ChevronLeft size={14} />
            </button>
            <select
              className={selectCls}
              value={variants[variantIndex]?.id ?? ''}
              onChange={(e) => onChange({ variantId: e.target.value })}
              disabled={variants.length < 2}
            >
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {variantLabel(v.id)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={navBtn}
              onClick={() => stepVariant(1)}
              disabled={variants.length < 2}
              aria-label={`Próxima variante de ${label}`}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
