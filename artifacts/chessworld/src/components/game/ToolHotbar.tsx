/**
 * Hotbar (acesso rápido) fixa no rodapé: espelha a ÚLTIMA linha do inventário.
 * 1º slot = arma da classe (ícone real + estado equipada); os demais são slots
 * comuns — ferramentas equipam/desequipam ao clicar, itens só ficam
 * selecionados. Reordenar por arrasto; arrastar para fora entra no modo de
 * soltar no chão. Também é onde aparecem as recusas do servidor (equipar/
 * inventário), porque a janela pode estar fechada.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Backpack, Sparkles, X } from 'lucide-react';
import { usePlayerCharacterStore } from '../../stores/playerCharacterStore';
import { useCollectionInventoryStore, weaponSlotIndex } from '../../stores/collectionInventoryStore';
import { useInventoryUiStore } from '../../stores/inventoryUiStore';
import { useProgressStore } from '../../stores/progressStore';
import { getInventoryBridge } from '../../game/inventory/inventoryBridge';
import { canEat, eat } from '../../game/progress/eatBridge';
import { loadCraftBadges, useInventoryVisualCatalog } from '../../lib/inventory/inventoryVisualCatalog';
import { toolDurabilityView } from '../../lib/inventory/toolDurability';
import { isPlaceableStationItemKey } from '../../shared/craft/PlaceableStations';
import { isEdibleItem, type CraftBadgeMap } from '../../shared/craft/CraftBadges';
import { durabilityLabel } from './inventory/DurabilityBar';
import { EnergyBar } from './EnergyBar';
import { InventorySlotCell } from './inventory/InventorySlotCell';
import { WeaponSlotCell } from './inventory/WeaponSlotCell';
import { GHOST_SCALE, SlotDragGhost } from './inventory/SlotDragGhost';
import { useSlotDrag } from './inventory/useSlotDrag';
import { useSlotFlip } from './inventory/useSlotFlip';

const isTool = (key: string) => key.startsWith('gen:crafttools/');
const NOTICE_MS = 5000;
/** Duração do "loader" de comer: o slot enche e só então o servidor é acionado. */
const EAT_MS = 1600;

/** Sobreposição verde que enche o slot de baixo para cima enquanto o jogador come. */
function EatingOverlay() {
  return (
    <span
      aria-hidden
      data-testid="eating-overlay"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[4px]"
    >
      <span
        className="absolute inset-0 origin-bottom bg-emerald-400/55 mix-blend-screen"
        style={{ animation: `eat-fill ${EAT_MS}ms linear forwards` }}
      />
    </span>
  );
}

export function ToolHotbar() {
  const character = usePlayerCharacterStore((s) => s.character);
  const ready = usePlayerCharacterStore((s) => s.worldReady);
  const send = usePlayerCharacterStore((s) => s.equipSender);
  const live = usePlayerCharacterStore((s) => s.liveWeapon);
  const equipError = usePlayerCharacterStore((s) => s.equipError);
  const setEquipError = usePlayerCharacterStore((s) => s.setEquipError);
  const slots = useCollectionInventoryStore((s) => s.slots);
  const items = useCollectionInventoryStore((s) => s.items);
  const capacity = useCollectionInventoryStore((s) => s.capacity);
  const selectedItemKey = useCollectionInventoryStore((s) => s.selectedItemKey);
  const durability = useCollectionInventoryStore((s) => s.durability);
  const toolMax = useCollectionInventoryStore((s) => s.toolMax);
  const durabilityColumnMissing = useCollectionInventoryStore((s) => s.durabilityColumnMissing);
  const inventoryError = useCollectionInventoryStore((s) => s.error);
  const setInventoryError = useCollectionInventoryStore((s) => s.setInventoryError);
  const selectItem = useCollectionInventoryStore((s) => s.selectItem);
  const moveSlot = useCollectionInventoryStore((s) => s.moveSlot);
  const ensureLoaded = useCollectionInventoryStore((s) => s.ensureLoaded);
  const inventoryOpen = useInventoryUiStore((s) => s.open);
  const toggleInventory = useInventoryUiStore((s) => s.toggleInventory);
  const beginPlacement = useInventoryUiStore((s) => s.beginPlacement);
  const catalog = useInventoryVisualCatalog();
  const eatingKey = useProgressStore((s) => s.eatingKey);
  const setEating = useProgressStore((s) => s.setEating);
  const foods = useProgressStore((s) => s.config.energy.foods);
  const skillsOpen = useProgressStore((s) => s.skillsOpen);
  const toggleSkills = useProgressStore((s) => s.toggleSkills);
  const [badges, setBadges] = useState<CraftBadgeMap | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const eatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Slots são populados pelo servidor — carregar assim que o mundo abrir, não só ao abrir a janela.
  useEffect(() => {
    if (character && ready) ensureLoaded();
  }, [character, ready, ensureLoaded]);

  // Badges decidem o que o clique faz num item comum: só `edible` come
  // (`food` sozinha é ingrediente e se comporta como item normal).
  useEffect(() => {
    let cancelled = false;
    loadCraftBadges().then((map) => { if (!cancelled) setBadges(map); }).catch(() => { /* sem badges: nada é comestível */ });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => () => { if (eatTimerRef.current) clearTimeout(eatTimerRef.current); }, []);

  // Avisos somem sozinhos.
  const notice = equipError ?? inventoryError;
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setEquipError(null);
      setInventoryError(null);
    }, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, setEquipError, setInventoryError]);

  const weaponIndex = weaponSlotIndex(capacity);
  const { setDropOrigin } = useSlotFlip(barRef, slots);
  const onMove = useCallback(
    (from: number, to: number, at: { x: number; y: number }) => {
      const before = useCollectionInventoryStore.getState().slots;
      const itemKey = before[from];
      if (itemKey) setDropOrigin({ itemKey, x: at.x, y: at.y, scale: GHOST_SCALE });
      moveSlot(from, to);
      if (useCollectionInventoryStore.getState().slots === before) setDropOrigin({ itemKey: '', x: 0, y: 0 });
    },
    [moveSlot, setDropOrigin],
  );
  const { drag, handlePointerDown, consumeClick, ghostRef } = useSlotDrag({
    containerRef: barRef,
    outMargin: 40,
    onMove,
    canDropAt: (index) => index !== weaponIndex,
    onDragOut: (_from, itemKey) => {
      const qty = useCollectionInventoryStore.getState().items[itemKey] ?? 0;
      if (qty <= 0 || !getInventoryBridge()) return;
      // Estação portátil: arrastar para fora entra no modo "posicionar" (com opção de soltar).
      beginPlacement(itemKey, qty, isPlaceableStationItemKey(itemKey) ? 'place' : 'drop');
    },
  });
  const quick = useMemo(() => slots.slice(weaponIndex + 1, capacity), [slots, weaponIndex, capacity]);
  const dragging = drag?.active ? drag : null;
  const durabilityOf = (key: string | null) =>
    durabilityColumnMissing ? null : toolDurabilityView(key, key ? durability[key] : null, key ? toolMax[key] : undefined);

  if (!character || !ready) return null;

  const isEdible = (key: string) => !!badges && isEdibleItem(badges, key);

  /** Comer: loader de EAT_MS no slot e SÓ então o pedido vai à sala. */
  const startEating = (key: string) => {
    if (eatingKey) return; // já mastigando
    if (!canEat()) {
      setInventoryError('Conexão com o mundo não está pronta.');
      return;
    }
    if ((foods[key] ?? 0) <= 0) {
      setInventoryError('Esse alimento ainda não tem energia configurada.');
      return;
    }
    const snapshot = useProgressStore.getState().snapshot;
    if (snapshot && snapshot.energy >= snapshot.maxEnergy) {
      setInventoryError('Você não está com fome.');
      return;
    }
    setEating(key);
    eatTimerRef.current = setTimeout(() => {
      eatTimerRef.current = null;
      eat(key)
        .catch((e: Error) => {
          // Recusas com requestId já foram avisadas pelo GameCanvas; aqui só timeouts/rede.
          if (!useCollectionInventoryStore.getState().error) setInventoryError(e.message);
        })
        .finally(() => {
          if (useProgressStore.getState().eatingKey === key) setEating(null);
        });
    }, EAT_MS);
  };

  const onCellClick = (key: string | null) => {
    if (consumeClick() || !key) return;
    if (isTool(key)) {
      selectItem(null);
      send?.(live !== key, key);
      return;
    }
    if (isEdible(key)) {
      startEating(key);
      return;
    }
    selectItem(selectedItemKey === key ? null : key);
  };

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-2 z-[110] flex flex-col items-center gap-2">
        {notice && (
          <div className="pointer-events-auto flex max-w-[min(92vw,420px)] items-start gap-2 rounded-lg border border-red-800 bg-[#3a1512] px-3 py-2 text-xs text-red-100 shadow-lg">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
            <span className="flex-1">{notice}</span>
            <button
              type="button"
              onClick={() => { setEquipError(null); setInventoryError(null); }}
              className="text-red-200/80 hover:text-white"
              title="Dispensar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <EnergyBar />
        <div className="pointer-events-auto flex items-stretch gap-1.5">
          <div
            ref={barRef}
            className="flex items-center gap-1.5 rounded-xl border-[3px] border-[#8a5a2b] bg-[#2a1a0e] p-1.5 shadow-[0_0_0_1px_#1a0f07,0_10px_28px_rgba(0,0,0,.6)]"
          >
            <div className="w-12 sm:w-14">
              <WeaponSlotCell index={weaponIndex} catalog={catalog} thumbSize={36} compact />
            </div>
            <span className="mx-0.5 h-8 w-px self-center bg-[#8a5a2b]/70" aria-hidden />
            {quick.map((key, offset) => {
              const index = weaponIndex + 1 + offset;
              const active = !!key && (isTool(key) ? live === key : selectedItemKey === key);
              const view = durabilityOf(key);
              const hint = key
                ? isTool(key)
                  ? live === key ? 'Ferramenta equipada — clique para guardar' : 'Clique para equipar a ferramenta'
                  : isEdible(key)
                    ? eatingKey === key ? 'Comendo…' : `Clique para comer${foods[key] ? ` (+${foods[key]} energia cada)` : ''}`
                    : undefined
                : 'Slot vazio';
              return (
                <div key={index} className="w-12 sm:w-14">
                  <InventorySlotCell
                    index={index}
                    itemKey={key}
                    qty={key ? items[key] : undefined}
                    catalog={catalog}
                    durability={view}
                    tone="quick"
                    thumbSize={36}
                    active={active}
                    ghosted={dragging?.from === index}
                    dropTarget={dragging?.over === index}
                    title={hint && view ? `${hint} · ${durabilityLabel(view)}` : hint}
                    overlay={key && eatingKey === key ? <EatingOverlay /> : undefined}
                    onPointerDown={key ? (event) => handlePointerDown(index, key, event) : undefined}
                    onClick={() => onCellClick(key)}
                  />
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={toggleInventory}
            aria-pressed={inventoryOpen}
            title={inventoryOpen ? 'Fechar inventário' : 'Abrir inventário'}
            className={`flex w-11 flex-col items-center justify-center gap-0.5 rounded-xl border-[3px] text-[9px] font-bold uppercase tracking-wide shadow-[0_0_0_1px_#1a0f07,0_10px_28px_rgba(0,0,0,.6)] transition-colors sm:w-12 ${
              inventoryOpen
                ? 'border-amber-400/80 bg-[#4a2e15] text-amber-100'
                : 'border-[#8a5a2b] bg-[#2a1a0e] text-amber-200/80 hover:bg-[#33200f] hover:text-amber-100'
            }`}
          >
            <Backpack className="h-4 w-4" />
            <span>Bolsa</span>
          </button>
          <button
            type="button"
            onClick={toggleSkills}
            aria-pressed={skillsOpen}
            data-testid="skills-button"
            title={skillsOpen ? 'Fechar habilidades' : 'Abrir habilidades'}
            className={`flex w-11 flex-col items-center justify-center gap-0.5 rounded-xl border-[3px] text-[9px] font-bold uppercase tracking-wide shadow-[0_0_0_1px_#1a0f07,0_10px_28px_rgba(0,0,0,.6)] transition-colors sm:w-12 ${
              skillsOpen
                ? 'border-amber-400/80 bg-[#4a2e15] text-amber-100'
                : 'border-[#8a5a2b] bg-[#2a1a0e] text-amber-200/80 hover:bg-[#33200f] hover:text-amber-100'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            <span>Skills</span>
          </button>
        </div>
      </div>
      {dragging && (
        <SlotDragGhost
          ghostRef={ghostRef}
          itemKey={dragging.itemKey}
          catalog={catalog}
          qty={items[dragging.itemKey]}
          durability={durabilityOf(dragging.itemKey)}
          size={44}
        />
      )}
    </>
  );
}
