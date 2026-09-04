/**
 * Janela do inventário (opaca, arrastável pelo cabeçalho, renderizada FORA do
 * HUD para receber cliques). Grade de `capacity` slots em 5 colunas; a
 * última linha é o acesso rápido (espelhada na hotbar) e o primeiro slot
 * dela é reservado à arma da classe.
 *
 * Arrastar um item para fora da janela fecha o inventário e entra no modo de
 * soltar no chão (ver InventoryDropPlacement). Trocas de slot são animadas
 * (useSlotFlip); o ghost acompanha o ponteiro (useSlotDrag).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, Backpack, GripVertical, X } from 'lucide-react';
import { countUnslottedItems, useCollectionInventoryStore, weaponSlotIndex } from '../../stores/collectionInventoryStore';
import { useInventoryUiStore } from '../../stores/inventoryUiStore';
import { usePanelPlacement } from '../../hooks/usePanelPlacement';
import { getInventoryBridge } from '../../game/inventory/inventoryBridge';
import { useInventoryVisualCatalog } from '../../lib/inventory/inventoryVisualCatalog';
import { toolDurabilityView } from '../../lib/inventory/toolDurability';
import { isPlaceableStationItemKey } from '../../shared/craft/PlaceableStations';
import { INVENTORY_COLUMNS } from '../../shared/collection/CollectionShapes';
import { InventorySlotCell } from './inventory/InventorySlotCell';
import { WeaponSlotCell } from './inventory/WeaponSlotCell';
import { GHOST_SCALE, SlotDragGhost } from './inventory/SlotDragGhost';
import { useSlotDrag } from './inventory/useSlotDrag';
import { useSlotFlip } from './inventory/useSlotFlip';
import { InventoryItemName } from './InventoryItemVisual';

export function CollectionInventoryButton({ onClick, active }: { onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Inventário (I)"
      aria-pressed={active}
      className={`relative flex h-9 w-9 items-center justify-center rounded-lg border transition-all sm:h-10 sm:w-10 ${
        active
          ? 'border-amber-400/70 bg-[#3b2411] text-amber-100'
          : 'border-slate-700/50 bg-slate-900/90 text-slate-300 hover:bg-slate-800 hover:text-white'
      }`}
    >
      <Backpack className="h-4 w-4" />
    </button>
  );
}

const isTool = (key: string) => key.startsWith('gen:crafttools/');

export function CollectionInventoryPanel() {
  const items = useCollectionInventoryStore((s) => s.items);
  const slots = useCollectionInventoryStore((s) => s.slots);
  const capacity = useCollectionInventoryStore((s) => s.capacity);
  const selectedItemKey = useCollectionInventoryStore((s) => s.selectedItemKey);
  const loaded = useCollectionInventoryStore((s) => s.loaded);
  const loading = useCollectionInventoryStore((s) => s.loading);
  const error = useCollectionInventoryStore((s) => s.error);
  const tableMissing = useCollectionInventoryStore((s) => s.tableMissing);
  const durability = useCollectionInventoryStore((s) => s.durability);
  const toolMax = useCollectionInventoryStore((s) => s.toolMax);
  const durabilityColumnMissing = useCollectionInventoryStore((s) => s.durabilityColumnMissing);
  const durabilitySql = useCollectionInventoryStore((s) => s.durabilitySql);
  const refresh = useCollectionInventoryStore((s) => s.refresh);
  const moveSlot = useCollectionInventoryStore((s) => s.moveSlot);
  const selectItem = useCollectionInventoryStore((s) => s.selectItem);
  const setInventoryError = useCollectionInventoryStore((s) => s.setInventoryError);
  const closeInventory = useInventoryUiStore((s) => s.closeInventory);
  const beginPlacement = useInventoryUiStore((s) => s.beginPlacement);
  const catalog = useInventoryVisualCatalog();

  const placement = usePanelPlacement({
    storageKey: 'chessworld:collection-inventory-panel',
    defaultWidth: 344,
    defaultHeight: 470,
    minW: 300,
    minH: 360,
  });
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Esc fecha (o Phaser não recebe teclas enquanto o foco está na janela).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeInventory();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeInventory]);

  const weaponIndex = weaponSlotIndex(capacity);
  const { setDropOrigin } = useSlotFlip(frameRef, slots);
  const onMove = useCallback(
    (from: number, to: number, at: { x: number; y: number }) => {
      const before = useCollectionInventoryStore.getState().slots;
      const itemKey = before[from];
      if (itemKey) setDropOrigin({ itemKey, x: at.x, y: at.y, scale: GHOST_SCALE });
      moveSlot(from, to);
      // Troca recusada (nada mudou): não deixe a origem "presa" para a próxima animação.
      if (useCollectionInventoryStore.getState().slots === before) setDropOrigin({ itemKey: '', x: 0, y: 0 });
    },
    [moveSlot, setDropOrigin],
  );
  const { drag, handlePointerDown, consumeClick, ghostRef } = useSlotDrag({
    containerRef: frameRef,
    onMove,
    canDropAt: (index) => index !== weaponIndex,
    onDragOut: (_from, itemKey) => {
      const qty = useCollectionInventoryStore.getState().items[itemKey] ?? 0;
      if (qty <= 0 || !getInventoryBridge()) return;
      // Estação portátil: arrastar para fora entra no modo "posicionar" (com opção de soltar).
      beginPlacement(itemKey, qty, isPlaceableStationItemKey(itemKey) ? 'place' : 'drop');
    },
  });

  const storage = useMemo(() => slots.slice(0, weaponIndex), [slots, weaponIndex]);
  const quick = useMemo(() => slots.slice(weaponIndex + 1, capacity), [slots, weaponIndex, capacity]);
  const used = slots.filter((key, index) => key && index !== weaponIndex).length;
  const unslotted = countUnslottedItems({ items, slots });
  const dragging = drag?.active ? drag : null;
  const durabilityOf = (key: string | null) =>
    durabilityColumnMissing ? null : toolDurabilityView(key, key ? durability[key] : null, key ? toolMax[key] : undefined);

  const renderCell = (key: string | null, index: number, tone: 'storage' | 'quick') => (
    <InventorySlotCell
      key={index}
      index={index}
      itemKey={key}
      qty={key ? items[key] : undefined}
      catalog={catalog}
      durability={durabilityOf(key)}
      tone={tone}
      active={!!key && selectedItemKey === key}
      ghosted={dragging?.from === index}
      dropTarget={dragging?.over === index}
      onPointerDown={key ? (event) => handlePointerDown(index, key, event) : undefined}
      onClick={() => {
        if (consumeClick() || !key) return;
        selectItem(selectedItemKey === key ? null : key);
      }}
    />
  );

  return (
    <>
      <div
        ref={placement.panelRef}
        style={placement.style}
        className={`fixed z-[500] w-[min(344px,calc(100vw-16px))] ${placement.style ? '' : 'bottom-[84px] right-3'}`}
      >
        <div
          ref={frameRef}
          className={`overflow-hidden rounded-xl border-[3px] bg-[#2a1a0e] shadow-[0_0_0_1px_#1a0f07,0_18px_40px_rgba(0,0,0,.7)] ${
            placement.dragging ? 'border-amber-400/80' : 'border-[#8a5a2b]'
          }`}
        >
          {/* Cabeçalho — alça de arrasto */}
          <div
            {...placement.dragHandleProps}
            className={`flex select-none items-center justify-between gap-2 border-b border-[#8a5a2b] bg-gradient-to-b from-[#4a2e15] to-[#33200f] px-3 py-2.5 ${
              placement.dragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            title="Arraste para mover"
          >
            <div className="flex min-w-0 items-center gap-2">
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-amber-200/50" />
              <Backpack className="h-4 w-4 shrink-0 text-amber-300" />
              <span className="truncate text-sm font-bold uppercase tracking-[0.14em] text-amber-100">Inventário</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-[#8a5a2b]/70 bg-[#1e130a] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-200/90" title="Slots ocupados">
                {used}/{capacity - 1}
              </span>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={closeInventory}
                className="flex h-7 w-7 items-center justify-center rounded-md text-amber-200/80 transition-colors hover:bg-black/30 hover:text-white"
                title="Fechar (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Avisos */}
          {error && (
            <div className="flex items-start gap-2 border-b border-red-900/60 bg-[#3a1512] px-3 py-2 text-xs text-red-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => setInventoryError(null)} className="text-red-200/80 hover:text-white" title="Dispensar">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {tableMissing && (
            <div className="border-b border-amber-900/60 bg-[#3a2a12] px-3 py-2 text-xs text-amber-100">
              O inventário ainda não foi ativado no servidor (tabela ausente). Peça a um administrador.
            </div>
          )}
          {!tableMissing && durabilityColumnMissing && (
            <div className="border-b border-amber-900/60 bg-[#3a2a12] px-3 py-2 text-xs text-amber-100" data-testid="durability-migration-banner">
              {durabilitySql ? (
                <>
                  Durabilidade das ferramentas desligada: falta a coluna no Supabase. Um administrador precisa rodar no SQL Editor:
                  <code className="mt-1 block select-all break-all rounded bg-black/40 px-2 py-1 font-mono text-[10px] text-amber-50">{durabilitySql}</code>
                </>
              ) : (
                'Durabilidade das ferramentas indisponível: o servidor ainda não foi atualizado.'
              )}
            </div>
          )}
          {unslotted > 0 && (
            <div className="border-b border-amber-900/60 bg-[#3a2a12] px-3 py-2 text-xs text-amber-100">
              {unslotted === 1 ? '1 item está' : `${unslotted} itens estão`} sem slot (inventário menor). Libere espaço para vê-lo.
            </div>
          )}

          {/* Grade principal (rolável) */}
          <div className="max-h-[min(52vh,392px)] overflow-y-auto overscroll-contain bg-[#2a1a0e] p-3 [scrollbar-color:#6b4a26_#1a0f07]">
            {!loaded && loading ? (
              <div className="py-10 text-center text-xs text-amber-200/70">Carregando inventário…</div>
            ) : (
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${INVENTORY_COLUMNS}, minmax(0, 1fr))` }}>
                {storage.map((key, index) => renderCell(key, index, 'storage'))}
              </div>
            )}
          </div>

          {/* Acesso rápido (última linha) */}
          <div className="border-t-2 border-[#8a5a2b] bg-[#33200f] px-3 pb-2.5 pt-2">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200/80">Acesso rápido</span>
              <span className="h-px flex-1 bg-[#8a5a2b]/60" />
              <span className="text-[10px] text-amber-200/50">1º slot: arma da classe</span>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${INVENTORY_COLUMNS}, minmax(0, 1fr))` }}>
              <WeaponSlotCell index={weaponIndex} catalog={catalog} />
              {quick.map((key, offset) => renderCell(key, weaponIndex + 1 + offset, 'quick'))}
            </div>
          </div>

          {/* Rodapé */}
          <div className="border-t border-[#8a5a2b]/60 bg-[#22150b] px-3 py-2 text-[10px] leading-relaxed text-amber-200/60">
            {selectedItemKey ? (
              <span>
                Selecionado: <b className="text-amber-100"><InventoryItemName itemKey={selectedItemKey} catalog={catalog} /></b>
                {isTool(selectedItemKey) ? ' — clique nele no acesso rápido para equipar.' : ''}
              </span>
            ) : (
              <span>Arraste para reorganizar · arraste para fora da janela para soltar no chão · ferramentas equipam pelo acesso rápido.</span>
            )}
          </div>
        </div>
      </div>
      {dragging && (
        <SlotDragGhost
          ghostRef={ghostRef}
          itemKey={dragging.itemKey}
          catalog={catalog}
          qty={items[dragging.itemKey]}
          durability={durabilityOf(dragging.itemKey)}
        />
      )}
    </>
  );
}
