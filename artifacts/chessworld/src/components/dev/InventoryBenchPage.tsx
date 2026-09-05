/**
 * Bancada DEV do inventário — rota `/dev/inventario`, só existe em
 * `import.meta.env.DEV` (ver main.tsx).
 *
 * Renderiza a hotbar e a janela do inventário reais SEM Phaser/Colyseus/login,
 * com os stores semeados, para exercitar arrastar-e-soltar, animações de troca
 * e barras de durabilidade num navegador sem WebGL (testes automatizados) ou
 * sem precisar entrar no mundo. Nada aqui fala com o servidor: `refresh` e
 * `ensureLoaded` viram no-ops, o equipar só alterna o estado local e comer
 * (bife no acesso rápido, energia em 70%) é respondido por uma sala falsa com
 * a mesma regra do servidor — dá para ver a comida voar até o "personagem"
 * (centro da janela) e o número do slot descer.
 */
import { useEffect, useState } from 'react';
import { CollectionInventoryPanel } from '../game/CollectionInventoryPanel';
import { SkillsPanel } from '../game/SkillsPanel';
import { ToolHotbar } from '../game/ToolHotbar';
import { useCollectionInventoryStore } from '../../stores/collectionInventoryStore';
import { useInventoryUiStore } from '../../stores/inventoryUiStore';
import { useProgressStore } from '../../stores/progressStore';
import { usePlayerCharacterStore } from '../../stores/playerCharacterStore';
import { clearEatBridge, rejectEat, resolveEat, setEatSender } from '../../game/progress/eatBridge';
import { emptySlots, weaponSlotIndex } from '../../lib/inventory/inventorySlots';
import { primeCraftData } from '../../lib/inventory/inventoryVisualCatalog';
import { BADGE_EDIBLE, BADGE_FOOD } from '../../shared/craft/CraftBadges';
import type { PlayerCharacterConfigV1 } from '../../shared/characters/PlayerCharacterShapes';
import {
  DEFAULT_ENERGY_SKILLS_CONFIG,
  SKILL_IDS,
  evaluateEnergyState,
  skillProgressFromXp,
  type ProgressSnapshot,
  type SkillId,
} from '../../shared/progress/EnergySkillsShapes';

const CAPACITY = 25;
const PICKAXE = 'gen:crafttools/pickaxe/stone';
const AXE = 'gen:crafttools/axe/iron';
const GOLD_PICKAXE = 'gen:crafttools/pickaxe/gold';
const STEAK = 'bife/assado';
const STEAK_ENERGY = 25;
const STEAK_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><ellipse cx="16" cy="17" rx="13" ry="9" fill="#7a3b1e"/><ellipse cx="15" cy="16" rx="10" ry="6" fill="#b5532a"/><ellipse cx="13" cy="15" rx="4" ry="2" fill="#e08a5a" opacity=".8"/><circle cx="22" cy="18" r="2.2" fill="#f4e7d3"/></svg>',
  );

// Itens/badges sem rede: o bife é `food` + `edible` (só `edible` deixa comer).
primeCraftData({
  items: { [STEAK]: { itemId: STEAK, name: 'Bife assado', imageUrl: STEAK_ICON } },
  badges: { [STEAK]: [BADGE_FOOD, BADGE_EDIBLE] },
});

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
    [STEAK]: 5,
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
  slots[quick + 2] = STEAK;
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

  // Energia em 70% (faltam 75) e o bife valendo 25: comer prevê 3 dos 5 bifes.
  const { energy } = DEFAULT_ENERGY_SKILLS_CONFIG;
  useProgressStore.setState({
    config: { ...DEFAULT_ENERGY_SKILLS_CONFIG, energy: { ...energy, foods: { [STEAK]: STEAK_ENERGY } } },
    configLoaded: true,
  });
  useProgressStore.getState().applySnapshot(fakeProgressSnapshot(Math.round(energy.maxEnergy * 0.7)));
}

function fakeProgressSnapshot(current: number, gains: ProgressSnapshot['gains'] = []): ProgressSnapshot {
  const { energy, skills: skillsConfig } = DEFAULT_ENERGY_SKILLS_CONFIG;
  const xpById: Partial<Record<SkillId, number>> = { mining: 340, woodcutting: 120, fighting: 60, forging: 15, cooking: 230 };
  const skills = {} as ProgressSnapshot['skills'];
  for (const id of SKILL_IDS) skills[id] = skillProgressFromXp(skillsConfig, xpById[id] ?? 0);
  return {
    seq: Date.now(),
    energy: current,
    maxEnergy: energy.maxEnergy,
    maxHp: energy.maxHp,
    weakSpeedPercent: energy.weakSpeedPercent,
    state: evaluateEnergyState(energy, current),
    skills,
    gains,
    persisted: true,
  };
}

/**
 * Sala falsa para o `eat_item`: mesma regra do servidor (come só o necessário
 * para encher), responde depois de um atraso curto com os totais novos e um
 * snapshot com a energia cheia — o que o GameCanvas faria com `eat_result`.
 */
function installFakeEatRoom() {
  setEatSender(({ requestId, itemKey }) => {
    setTimeout(() => {
      const inventory = useCollectionInventoryStore.getState();
      const progress = useProgressStore.getState();
      const snapshot = progress.snapshot;
      const perUnit = progress.config.energy.foods[itemKey] ?? 0;
      const owned = inventory.items[itemKey] ?? 0;
      const missing = snapshot ? snapshot.maxEnergy - snapshot.energy : 0;
      const eaten = perUnit > 0 ? Math.min(owned, Math.ceil(missing / perUnit)) : 0;
      if (!snapshot || eaten <= 0) {
        rejectEat(requestId, 'Você não está com fome');
        return;
      }
      const items = Object.entries(inventory.items).map(([key, qty]) => ({
        itemKey: key,
        qty: key === itemKey ? qty - eaten : qty,
        durability: inventory.durability[key],
      }));
      inventory.applyServerTotals(items);
      const energy = Math.min(snapshot.maxEnergy, snapshot.energy + eaten * perUnit);
      progress.applySnapshot(fakeProgressSnapshot(energy, [{ skill: 'cooking', xp: DEFAULT_ENERGY_SKILLS_CONFIG.skills.cooking.eat }]));
      resolveEat(requestId, { items, itemKey, eaten, energy, maxEnergy: snapshot.maxEnergy });
    }, 250);
  });
  return clearEatBridge;
}

export function InventoryBenchPage() {
  const [columnMissing, setColumnMissing] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const open = useInventoryUiStore((s) => s.open);
  const skillsOpen = useProgressStore((s) => s.skillsOpen);
  const openInventory = useInventoryUiStore((s) => s.openInventory);

  useEffect(() => {
    seedStores(columnMissing);
    setSeeded(true);
  }, [columnMissing]);
  useEffect(installFakeEatRoom, []);

  useEffect(() => {
    if (!seeded) return;
    openInventory();
    // `?skills=1` abre o painel de habilidades (no lugar do inventário — são exclusivos).
    if (new URLSearchParams(window.location.search).has('skills')) {
      const progress = useProgressStore.getState();
      if (!progress.skillsOpen) progress.toggleSkills();
    }
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
      {skillsOpen && <SkillsPanel />}
      <ToolHotbar />
    </div>
  );
}
