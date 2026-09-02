/**
 * Inventário de FERRAMENTAS de coleta (fase de teste).
 *
 * Itens = TODAS as variações de crafttools do gerador (manifest) cuja config
 * no /admin/rigs não desligou "incluir no inventário" (ausente = incluída).
 * A ORDEM (arrastar e soltar) e a DURABILIDADE atual de cada ferramenta são
 * locais deste navegador (localStorage) — regra de teste, ainda sem
 * persistência por conta no servidor.
 *
 * Durabilidade: −1 a cada golpe que ACERTA um nó de recurso (certo, errado
 * ou fraco — golpe no vento não gasta). Em 0 a ferramenta segue funcionando;
 * quebra/manutenção é regra futura.
 */
import { create } from 'zustand';
import { getGeneratorManifest } from '../game/characters/appearanceRuntime';
import { loadWeaponFamiliesMap } from '../game/rigs/weaponLoader';
import {
  DEFAULT_TOOL_DURABILITY,
  DEFAULT_TOOL_POWER,
  getToolLevel,
  getWeaponVariantTool,
  isToolInInventory,
} from '../shared/combat/WeaponShapes';
import { GATHER_TOOL_KINDS, type GatherToolKind } from '../shared/collection/CollectionShapes';

export interface ToolInventoryItem {
  /** gen:crafttools/<família>/<variação> — mesma ref do equip_weapon. */
  ref: string;
  familyId: string;
  variantId: string;
  /** Nome PT-BR ("Picareta de Ferro"). */
  name: string;
  /** Tipo de ferramenta (= familyId quando reconhecido). */
  kind: GatherToolKind | null;
  /** Nível (0..6) autorado no /admin/rigs. */
  level: number;
  power: number;
  maxDurability: number;
  /** URL da folha de sprites (miniatura). */
  sheetUrl: string;
}

const STORAGE_KEY = 'chessworld:tool-inventory:v1';

const FAMILY_LABELS: Record<string, string> = {
  axe: 'Machado',
  pickaxe: 'Picareta',
  machete: 'Facão',
  scissors: 'Tesoura',
};
const MATERIAL_LABELS: Record<string, string> = {
  wood: 'Madeira',
  stone: 'Pedra',
  copper: 'Cobre',
  iron: 'Ferro',
  gold: 'Ouro',
  diamond: 'Diamante',
  cristalreal: 'Cristal Real',
};

function toolDisplayName(familyId: string, variantId: string): string {
  const fam = FAMILY_LABELS[familyId] ?? familyId;
  const mat = MATERIAL_LABELS[variantId] ?? variantId;
  return `${fam} de ${mat}`;
}

interface PersistedState {
  order: string[];
  durability: Record<string, number>;
}

function readPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { order: [], durability: {} };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      order: Array.isArray(parsed.order) ? parsed.order.filter((r) => typeof r === 'string') : [],
      durability:
        parsed.durability && typeof parsed.durability === 'object' && !Array.isArray(parsed.durability)
          ? (parsed.durability as Record<string, number>)
          : {},
    };
  } catch {
    return { order: [], durability: {} };
  }
}

function persist(items: ToolInventoryItem[], durability: Record<string, number>): void {
  try {
    const state: PersistedState = { order: items.map((i) => i.ref), durability };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage cheio/indisponível — ordem/durabilidade voltam ao padrão no F5 */
  }
}

interface ToolInventoryState {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** Já na ordem escolhida pelo jogador (drag-and-drop). */
  items: ToolInventoryItem[];
  /** ref → durabilidade ATUAL (0..max). */
  durability: Record<string, number>;
  load: () => Promise<void>;
  /** −1 na durabilidade (golpe que acertou um recurso); no-op para armas/mão. */
  consumeDurability: (ref: string) => void;
  /** Reordena (drag-and-drop do inventário). */
  moveItem: (fromIndex: number, toIndex: number) => void;
}

export const useToolInventoryStore = create<ToolInventoryState>((set, get) => ({
  loaded: false,
  loading: false,
  error: null,
  items: [],
  durability: {},

  async load() {
    if (get().loading || get().loaded) return;
    set({ loading: true, error: null });
    try {
      const [manifest, families] = await Promise.all([
        getGeneratorManifest(),
        loadWeaponFamiliesMap(),
      ]);
      const base = import.meta.env.BASE_URL;
      const found: ToolInventoryItem[] = [];
      for (const fam of manifest.categories['crafttools'] ?? []) {
        for (const variant of fam.variants) {
          const cfg = families[fam.id] ?? null;
          if (!isToolInInventory(cfg, variant.id)) continue; // toggle OFF no /admin/rigs
          const tool = getWeaponVariantTool(cfg, variant.id);
          found.push({
            ref: `gen:crafttools/${fam.id}/${variant.id}`,
            familyId: fam.id,
            variantId: variant.id,
            name: toolDisplayName(fam.id, variant.id),
            kind:
              (GATHER_TOOL_KINDS as readonly string[]).includes(fam.id) && fam.id !== 'hand'
                ? (fam.id as GatherToolKind)
                : null,
            level: getToolLevel(cfg, variant.id),
            power: tool?.power ?? DEFAULT_TOOL_POWER,
            maxDurability: tool?.durability ?? DEFAULT_TOOL_DURABILITY,
            sheetUrl: `${base}${variant.url}`,
          });
        }
      }
      // Ordem persistida primeiro; ferramentas novas entram no fim.
      const saved = readPersisted();
      const byRef = new Map(found.map((i) => [i.ref, i]));
      const ordered: ToolInventoryItem[] = [];
      for (const ref of saved.order) {
        const item = byRef.get(ref);
        if (item) {
          ordered.push(item);
          byRef.delete(ref);
        }
      }
      ordered.push(...byRef.values());
      // Durabilidade persistida, clampada ao máximo atual do admin.
      const durability: Record<string, number> = {};
      for (const item of ordered) {
        const savedVal = saved.durability[item.ref];
        durability[item.ref] =
          typeof savedVal === 'number' && Number.isFinite(savedVal)
            ? Math.max(0, Math.min(item.maxDurability, Math.round(savedVal)))
            : item.maxDurability;
      }
      set({ loaded: true, loading: false, items: ordered, durability });
      persist(ordered, durability);
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  consumeDurability(ref) {
    const s = get();
    if (!(ref in s.durability)) return; // não é ferramenta do inventário (arma/mão limpa)
    const next = { ...s.durability, [ref]: Math.max(0, s.durability[ref] - 1) };
    set({ durability: next });
    persist(s.items, next);
  },

  moveItem(fromIndex, toIndex) {
    const s = get();
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= s.items.length) return;
    if (toIndex < 0 || toIndex >= s.items.length) return;
    const items = [...s.items];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    set({ items });
    persist(items, s.durability);
  },
}));
