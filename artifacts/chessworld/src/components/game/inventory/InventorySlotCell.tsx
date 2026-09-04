/**
 * Célula de slot do inventário — visual único para a janela e para a hotbar.
 * Opaca, estilo "encaixe de madeira" com ícone do catálogo + quantidade e,
 * para ferramentas, a barra de durabilidade na base.
 *
 * A miniatura fica num wrapper `data-flip-key={itemKey}`: é ele que o
 * useSlotFlip anima quando os itens trocam de célula.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import type { CraftCatalog } from '../../../lib/craft/craftCatalog';
import { inventoryEntry, inventoryFallbackName } from '../../../lib/inventory/inventoryVisualCatalog';
import type { ToolDurabilityView } from '../../../lib/inventory/toolDurability';
import { InventoryItemThumb } from '../InventoryItemVisual';
import { DurabilityBar, durabilityLabel } from './DurabilityBar';

export type SlotTone = 'storage' | 'quick' | 'weapon';

interface InventorySlotCellProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  index: number;
  itemKey: string | null;
  qty?: number;
  catalog: CraftCatalog | null;
  /** Ferramentas: estado da barra de durabilidade (null = sem barra). */
  durability?: ToolDurabilityView | null;
  /** Realce de "equipado/selecionado". */
  active?: boolean;
  /** Origem de um arrasto em andamento (esmaecida). */
  ghosted?: boolean;
  /** Alvo de soltura em destaque. */
  dropTarget?: boolean;
  tone?: SlotTone;
  /** Conteúdo extra (badges) desenhado por cima. */
  overlay?: ReactNode;
  /** Tamanho do ícone em px (a célula é quadrada e flexível). */
  thumbSize?: number;
}

export function InventorySlotCell({
  index,
  itemKey,
  qty,
  catalog,
  durability = null,
  active = false,
  ghosted = false,
  dropTarget = false,
  tone = 'storage',
  overlay,
  thumbSize = 40,
  className = '',
  title,
  ...rest
}: InventorySlotCellProps) {
  const entry = itemKey ? inventoryEntry(catalog, itemKey) : null;
  const name = itemKey ? entry?.name ?? inventoryFallbackName(itemKey) : undefined;
  const base =
    tone === 'weapon'
      ? 'border-[#a8742f] bg-[#231409]'
      : tone === 'quick'
        ? 'border-[#6d4622] bg-[#1c110a]'
        : 'border-[#5a3a1b] bg-[#19100a]';
  const state = active
    ? 'border-emerald-400 shadow-[0_0_0_1px_rgba(52,211,153,.55),0_0_14px_rgba(52,211,153,.45)]'
    : dropTarget
      ? 'border-amber-300 shadow-[0_0_0_1px_rgba(252,211,77,.7),0_0_12px_rgba(252,211,77,.45)]'
      : '';
  const tooltip = title ?? (name && durability ? `${name} — ${durabilityLabel(durability)}` : name);
  return (
    <button
      type="button"
      data-slot-index={index}
      title={tooltip}
      aria-label={name ?? 'Slot vazio'}
      className={`relative flex aspect-square w-full touch-none select-none items-center justify-center rounded-md border-2 shadow-[inset_0_2px_6px_rgba(0,0,0,.65)] transition-[border-color,box-shadow,transform,opacity] duration-150 hover:border-[#c08a4a] active:scale-95 ${base} ${state} ${ghosted ? 'opacity-35' : ''} ${itemKey ? 'cursor-grab' : 'cursor-default'} ${className}`}
      {...rest}
    >
      {itemKey && (
        <span data-flip-key={itemKey} className="pointer-events-none flex h-full w-full items-center justify-center p-1">
          <InventoryItemThumb itemKey={itemKey} catalog={catalog} size={thumbSize} />
        </span>
      )}
      {itemKey && typeof qty === 'number' && (
        <span
          className={`pointer-events-none absolute right-0.5 rounded-sm bg-black/85 px-1 text-[10px] font-bold leading-4 text-amber-50 shadow-[0_0_0_1px_rgba(0,0,0,.6)] ${durability ? 'bottom-[7px]' : 'bottom-0.5'}`}
        >
          {qty > 999 ? '999+' : qty}
        </span>
      )}
      {itemKey && durability && <DurabilityBar view={durability} />}
      {dropTarget && itemKey && (
        <span
          className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-amber-200 bg-amber-400 text-[#2a1606] shadow-[0_2px_6px_rgba(0,0,0,.6)]"
          title="Trocar de lugar"
        >
          <ArrowLeftRight size={11} strokeWidth={3} />
        </span>
      )}
      {overlay}
    </button>
  );
}
