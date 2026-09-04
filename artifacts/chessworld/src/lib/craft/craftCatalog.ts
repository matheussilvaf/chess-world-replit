/**
 * Catálogo unificado de TODOS os itens do jogo para o manual de receitas
 * (/admin/craft): ferramentas e armas do gerador, recursos do Mundo de
 * Coleta e craft items criados no admin.
 *
 * Cada entrada usa o id CANÔNICO do item no sistema de craft (ver
 * CraftShapes): ref gen: completa, chave de recurso ou slug de craft item.
 */
import type { GeneratorManifest } from '../character-generator/types';
import { CRAFTTOOLS_CATEGORY, WEAPON_CATEGORY } from '../../shared/combat/WeaponShapes';
import { yieldItemKeyFor } from '../../shared/collection/CollectionShapes';
import type { CraftItemConfig } from '../../shared/craft/CraftShapes';
import { PLACEABLE_STATIONS, placeableStationFor } from '../../shared/craft/PlaceableStations';
import {
  RESOURCE_DEFINITIONS,
  RESOURCE_DROP_ICONS,
  RESOURCE_GROUPS,
  type ResourceGroup,
} from '../collection/resourceCatalog';

export type CraftSectionId =
  | 'tools'
  | 'weapons'
  | 'minerais'
  | 'arvores'
  | 'ervas'
  | 'outros'
  | 'animais'
  | 'drops_animais'
  | 'custom';

/** Como desenhar a miniatura de uma entrada. */
export type CraftThumb =
  | { kind: 'sheet96'; url: string; col: number }
  | { kind: 'image'; url: string }
  | { kind: 'frame'; url: string; frameWidth: number; frameHeight: number }
  | { kind: 'none' };

export interface CraftCatalogEntry {
  /** Id canônico no sistema de craft (ref gen:, chave de recurso ou slug). */
  id: string;
  /** Nome PT-BR exibido. */
  name: string;
  /** Linha secundária (id técnico/observação). */
  detail?: string;
  sectionId: CraftSectionId;
  thumb: CraftThumb;
}

export interface CraftCatalogSection {
  id: CraftSectionId;
  label: string;
  entries: CraftCatalogEntry[];
}

export interface CraftCatalog {
  /** Ordem de exibição: ferramentas, armas, recursos por grupo, itens criados. */
  sections: CraftCatalogSection[];
  byId: ReadonlyMap<string, CraftCatalogEntry>;
}

const TOOL_FAMILY_LABELS: Record<string, string> = {
  axe: 'Machado',
  pickaxe: 'Picareta',
  machete: 'Facão',
  scissors: 'Tesoura',
};
const WEAPON_FAMILY_LABELS: Record<string, string> = {
  sword: 'Espada',
  bowandarrow: 'Arco',
  wand: 'Cajado',
  spear: 'Lança',
  arrow: 'Flecha',
};
const MATERIAL_LABELS: Record<string, string> = {
  wood: 'Madeira',
  stone: 'Pedra',
  copper: 'Cobre',
  iron: 'Ferro',
  gold: 'Ouro',
  diamond: 'Diamante',
  lunar: 'Lunar',
  cristalreal: 'Cristal Real',
};
/** Famílias cujo frame "parado" é vazio no sheet — miniatura usa a pose de tiro. */
const BOW_LIKE_FAMILIES = new Set(['bowandarrow', 'arrow']);
const BOW_THUMB_COL = 16;
const DEFAULT_THUMB_COL = 1;

const GROUP_SECTIONS: Record<ResourceGroup, { id: CraftSectionId; label: string }> = {
  Minerais: { id: 'minerais', label: 'Minerais' },
  Árvores: { id: 'arvores', label: 'Árvores' },
  Ervas: { id: 'ervas', label: 'Ervas e plantas' },
  Outros: { id: 'outros', label: 'Outros' },
  Animais: { id: 'animais', label: 'Animais' },
  'Drops de animais': { id: 'drops_animais', label: 'Drops de animais' },
};

const withBase = (url: string) => `${import.meta.env.BASE_URL}${url.replace(/^\//, '')}`;

/** Nome PT-BR de um item do gerador ("Machado de Pedra", "Espada (base)"). */
export function genEntryName(familyLabel: string, variantId: string): string {
  if (variantId === 'default') return `${familyLabel} (base)`;
  const material = MATERIAL_LABELS[variantId];
  if (material) return `${familyLabel} de ${material}`;
  const custom = /^c([1-9][0-9]*)$/.exec(variantId);
  return custom ? `${familyLabel} (variação ${custom[1]})` : `${familyLabel} (${variantId})`;
}

function genSection(
  manifest: GeneratorManifest | null,
  category: string,
  sectionId: CraftSectionId,
  label: string,
  familyLabels: Record<string, string>,
): CraftCatalogSection {
  const families = manifest?.categories[category] ?? [];
  const entries: CraftCatalogEntry[] = [];
  for (const family of families) {
    for (const variant of family.variants) {
      entries.push({
        id: `gen:${category}/${family.id}/${variant.id}`,
        name: genEntryName(familyLabels[family.id] ?? family.id, variant.id),
        detail: `${family.id}/${variant.id}`,
        sectionId,
        thumb: {
          kind: 'sheet96',
          url: withBase(variant.url),
          col: BOW_LIKE_FAMILIES.has(family.id) ? BOW_THUMB_COL : DEFAULT_THUMB_COL,
        },
      });
    }
  }
  return { id: sectionId, label, entries };
}

export function buildCraftCatalog(
  manifest: GeneratorManifest | null,
  customItems: Readonly<Record<string, CraftItemConfig>>,
): CraftCatalog {
  const sections: CraftCatalogSection[] = [
    genSection(manifest, CRAFTTOOLS_CATEGORY, 'tools', 'Ferramentas', TOOL_FAMILY_LABELS),
    genSection(manifest, WEAPON_CATEGORY, 'weapons', 'Armas', WEAPON_FAMILY_LABELS),
  ];

  for (const group of RESOURCE_GROUPS) {
    const meta = GROUP_SECTIONS[group];
    // Nós que rendem OUTRO item (pedra de mão → Pedra comum) não são itens:
    // ficam fora do manual para nunca virarem ingrediente/alvo inatingível.
    const entries = RESOURCE_DEFINITIONS.filter(
      (def) => def.group === group && yieldItemKeyFor(def.key) === def.key,
    ).map(
      (def): CraftCatalogEntry => {
        const dropIcon = RESOURCE_DROP_ICONS[def.key];
        return {
          id: def.key,
          name: def.label,
          detail: def.key,
          sectionId: meta.id,
          thumb: dropIcon
            ? { kind: 'image', url: withBase(encodeURI(dropIcon)) }
            : {
                kind: 'frame',
                url: withBase(encodeURI(def.url)),
                frameWidth: def.frameWidth,
                frameHeight: def.frameHeight,
              },
        };
      },
    );
    sections.push({ id: meta.id, label: meta.label, entries });
  }

  const byId = new Map<string, CraftCatalogEntry>();
  for (const section of sections) {
    for (const entry of section.entries) byId.set(entry.id, entry);
  }

  // Itens criados por último (a linha "repara: X" precisa dos nomes gen:).
  // Estações portáteis embutidas podem faltar no mapa do servidor (persistência
  // fora do ar): entram sempre, com o ícone fixo do jogo.
  const allCustom: Record<string, CraftItemConfig> = { ...customItems };
  for (const def of PLACEABLE_STATIONS) {
    if (!allCustom[def.itemId]) allCustom[def.itemId] = { itemId: def.itemId, name: def.name, imageUrl: null, durability: def.defaultDurability };
  }
  const customEntries = Object.values(allCustom)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item): CraftCatalogEntry => {
      const repairs = item.repairsItemId ?? null;
      const placeable = placeableStationFor(item.itemId);
      return {
        id: item.itemId,
        name: item.name,
        detail: placeable
          ? `estação portátil · ${item.durability ?? placeable.defaultDurability} usos`
          : repairs ? `repara: ${byId.get(repairs)?.name ?? repairs}` : item.itemId,
        sectionId: 'custom',
        thumb: placeable
          ? { kind: 'image', url: withBase(encodeURI(placeable.iconUrl)) }
          : item.imageUrl ? { kind: 'image', url: item.imageUrl } : { kind: 'none' },
      };
    });
  const customSection: CraftCatalogSection = {
    id: 'custom',
    label: 'Itens criados',
    entries: customEntries,
  };
  sections.push(customSection);
  for (const entry of customEntries) byId.set(entry.id, entry);

  return { sections, byId };
}
