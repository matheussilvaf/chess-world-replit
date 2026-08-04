/**
 * Preview appearance panel (spec §4): reuses the Character Generator manifest,
 * recolor and compositor so the rig editor previews REAL generated characters
 * (no dependency on public/assets/characters).
 *
 * STRICTLY COSMETIC — changing appearance only swaps the composed sheet used
 * as background; it never touches origin/body/boxes. "Salvar receita" hands
 * the recipe to the page, which stores it in rig.previewAppearance on save.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dices, RotateCcw, Save } from 'lucide-react';
import type {
  GeneratorManifest,
  GeneratorSelection,
} from '../../../lib/character-generator/types';
import {
  CATEGORY_LABELS,
  LAYER_ORDER,
} from '../../../lib/character-generator/constants';
import { SKIN_TONES, getSkinTone } from '../../../lib/character-generator/skinTones';
import { fetchGeneratorManifest } from '../../../lib/character-generator/manifest';
import {
  composeSheet,
  loadLayerCanvases,
  type LayerSpec,
} from '../../../lib/character-generator/compositor';
import { CategoryRow } from '../character-generator/CategoryRow';
import type { PreviewAppearanceRecipe } from '../../../shared/combat/RigShapes';

function pickRandom<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function buildInitialSelection(manifest: GeneratorManifest): GeneratorSelection {
  const selection: GeneratorSelection = {};
  for (const [category, families] of Object.entries(manifest.categories)) {
    const first = families[0] ?? null;
    selection[category] = {
      familyId: first?.id ?? null,
      variantId: first?.default.id ?? 'default',
      visible: true,
    };
  }
  return selection;
}

/** Recipe asset id: family id for the default variant, `${family}_${variant}` otherwise. */
function assetIdFor(familyId: string, variantId: string): string {
  return variantId === 'default' ? familyId : `${familyId}_${variantId}`;
}

/** Apply a stored recipe on top of the manifest (absent category = hidden). */
function selectionFromRecipe(manifest: GeneratorManifest, recipe: PreviewAppearanceRecipe): GeneratorSelection {
  const selection = buildInitialSelection(manifest);
  const hasEntries = Object.keys(recipe).some((k) => k !== 'skinTone');
  if (!hasEntries) return selection;

  for (const [category, families] of Object.entries(manifest.categories)) {
    const sel = selection[category];
    const value = recipe[category];
    if (!value) {
      sel.visible = false;
      continue;
    }
    sel.visible = true;
    const direct = families.find((f) => f.id === value);
    if (direct) {
      sel.familyId = direct.id;
      sel.variantId = 'default';
      continue;
    }
    const m = /^(.+)_(c\d+)$/.exec(value);
    if (m) {
      const family = families.find((f) => f.id === m[1]);
      if (family && family.variants.some((v) => v.id === m[2])) {
        sel.familyId = family.id;
        sel.variantId = m[2];
        continue;
      }
    }
    // Unknown asset id → keep defaults but stay visible (asset may have been renamed).
  }
  return selection;
}

interface AppearancePanelProps {
  /** Recipe stored in the rig (cosmetic only). */
  recipe: PreviewAppearanceRecipe;
  /** Key that forces re-initialisation when another rig is selected. */
  rigId: string;
  onSaveRecipe: (recipe: PreviewAppearanceRecipe) => void;
  /** Fired whenever the composed 2208×384 sheet changes (or fails → null). */
  onSheetChange: (sheet: HTMLCanvasElement | null) => void;
}

export function AppearancePanel({ recipe, rigId, onSaveRecipe, onSheetChange }: AppearancePanelProps) {
  const [manifest, setManifest] = useState<GeneratorManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [selection, setSelection] = useState<GeneratorSelection>({});
  const [toneId, setToneId] = useState('default');
  const [failedUrls, setFailedUrls] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchGeneratorManifest()
      .then((m) => {
        if (cancelled) return;
        setManifest(m);
      })
      .catch((e) => {
        if (!cancelled) setManifestError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // (Re)initialise from the rig's stored recipe when the manifest arrives or
  // the selected rig changes.
  useEffect(() => {
    if (!manifest) return;
    setSelection(selectionFromRecipe(manifest, recipe));
    setToneId(typeof recipe.skinTone === 'string' ? recipe.skinTone : 'default');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, rigId]);

  const orderedCategories = useMemo(() => {
    if (!manifest) return [] as string[];
    const known = LAYER_ORDER.filter((c) => c in manifest.categories) as string[];
    const extras = Object.keys(manifest.categories)
      .filter((c) => !(LAYER_ORDER as readonly string[]).includes(c))
      .sort();
    return [...known, ...extras];
  }, [manifest]);

  const layerSpecs = useMemo<LayerSpec[]>(() => {
    if (!manifest) return [];
    const base = import.meta.env.BASE_URL;
    const specs: LayerSpec[] = [];
    for (const category of orderedCategories) {
      const sel = selection[category];
      if (!sel?.visible || !sel.familyId) continue;
      const family = manifest.categories[category]?.find((f) => f.id === sel.familyId);
      if (!family) continue;
      const variant = family.variants.find((v) => v.id === sel.variantId) ?? family.default;
      specs.push({ category, url: `${base}${variant.url}` });
    }
    return specs;
  }, [manifest, orderedCategories, selection]);

  // Compose the full sheet whenever the appearance changes.
  useEffect(() => {
    let cancelled = false;
    if (layerSpecs.length === 0) {
      setFailedUrls([]);
      onSheetChange(null);
      return;
    }
    loadLayerCanvases(layerSpecs, getSkinTone(toneId)).then((result) => {
      if (cancelled) return;
      setFailedUrls(result.failed);
      onSheetChange(result.layers.length > 0 ? composeSheet(result.layers) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [layerSpecs, toneId, onSheetChange]);

  const patchCategory = useCallback((category: string, patch: Partial<GeneratorSelection[string]>) => {
    setSelection((prev) => ({ ...prev, [category]: { ...prev[category], ...patch } }));
  }, []);

  const handleRandom = useCallback(() => {
    if (!manifest) return;
    setSelection((prev) => {
      const next: GeneratorSelection = {};
      for (const [category, families] of Object.entries(manifest.categories)) {
        const current = prev[category];
        if (families.length === 0) {
          next[category] = { familyId: null, variantId: 'default', visible: current?.visible ?? true };
          continue;
        }
        const family = pickRandom(families);
        const variant = pickRandom(family.variants);
        next[category] = { familyId: family.id, variantId: variant.id, visible: current?.visible ?? true };
      }
      return next;
    });
    setToneId(pickRandom(SKIN_TONES).id);
  }, [manifest]);

  const handleReset = useCallback(() => {
    if (!manifest) return;
    setSelection(buildInitialSelection(manifest));
    setToneId('default');
  }, [manifest]);

  const currentRecipe = useCallback((): PreviewAppearanceRecipe => {
    const result: PreviewAppearanceRecipe = {};
    for (const [category, sel] of Object.entries(selection)) {
      if (!sel.visible || !sel.familyId) continue;
      result[category] = assetIdFor(sel.familyId, sel.variantId);
    }
    result.skinTone = toneId;
    return result;
  }, [selection, toneId]);

  const btn =
    'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none';

  if (manifestError) {
    return (
      <div className="border border-red-900 bg-red-950/40 rounded-lg p-3 text-xs text-red-300">
        Falha ao carregar o manifest do gerador: {manifestError}
      </div>
    );
  }
  if (!manifest) {
    return <div className="text-xs text-slate-500 p-3">Carregando assets do gerador…</div>;
  }

  return (
    <div className="border border-slate-800 rounded-lg bg-slate-900/60">
      <div className="flex items-center justify-between px-3 pt-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
            Aparência do preview
          </div>
          <p className="text-[10px] text-slate-600 mt-0.5">
            Somente cosmético — nunca altera origin, corpo ou caixas.
          </p>
        </div>
      </div>

      <div className="px-3 divide-y divide-slate-800/70">
        {orderedCategories.map((category) => {
          const sel = selection[category];
          if (!sel) return null;
          return (
            <CategoryRow
              key={category}
              categoryKey={category}
              label={CATEGORY_LABELS[category] ?? category}
              families={manifest.categories[category] ?? []}
              selection={sel}
              onChange={(patch) => patchCategory(category, patch)}
            />
          );
        })}
      </div>

      {/* Skin tones */}
      <div className="px-3 py-2.5 border-t border-slate-800/70">
        <div className="text-[10px] text-slate-500 mb-1.5">Tom de pele</div>
        <div className="flex flex-wrap gap-1.5">
          {SKIN_TONES.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              onClick={() => setToneId(t.id)}
              className={`w-6 h-6 rounded-full border-2 ${
                toneId === t.id ? 'border-white' : 'border-slate-700 hover:border-slate-500'
              }`}
              style={{ backgroundColor: t.swatch }}
            />
          ))}
        </div>
      </div>

      {failedUrls.length > 0 && (
        <div className="mx-3 mb-2 border border-amber-900 bg-amber-950/40 rounded p-2 text-[10px] text-amber-300">
          {failedUrls.length} camada(s) falharam ao carregar.
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 px-3 pb-3 pt-1">
        <button type="button" onClick={handleRandom} className={`${btn} border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`}>
          <Dices size={13} /> Random
        </button>
        <button type="button" onClick={handleReset} className={`${btn} border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`}>
          <RotateCcw size={13} /> Reset
        </button>
        <button
          type="button"
          onClick={() => onSaveRecipe(currentRecipe())}
          className={`${btn} border-sky-700 bg-sky-900/40 text-sky-200 hover:bg-sky-800/40`}
          title="Guarda esta aparência no rig (persistida no próximo Salvar)"
        >
          <Save size={13} /> Salvar receita de preview
        </button>
      </div>
    </div>
  );
}
