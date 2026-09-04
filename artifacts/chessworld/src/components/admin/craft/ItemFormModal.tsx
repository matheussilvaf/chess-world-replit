/**
 * ItemFormModal — cadastro/edição de CRAFT ITEMS como cidadãos do jogo
 * (ex.: "Barra de Ouro" que só existe craftada).
 *
 * Campos: nome (slug imutável após criar), imagem (obrigatória ao criar) e o
 * toggle "item de reparo" — quando ligado, exige escolher a arma/ferramenta
 * alvo (a receita deste item passará a significar "repara o alvo").
 *
 * O modal NÃO fala com a API: entrega os valores prontos ao pai via
 * onSubmit (que faz upload + save e retorna true para fechar).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Gauge, ImagePlus, Loader2, Save, Wrench, X } from 'lucide-react';
import {
  MAX_CRAFT_ITEM_NAME_LEN,
  slugifyCraftItemName,
  type CraftItemConfig,
} from '../../../shared/craft/CraftShapes';
import {
  MAX_PLACEABLE_DURABILITY,
  MIN_PLACEABLE_DURABILITY,
  isValidPlaceableDurability,
  placeableStationFor,
} from '../../../shared/craft/PlaceableStations';
import type { CraftCatalog } from '../../../lib/craft/craftCatalog';
import { CatalogThumb } from './CatalogThumb';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3MB — o servidor aceita até 4MB decodificados

export interface ItemFormValues {
  name: string;
  /** Data URL de imagem nova, ou null para manter a atual (edição). */
  imageDataUrl: string | null;
  repairsItemId: string | null;
  /** Só estações portáteis embutidas: crafts que a estação aguenta. */
  durability?: number;
}

export type ItemFormMode = { kind: 'create' } | { kind: 'edit'; item: CraftItemConfig };

interface ItemFormModalProps {
  mode: ItemFormMode;
  catalog: CraftCatalog;
  busy: boolean;
  onClose: () => void;
  /** true = salvou (o modal fecha); false = erro já exibido pelo pai. */
  onSubmit: (values: ItemFormValues) => Promise<boolean>;
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
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const fieldCls =
  'bg-slate-950/70 border border-slate-700/70 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-cyan-500/60';

export function ItemFormModal(props: ItemFormModalProps) {
  const { mode, catalog, busy } = props;
  const editing = mode.kind === 'edit' ? mode.item : null;

  const [name, setName] = useState(editing?.name ?? '');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [repairOn, setRepairOn] = useState(Boolean(editing?.repairsItemId));
  const [repairTarget, setRepairTarget] = useState(editing?.repairsItemId ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // Estação portátil embutida: imagem fixa (sprite do jogo) + campo de durabilidade.
  const placeable = editing ? placeableStationFor(editing.itemId) : null;
  const [durabilityText, setDurabilityText] = useState(
    String(editing?.durability ?? placeable?.defaultDurability ?? ''),
  );
  const durabilityValue = Number(durabilityText);
  const durabilityOk = !placeable || isValidPlaceableDurability(durabilityValue);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [props]);

  /** Só armas e ferramentas podem ser alvo de reparo (por enquanto). */
  const repairSections = useMemo(
    () => catalog.sections.filter((s) => (s.id === 'tools' || s.id === 'weapons') && s.entries.length > 0),
    [catalog],
  );

  const slug = editing ? editing.itemId : slugifyCraftItemName(name);
  const slugTaken = !editing && slug !== '' && catalog.byId.has(slug);
  const nameOk = name.trim().length > 0 && name.trim().length <= MAX_CRAFT_ITEM_NAME_LEN;
  const imageOk = editing ? true : imageDataUrl !== null;
  const repairOk = !repairOn || repairTarget !== '';
  const canSave =
    !busy && !working && nameOk && slug !== '' && !slugTaken && imageOk && repairOk && durabilityOk;

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError(null);
    try {
      setImageDataUrl(await readAsDataUrl(file));
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    setWorking(true);
    try {
      const ok = await props.onSubmit({
        name: name.trim(),
        imageDataUrl: placeable ? null : imageDataUrl,
        repairsItemId: repairOn ? repairTarget : null,
        ...(placeable ? { durability: durabilityValue } : {}),
      });
      if (ok) props.onClose();
    } finally {
      setWorking(false);
    }
  };

  const previewUrl = placeable
    ? `${import.meta.env.BASE_URL}${encodeURI(placeable.iconUrl.replace(/^\//, ''))}`
    : (imageDataUrl ?? editing?.imageUrl ?? null);
  const repairEntry = repairTarget ? (catalog.byId.get(repairTarget) ?? null) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="w-full max-w-md bg-slate-900 border border-slate-700/70 rounded-xl p-4 shadow-2xl">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-sm font-semibold text-slate-100">
            {editing ? `Editar item — ${editing.name}` : 'Novo item do jogo'}
          </h2>
          <button
            type="button"
            className="ml-auto p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-700/60"
            onClick={props.onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {/* ------------------------------------------------------- nome */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-widest text-slate-400 font-mono">Nome</span>
            <input
              type="text"
              value={name}
              maxLength={MAX_CRAFT_ITEM_NAME_LEN}
              placeholder="ex.: Barra de Ouro"
              onChange={(e) => setName(e.target.value)}
              className={fieldCls}
              disabled={busy || working}
              autoFocus
            />
            <span className="text-[10px] font-mono text-slate-500">
              {editing
                ? `id: ${editing.itemId} (fixo)`
                : slug
                  ? slugTaken
                    ? `id "${slug}" já existe no jogo`
                    : `id: ${slug}`
                  : 'id gerado a partir do nome'}
            </span>
          </label>

          {/* ----------------------------------------------------- imagem */}
          <div className="flex items-center gap-2.5">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              className="hidden"
              onChange={(e) => void pickFile(e.target.files?.[0])}
            />
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="preview"
                className="w-12 h-12 rounded-md object-contain bg-slate-950/80 border border-slate-700/60"
                style={{ imageRendering: 'pixelated' }}
              />
            ) : (
              <div className="w-12 h-12 rounded-md bg-slate-950/80 border border-dashed border-slate-700/60" />
            )}
            {placeable ? (
              <span className="text-[10px] text-slate-500">
                imagem fixa — é o sprite da estação no mapa
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className={`${btnCls} bg-slate-800/80 text-slate-200 hover:bg-slate-700/80 border border-slate-700/60`}
                  onClick={() => fileRef.current?.click()}
                  disabled={busy || working}
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  {previewUrl ? 'Trocar imagem' : 'Escolher imagem'}
                </button>
                <span className="text-[10px] text-slate-500">
                  {editing ? 'opcional (mantém a atual)' : 'obrigatória — aparece no jogo'}
                </span>
              </>
            )}
          </div>

          {/* ------------------------------------------------ durabilidade */}
          {placeable && (
            <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
              <label className="flex items-center gap-2">
                <Gauge className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs text-slate-200">Durabilidade (crafts por estação)</span>
                <input
                  type="number"
                  min={MIN_PLACEABLE_DURABILITY}
                  max={MAX_PLACEABLE_DURABILITY}
                  step={1}
                  value={durabilityText}
                  onChange={(e) => setDurabilityText(e.target.value)}
                  className={`${fieldCls} ml-auto w-24 text-right text-xs`}
                  disabled={busy || working}
                  data-testid="input-station-durability"
                />
              </label>
              <p className="text-[10px] text-slate-500 mt-1">
                Cada craft feito numa estação portátil posicionada gasta 1. Em 0 ela não pode mais ser
                posicionada nem usada. Inteiro {MIN_PLACEABLE_DURABILITY}–{MAX_PLACEABLE_DURABILITY}.
              </p>
              {!durabilityOk && (
                <p className="text-[10px] text-rose-300 mt-1">Informe um inteiro entre {MIN_PLACEABLE_DURABILITY} e {MAX_PLACEABLE_DURABILITY}.</p>
              )}
            </div>
          )}

          {/* ----------------------------------------------------- reparo */}
          <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={repairOn}
                onChange={(e) => setRepairOn(e.target.checked)}
                disabled={busy || working}
                className="accent-cyan-500"
              />
              <Wrench className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs text-slate-200">Item de reparo</span>
            </label>
            <p className="text-[10px] text-slate-500 mt-1">
              A receita deste item vai significar “repara a arma/ferramenta escolhida”.
            </p>
            {repairOn && (
              <div className="mt-2 flex items-center gap-2">
                <select
                  value={repairTarget}
                  onChange={(e) => setRepairTarget(e.target.value)}
                  className={`${fieldCls} flex-1 text-xs`}
                  disabled={busy || working}
                >
                  <option value="">— escolha o item a reparar (obrigatório) —</option>
                  {repairSections.map((section) => (
                    <optgroup key={section.id} label={section.label}>
                      {section.entries.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {repairEntry && <CatalogThumb thumb={repairEntry.thumb} size={34} />}
              </div>
            )}
            {repairOn && repairSections.length === 0 && (
              <p className="text-[10px] text-amber-300 mt-1.5">
                Manifest de assets ainda não carregou — sem armas/ferramentas para listar.
              </p>
            )}
          </div>

          {localError && (
            <p className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-md px-2.5 py-1.5">
              {localError}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              className={`${btnCls} bg-cyan-600/90 hover:bg-cyan-500 text-white`}
              onClick={() => void handleSave()}
              disabled={!canSave}
            >
              {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {editing ? 'Salvar alterações' : 'Adicionar item'}
            </button>
            <button
              type="button"
              className={`${btnCls} bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60`}
              onClick={props.onClose}
              disabled={working}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
