/**
 * Character Generator — shared client types.
 *
 * The manifest shapes mirror what the Vite plugin emits
 * (vite-plugins/character-generator-manifest.ts) — keep them in sync.
 */

export interface GeneratorVariant {
  id: string; // "default" | "c1" | "c2" | ... | "wood" | "stone" | ...
  file: string;
  /** URL relative to the app base path (prepend import.meta.env.BASE_URL). */
  url: string;
}

export interface GeneratorFamily {
  id: string;
  default: GeneratorVariant;
  /** Default first, then materials in canonical order, then c1, c2, ... */
  variants: GeneratorVariant[];
  /** Subfolder the family came from (families sharing a group belong together). */
  group?: string;
}

export interface GeneratorManifest {
  generatedAt: string;
  sheet: { width: number; height: number; rows: number; cols: number };
  frame: { width: number; height: number };
  categories: Record<string, GeneratorFamily[]>;
  warnings: string[];
}

/** Per-category selection state. */
export interface CategorySelection {
  /** null when the category has no items. */
  familyId: string | null;
  variantId: string;
  visible: boolean;
}

export type GeneratorSelection = Record<string, CategorySelection>;
