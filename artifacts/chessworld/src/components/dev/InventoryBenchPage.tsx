/**
 * Bancada DEV do inventário — rota `/dev/inventario`, só existe em
 * `import.meta.env.DEV` (ver main.tsx).
 *
 * Renderiza a hotbar e a janela do inventário reais SEM Phaser/Colyseus/login,
 * com os stores semeados, para exercitar arrastar-e-soltar, animações de troca
 * e barras de durabilidade num navegador sem WebGL (testes automatizados) ou
 * sem precisar entrar no mundo. Nada aqui fala com o servidor: `refresh` e
 * `ensureLoaded` viram no-ops e o equipar só alterna o estado local.
 */
import { useEffect, useState } from 'react';
import { CollectionInventoryPanel } from '../game/CollectionInventoryPanel';
import { ToolHotbar } from '../game/ToolHotbar';
import { useCollectionInventoryStore } from '../../stores/collectionInventoryStore';
import { useInventoryUiStore } from '../../stores/inventoryUiStore';
import { usePlayerCharacterStore } from '../../stores/playerCharacterStore';
import { emptySlots, weaponSlotIndex } from '../../lib/inventory/inventorySlots';
import type { PlayerCharacterConfigV1 } from '../../shared/characters/PlayerCharacterShapes';

const CAPACITY = 25;
const PICKAXE = 'gen:crafttools/pickaxe/stone';
const AXE = 'gen:crafttools/axe/iron';
const GOLD_PICKAXE = 'gen:crafttools/pickaxe/gold';

const BENCH_CHARACTER: PlayerCharacterConfigV1 = {
  v: 1,
  classId: 'guerreiro',
  appearance: {
    v: 1,
    skinTone: 'default',
    layers: {
      head: { familyId: 'head', variantId: 'default' },
      top: { familyId: 'top', variantId: 'default' },
      bottom: { familyId: 'bottom', variantId: 'default' },
      hair: null,
    },
  },
  equippedWeapon: null,
};

function seedStores(durabilityColumnMissing: boolean) {
  const items: Record<string, number> = {
    'mineral:pedra': 12,
    'mineral:carvao': 5,
    'mineral:ferro': 3,
    'mineral:cobre': 7,
    'mineral:ouro': 1,
    [PICKAXE]: 2,
    [AXE]: 1,
    [GOLD_PICKAXE]: 1,
  };
  const slots = emptySlots(CAPACITY);
  slots[0] = 'mineral:pedra';
  slots[1] = 'mineral:carvao';
  slots[2] = 'mineral:ferro';
  slots[7] = 'mineral:cobre';
  slots[12] = 'mineral:ouro';
  const quick = weaponSlotIndex(CAPACITY) + 1;
  slots[quick] = PICKAXE;
  slots[quick + 1] = AXE;
  slots[quick + 3] = GOLD_PICKAXE;

  useCollectionInventoryStore.setState({
    items,
    slots,
    capacity: CAPACITY,
    // picareta de pedra cheia (ausente = cheia) · machado gasto (60%) · picareta de ouro crítica (~14%)
    durability: { [AXE]: 180, [GOLD_PICKAXE]: 75 },
    toolMax: { [PICKAXE]: 70, [AXE]: 300, [GOLD_PICKAXE]: 550 },
    durabilityColumnMissing,
    durabilitySql: durabilityColumnMissing
      ? 'ALTER TABLE collection_inventory ADD COLUMN IF NOT EXISTS durability integer;'
      : null,
    loaded: true,
    loading: false,
    error: null,
    tableMissing: false,
    tableSql: null,
    selectedItemKey: null,
    refresh: async () => {},
    ensureLoaded: () => {},
  });

  usePlayerCharacterStore.setState({
    character: BENCH_CHARACTER,
    worldReady: true,
    classWeaponRef: null,
    liveWeapon: '',
    equipSender: (equip, ref) => usePlayerCharacterStore.setState({ liveWeapon: equip && ref ? ref : '' }),
  });
}

export function InventoryBenchPage() {
  const [columnMissing, setColumnMissing] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const open = useInventoryUiStore((s) => s.open);
  const openInventory = useInventoryUiStore((s) => s.openInventory);

  useEffect(() => {
    seedStores(columnMissing);
    setSeeded(true);
  }, [columnMissing]);

  useEffect(() => {
    if (seeded) openInventory();
  }, [seeded, openInventory]);

  if (!seeded) return null;

  return (
    <div className="relative min-h-screen bg-slate-900 text-slate-100" data-testid="inventory-bench">
      <div className="p-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">Bancada do inventário (DEV)</span>
        <button
          type="button"
          className="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
          onClick={openInventory}
          data-testid="bench-open-inventory"
        >
          Abrir inventário
        </button>
        <button
          type="button"
          className="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
          onClick={() => setColumnMissing((v) => !v)}
          data-testid="bench-toggle-column"
        >
          {columnMissing ? 'Simular coluna presente' : 'Simular coluna ausente'}
        </button>
        <button
          type="button"
          className="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
          onClick={() => seedStores(columnMissing)}
          data-testid="bench-reset"
        >
          Repor itens
        </button>
      </div>
      {open && <CollectionInventoryPanel />}
      <ToolHotbar />
    </div>
  );
}
