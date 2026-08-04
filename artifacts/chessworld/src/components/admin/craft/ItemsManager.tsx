/**
 * ItemsManager — CRUD dos CRAFT ITEMS (materiais: ouro, prata, bronze, …).
 *
 * Cada item tem nome + imagem (upload → bucket público via servidor). O id é
 * um slug derivado do nome e IMUTÁVEL após criar (receitas referenciam o id).
 */
import { useRef, useState } from 'react';
import { Check, ImagePlus, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  MAX_CRAFT_ITEM_NAME_LEN,
  slugifyCraftItemName,
  type CraftItemConfig,
} from '../../../shared/craft/CraftShapes';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3MB — o servidor aceita até 4MB decodificados

export interface ItemsManagerProps {
  items: Record<string, CraftItemConfig>;
  busy: boolean;
  /** true quando as tabelas não existem — edição bloqueada. */
  disabled: boolean;
  onSaveItem: (config: CraftItemConfig) => Promise<boolean>;
  onDeleteItem: (itemId: string) => Promise<boolean>;
  /** Resolve com a URL pública ou null em falha (erro já exibido pelo pai). */
  onUploadImage: (itemId: string, dataUrl: string) => Promise<string | null>;
  onLocalError: (message: string | null) => void;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo'));
    reader.readAsDataURL(file);
  });
}

function fileProblem(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Formato inválido — use PNG, JPEG, WEBP ou GIF';
  if (file.size > MAX_FILE_BYTES) return 'Imagem maior que 3MB';
  return null;
}

const btnCls =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const iconBtnCls =
  'p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-700/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export function ItemsManager(props: ItemsManagerProps) {
  const { items, busy, disabled } = props;
  const [newName, setNewName] = useState('');
  const [newImage, setNewImage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const addFileRef = useRef<HTMLInputElement | null>(null);
  const replaceFileRef = useRef<HTMLInputElement | null>(null);
  const replaceTargetRef = useRef<string | null>(null);

  const sorted = Object.values(items).sort((a, b) => a.name.localeCompare(b.name));
  const newSlug = slugifyCraftItemName(newName);
  const slugTaken = newSlug !== '' && items[newSlug] !== undefined;
  const canAdd = !busy && !working && !disabled && newSlug !== '' && !slugTaken && newImage !== null;

  const pickFile = async (file: File | undefined, apply: (dataUrl: string) => void) => {
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) {
      props.onLocalError(problem);
      return;
    }
    props.onLocalError(null);
    try {
      apply(await readAsDataUrl(file));
    } catch (e) {
      props.onLocalError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleAdd = async () => {
    if (!canAdd || !newImage) return;
    setWorking(true);
    try {
      const imageUrl = await props.onUploadImage(newSlug, newImage);
      if (!imageUrl) return;
      const ok = await props.onSaveItem({ itemId: newSlug, name: newName.trim(), imageUrl });
      if (ok) {
        setNewName('');
        setNewImage(null);
        if (addFileRef.current) addFileRef.current.value = '';
      }
    } finally {
      setWorking(false);
    }
  };

  const handleRename = async (item: CraftItemConfig) => {
    const name = editName.trim();
    if (name.length === 0 || name.length > MAX_CRAFT_ITEM_NAME_LEN) {
      props.onLocalError(`Nome: 1–${MAX_CRAFT_ITEM_NAME_LEN} caracteres`);
      return;
    }
    const ok = await props.onSaveItem({ ...item, name });
    if (ok) setEditingId(null);
  };

  const handleReplaceImage = async (dataUrl: string) => {
    const itemId = replaceTargetRef.current;
    const item = itemId ? items[itemId] : undefined;
    if (!itemId || !item) return;
    setWorking(true);
    try {
      const imageUrl = await props.onUploadImage(itemId, dataUrl);
      if (imageUrl) await props.onSaveItem({ ...item, imageUrl });
    } finally {
      setWorking(false);
      replaceTargetRef.current = null;
      if (replaceFileRef.current) replaceFileRef.current.value = '';
    }
  };

  const handleDelete = async (item: CraftItemConfig) => {
    if (!window.confirm(`Excluir o craft item "${item.name}" (${item.itemId})?`)) return;
    await props.onDeleteItem(item.itemId);
  };

  return (
    <section className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-4 h-fit">
      <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-mono mb-3">
        Craft items <span className="text-slate-600">· materiais do jogo</span>
      </h2>

      {/* ---------------------------------------------------------- criar */}
      <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/[0.04] p-3 mb-4">
        <p className="text-[11px] text-slate-400 mb-2 font-mono">novo item</p>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={newName}
            maxLength={MAX_CRAFT_ITEM_NAME_LEN}
            placeholder="Nome (ex.: Ouro)"
            onChange={(e) => setNewName(e.target.value)}
            className="bg-slate-950/70 border border-slate-700/70 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-cyan-500/60"
            disabled={busy || working || disabled}
          />
          <div className="flex items-center gap-2">
            <input
              ref={addFileRef}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              className="hidden"
              onChange={(e) => void pickFile(e.target.files?.[0], setNewImage)}
            />
            <button
              type="button"
              className={`${btnCls} bg-slate-800/80 text-slate-200 hover:bg-slate-700/80 border border-slate-700/60`}
              onClick={() => addFileRef.current?.click()}
              disabled={busy || working || disabled}
            >
              <ImagePlus className="w-3.5 h-3.5" /> {newImage ? 'Trocar imagem' : 'Escolher imagem'}
            </button>
            {newImage && (
              <img
                src={newImage}
                alt="preview"
                className="w-10 h-10 rounded-md object-contain bg-slate-950/80 border border-slate-700/60"
              />
            )}
            <button
              type="button"
              className={`${btnCls} ml-auto bg-cyan-600/90 hover:bg-cyan-500 text-white`}
              onClick={() => void handleAdd()}
              disabled={!canAdd}
            >
              {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Adicionar
            </button>
          </div>
          <p className="text-[10px] font-mono text-slate-500">
            {newSlug
              ? slugTaken
                ? `id "${newSlug}" já existe`
                : `id: ${newSlug}`
              : 'id gerado a partir do nome'}
            {' · '}imagem obrigatória (mostrada no jogo)
          </p>
        </div>
      </div>

      {/* ---------------------------------------------------------- lista */}
      {sorted.length === 0 ? (
        <p className="text-xs text-slate-500 italic">
          Nenhum craft item ainda — adicione o primeiro acima (ex.: ouro, prata, bronze, diamante).
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {sorted.map((item) => (
            <li
              key={item.itemId}
              className="flex items-center gap-2.5 rounded-lg border border-slate-700/50 bg-slate-950/40 px-2.5 py-2"
            >
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="w-9 h-9 rounded-md object-contain bg-slate-900/80 border border-slate-700/50 shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-md bg-slate-900/80 border border-dashed border-slate-700/50 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                {editingId === item.itemId ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={editName}
                      maxLength={MAX_CRAFT_ITEM_NAME_LEN}
                      onChange={(e) => setEditName(e.target.value)}
                      className="bg-slate-950/70 border border-slate-700/70 rounded px-2 py-1 text-xs w-full focus:outline-none focus:border-cyan-500/60"
                      autoFocus
                    />
                    <button type="button" className={iconBtnCls} onClick={() => void handleRename(item)} disabled={busy}>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    </button>
                    <button type="button" className={iconBtnCls} onClick={() => setEditingId(null)}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-slate-200 truncate">{item.name}</p>
                    <p className="text-[10px] font-mono text-slate-500 truncate">{item.itemId}</p>
                  </>
                )}
              </div>
              {editingId !== item.itemId && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    title="Renomear"
                    className={iconBtnCls}
                    disabled={busy || working || disabled}
                    onClick={() => {
                      setEditingId(item.itemId);
                      setEditName(item.name);
                    }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Substituir imagem"
                    className={iconBtnCls}
                    disabled={busy || working || disabled}
                    onClick={() => {
                      replaceTargetRef.current = item.itemId;
                      replaceFileRef.current?.click();
                    }}
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Excluir"
                    className={iconBtnCls}
                    disabled={busy || working || disabled}
                    onClick={() => void handleDelete(item)}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400/80" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <input
        ref={replaceFileRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        className="hidden"
        onChange={(e) => void pickFile(e.target.files?.[0], (dataUrl) => void handleReplaceImage(dataUrl))}
      />
    </section>
  );
}
