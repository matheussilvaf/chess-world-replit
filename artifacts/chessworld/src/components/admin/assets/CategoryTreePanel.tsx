/**
 * Coluna 1 do /admin/assets-controller — árvore de categorias (2 níveis) com
 * criação inline. O id é um slug imutável derivado do nome (política craft).
 */
import { useMemo, useState } from 'react';
import { FolderPlus, Trash2 } from 'lucide-react';
import {
  slugifyCategoryName,
  type AssetCategoryConfig,
} from '../../../shared/assets/AssetCategoryShapes';

const btnCls =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

interface Props {
  /** Config efetiva por id (rascunho quando existir, senão persistido). */
  effective: Record<string, AssetCategoryConfig>;
  dirtyIds: Set<string>;
  selectedId: string | null;
  busy: boolean;
  disabled: boolean;
  onSelect: (categoryId: string) => void;
  onCreate: (name: string, parentId: string | null) => void;
  onDelete: (categoryId: string) => void;
}

export function CategoryTreePanel(props: Props) {
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState('');

  // Segurança contra estado corrompido (ex.: escrita concorrente criando
  // ciclo ou pai ausente): só aninha filho sob pai que É raiz de verdade;
  // qualquer outro caso vira nó de topo visível — nunca some, nunca recursa.
  const { roots, orphans, childrenOf } = useMemo(() => {
    const all = Object.values(props.effective);
    const roots = all.filter((c) => c.parentId === null).sort((a, b) => a.name.localeCompare(b.name));
    const orphans: AssetCategoryConfig[] = [];
    const childrenOf = new Map<string, AssetCategoryConfig[]>();
    for (const c of all) {
      if (c.parentId === null) continue;
      const parent = props.effective[c.parentId];
      if (!parent || parent.parentId !== null) {
        orphans.push(c);
        continue;
      }
      const list = childrenOf.get(c.parentId) ?? [];
      list.push(c);
      childrenOf.set(c.parentId, list);
    }
    for (const list of childrenOf.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    orphans.sort((a, b) => a.name.localeCompare(b.name));
    return { roots, orphans, childrenOf };
  }, [props.effective]);

  const slug = slugifyCategoryName(newName);
  const slugTaken = slug !== '' && props.effective[slug] !== undefined;

  const submit = () => {
    if (!slug || slugTaken) return;
    props.onCreate(newName.trim(), newParent === '' ? null : newParent);
    setNewName('');
    setNewParent('');
  };

  const node = (cat: AssetCategoryConfig, depth: number) => {
    const selected = props.selectedId === cat.categoryId;
    const dirty = props.dirtyIds.has(cat.categoryId);
    const kids = childrenOf.get(cat.categoryId) ?? [];
    return (
      <div key={cat.categoryId}>
        <div
          className={`group flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-all cursor-pointer ${
            selected
              ? 'border-emerald-400/70 bg-emerald-500/10 ring-1 ring-emerald-400/40'
              : 'border-slate-700/50 bg-slate-950/40 hover:border-slate-500/60'
          }`}
          style={{ marginLeft: depth * 16 }}
          onClick={() => props.onSelect(cat.categoryId)}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-slate-200 truncate">
              {cat.name}
              {dirty && <span className="ml-1.5 text-[9px] font-mono text-amber-300/90">não salvo</span>}
            </span>
            <span className="block text-[10px] font-mono text-slate-500 truncate">
              {cat.categoryId} · {cat.assetRefs.length} asset(s)
              {kids.length > 0 ? ` · ${kids.length} sub` : ''}
              {depth === 0 && cat.parentId !== null && (
                <span className="text-amber-300/90"> · pai inválido ("{cat.parentId}") — mova para a raiz</span>
              )}
            </span>
          </span>
          <button
            type="button"
            title={kids.length > 0 ? 'Remova as subcategorias antes' : 'Excluir categoria'}
            className="p-1 rounded text-slate-500 hover:text-rose-300 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
            disabled={props.busy || kids.length > 0}
            onClick={(e) => {
              e.stopPropagation();
              props.onDelete(cat.categoryId);
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {kids.length > 0 && (
          <div className="mt-1 flex flex-col gap-1">{kids.map((k) => node(k, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <section className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-4">
      <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-mono mb-3">
        Categorias <span className="text-slate-600">· máx. 2 níveis</span>
      </h2>

      <div className="mb-4 rounded-lg border border-slate-700/50 bg-slate-950/40 p-2.5">
        <input
          type="text"
          value={newName}
          maxLength={60}
          placeholder="nova categoria (ex.: default character)"
          className="w-full bg-slate-900/80 border border-slate-700/70 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-500/60 mb-2"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          disabled={props.busy || props.disabled}
        />
        <div className="flex items-center gap-2">
          <select
            value={newParent}
            className="flex-1 bg-slate-900/80 border border-slate-700/70 rounded-md px-1.5 py-1.5 text-[11px] text-slate-300 focus:outline-none focus:border-emerald-500/60"
            onChange={(e) => setNewParent(e.target.value)}
            disabled={props.busy || props.disabled}
          >
            <option value="">criar na raiz</option>
            {roots.map((r) => (
              <option key={r.categoryId} value={r.categoryId}>
                dentro de: {r.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`${btnCls} bg-emerald-600/90 hover:bg-emerald-500 text-white`}
            onClick={submit}
            disabled={props.busy || props.disabled || !slug || slugTaken}
          >
            <FolderPlus className="w-3.5 h-3.5" /> Criar
          </button>
        </div>
        {newName.trim() !== '' && (
          <p className="mt-1.5 text-[10px] font-mono text-slate-500">
            {slug === '' ? (
              <span className="text-rose-300">nome inválido para gerar um id</span>
            ) : slugTaken ? (
              <span className="text-rose-300">id "{slug}" já existe</span>
            ) : (
              <>id: {slug}</>
            )}
          </p>
        )}
      </div>

      {roots.length === 0 && orphans.length === 0 ? (
        <p className="text-xs text-slate-500 italic">
          Nenhuma categoria ainda — crie a primeira acima (ex.: "default character", "shop assets").
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {roots.map((r) => node(r, 0))}
          {orphans.map((o) => node(o, 0))}
        </div>
      )}
    </section>
  );
}
