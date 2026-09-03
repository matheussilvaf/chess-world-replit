/**
 * Célula de slot do inventário — visual único para a janela e para a hotbar.
 * Opaca, estilo "encaixe de madeira" com ícone do catálogo + quantidade.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { CraftCatalog } from '../../../lib/craft/craftCatalog';
import { inventoryEntry, inventoryFallbackName } from '../../../lib/inventory/inventoryVisualCatalog';
import { InventoryItemThumb } from '../InventoryItemVisual';

export type SlotTone = 'storage' | 'quick' | 'weapon';

interface InventorySlotCellProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  index: number;
  itemKey: string | null;
  qty?: number;
  catalog: CraftCatalog | null;
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
  return (
    <button
      type="button"
      data-slot-index={index}
      title={title ?? name}
      aria-label={name ?? 'Slot vazio'}
      className={`relative flex aspect-square w-full touch-none select-none items-center justify-center rounded-md border-2 shadow-[inset_0_2px_6px_rgba(0,0,0,.65)] transition-[border-color,box-shadow,transform] duration-100 hover:border-[#c08a4a] active:scale-95 ${base} ${state} ${ghosted ? 'opacity-35' : ''} ${itemKey ? 'cursor-grab' : 'cursor-default'} ${className}`}
      {...rest}
    >
      {itemKey && (
        <span className="pointer-events-none flex h-full w-full items-center justify-center p-1">
          <InventoryItemThumb itemKey={itemKey} catalog={catalog} size={thumbSize} />
        </span>
      )}
      {itemKey && typeof qty === 'number' && (
        <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded-sm bg-black/85 px-1 text-[10px] font-bold leading-4 text-amber-50 shadow-[0_0_0_1px_rgba(0,0,0,.6)]">
          {qty > 999 ? '999+' : qty}
        </span>
      )}
      {overlay}
    </button>
  );
}
