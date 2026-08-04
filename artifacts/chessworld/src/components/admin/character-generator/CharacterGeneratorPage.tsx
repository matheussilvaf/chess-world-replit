/**
 * /admin/character-generator — dev/test tool.
 *
 * Composes modular character spritesheets from public/character-generator/assets:
 * layer selection per category, colour variants, real-time skin tones, animated
 * preview, full-sheet preview and PNG export. No server/database writes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Download, RotateCcw, Shuffle, Wand2 } from 'lucide-react';

import {
  ANIMATIONS,
  DIRECTIONS,
  CATEGORY_LABELS,
  LAYER_ORDER,
  FRAME_WIDTH,
  FRAME_HEIGHT,
  SHEET_WIDTH,
  SHEET_HEIGHT,
  SHEET_ROWS,
  SHEET_COLS,
  type AnimationId,
  type DirectionId,
} from '../../../lib/character-generator/constants';
import { SKIN_TONES, getSkinTone } from '../../../lib/character-generator/skinTones';
import { fetchGeneratorManifest } from '../../../lib/character-generator/manifest';
import {
  loadLayerCanvases,
  composeSheet,
  type LayerSpec,
  type LoadedLayer,
} from '../../../lib/character-generator/compositor';
import { downloadCanvasPng } from '../../../lib/character-generator/download';
import type { GeneratorManifest, GeneratorSelection } from '../../../lib/character-generator/types';
import { CategoryRow } from './CategoryRow';
import { AnimatedPreview } from './AnimatedPreview';
import { SheetPreview } from './SheetPreview';

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
      visible: true, // shadow included — visible by default
    };
  }
  return selection;
}

export function CharacterGeneratorPage() {
  // The game forces overflow:hidden on html/body/#root. Override it here so
  // this page scrolls normally, and restore on unmount (same as AdminPage).
  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')].filter(
      Boolean,
    ) as HTMLElement[];
    const prev = els.map((el) => el.style.overflow);
    els.forEach((el) => {
      el.style.overflow = 'auto';
    });
    return () => {
      els.forEach((el, i) => {
        el.style.overflow = prev[i];
      });
    };
  }, []);

  const [manifest, setManifest] = useState<GeneratorManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [selection, setSelection] = useState<GeneratorSelection>({});
  const [toneId, setToneId] = useState('default');
  const [animId, setAnimId] = useState<AnimationId>('walk');
  const [dirId, setDirId] = useState<DirectionId>('south');
  const [layers, setLayers] = useState<LoadedLayer[]>([]);
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchGeneratorManifest()
      .then((m) => {
        if (cancelled) return;
        setManifest(m);
        setSelection(buildInitialSelection(m));
      })
      .catch((e) => {
        if (!cancelled) setManifestError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Categories in draw order first; unknown extra folders appended at the end. */
  const orderedCategories = useMemo(() => {
    if (!manifest) return [] as string[];
    const known = LAYER_ORDER.filter((c) => c in manifest.categories) as string[];
    const extras = Object.keys(manifest.categories)
      .filter((c) => !(LAYER_ORDER as readonly string[]).includes(c))
      .sort();
    return [...known, ...extras];
  }, [manifest]);

  /** Visible, resolved layer URLs in draw order. */
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

  // Load + recolour the selected sheets whenever selection or skin tone changes.
  useEffect(() => {
    let cancelled = false;
    if (layerSpecs.length === 0) {
      setLayers([]);
      setFailedUrls([]);
      return;
    }
    loadLayerCanvases(layerSpecs, getSkinTone(toneId)).then((result) => {
      if (cancelled) return;
      setLayers(result.layers);
      setFailedUrls(result.failed);
    });
    return () => {
      cancelled = true;
    };
  }, [layerSpecs, toneId]);

  const patchCategory = useCallback(
    (category: string, patch: Partial<GeneratorSelection[string]>) => {
      setSelection((prev) => ({ ...prev, [category]: { ...prev[category], ...patch } }));
    },
    [],
  );

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
        next[category] = {
          familyId: family.id,
          variantId: variant.id,
          visible: current?.visible ?? true,
        };
      }
      return next;
    });
    setToneId(pickRandom(SKIN_TONES).id);
  }, [manifest]);

  const handleReset = useCallback(() => {
    if (!manifest) return;
    setSelection(buildInitialSelection(manifest));
    setToneId('default');
    setAnimId('walk');
    setDirId('south');
  }, [manifest]);

  const handleSave = useCallback(async () => {
    if (layers.length === 0) return;
    setSaving(true);
    try {
      const sheet = composeSheet(layers);
      await downloadCanvasPng(sheet, 'character-generator-preview.png');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha ao exportar o PNG.');
    } finally {
      setSaving(false);
    }
  }, [layers]);

  const btn =
    'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40 disabled:pointer-events-none';

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-[1500px] mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Link
            to="/admin"
            className="p-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700"
            title="Voltar ao Admin"
          >
            <ArrowLeft size={18} />
          </Link>
          <Wand2 size={22} className="text-cyan-400" />
          <div>
            <h1 className="text-xl font-bold leading-tight">Character Generator</h1>
            <p className="text-xs text-slate-400">
              Ferramenta de teste — montagem modular de spritesheets (nada é salvo no servidor)
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-[11px] font-mono text-slate-400">
            <span className="px-2 py-1 rounded bg-slate-800 border border-slate-700">
              sheet {SHEET_WIDTH}×{SHEET_HEIGHT}
            </span>
            <span className="px-2 py-1 rounded bg-slate-800 border border-slate-700">
              frame {FRAME_WIDTH}×{FRAME_HEIGHT}
            </span>
            <span className="px-2 py-1 rounded bg-slate-800 border border-slate-700">
              {SHEET_ROWS} linhas × {SHEET_COLS} colunas
            </span>
          </div>
        </div>

        {manifestError && (
          <div className="mb-6 rounded-lg border border-red-700 bg-red-950/60 px-4 py-3 text-sm text-red-200">
            <p className="font-semibold mb-1">Erro ao carregar os assets</p>
            <p className="font-mono text-xs break-all">{manifestError}</p>
          </div>
        )}

        {!manifest && !manifestError && (
          <p className="text-slate-400 text-sm">Carregando manifest dos assets…</p>
        )}

        {manifest && (
          <>
            <div className="grid gap-6 lg:grid-cols-[400px_minmax(0,1fr)] items-start">
              {/* A) Layer/category selection panel */}
              <section className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 divide-y divide-slate-800">
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
              </section>

              {/* B) Animated preview + C) global controls */}
              <section className="flex flex-col gap-4">
                <div className="flex justify-center">
                  <AnimatedPreview layers={layers} animId={animId} dirId={dirId} />
                </div>

                {failedUrls.length > 0 && (
                  <div className="rounded-lg border border-amber-700 bg-amber-950/50 px-4 py-3 text-xs text-amber-200">
                    <p className="flex items-center gap-2 font-semibold mb-1">
                      <AlertTriangle size={14} /> {failedUrls.length} imagem(ns) falharam ao carregar
                    </p>
                    <ul className="list-disc pl-5 space-y-0.5 font-mono break-all">
                      {failedUrls.map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col gap-4">
                  {/* Direction */}
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Direção</p>
                    <div className="flex flex-wrap gap-2">
                      {DIRECTIONS.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setDirId(d.id)}
                          className={`${btn} ${
                            dirId === d.id
                              ? 'border-cyan-500 bg-cyan-500/15 text-cyan-300'
                              : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Animation */}
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Animação</p>
                    <select
                      value={animId}
                      onChange={(e) => setAnimId(e.target.value as AnimationId)}
                      className="w-full max-w-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                    >
                      {ANIMATIONS.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Skin tone */}
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Tom de pele</p>
                    <div className="flex flex-wrap gap-2">
                      {SKIN_TONES.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          title={t.label}
                          onClick={() => setToneId(t.id)}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                            toneId === t.id
                              ? 'border-cyan-500 bg-cyan-500/15 text-cyan-200'
                              : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          <span
                            className="inline-block w-4 h-4 rounded-full border border-black/40"
                            style={{ backgroundColor: t.swatch }}
                          />
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={handleRandom}
                      className={`${btn} border-purple-600 bg-purple-600/15 text-purple-300 hover:bg-purple-600/25 mt-3`}
                    >
                      <Shuffle size={15} /> Random
                    </button>
                    <button
                      type="button"
                      onClick={handleReset}
                      className={`${btn} border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 mt-3`}
                    >
                      <RotateCcw size={15} /> Reset
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving || layers.length === 0}
                      className={`${btn} border-emerald-600 bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/25 mt-3 ml-auto`}
                    >
                      <Download size={15} /> {saving ? 'Gerando…' : 'Save (baixar PNG)'}
                    </button>
                  </div>
                </div>
              </section>
            </div>

            {/* Full spritesheet preview */}
            <section className="mt-6">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-sm font-semibold text-slate-300">Spritesheet final completa</h2>
                <span className="text-[11px] font-mono text-slate-500">
                  {SHEET_WIDTH} × {SHEET_HEIGHT} px • fundo transparente no PNG exportado
                </span>
              </div>
              <SheetPreview layers={layers} />
            </section>

            {manifest.warnings.length > 0 && (
              <details className="mt-6 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs text-slate-400">
                <summary className="cursor-pointer select-none text-slate-300">
                  {manifest.warnings.length} aviso(s) do scanner de assets
                </summary>
                <ul className="mt-2 list-disc pl-5 space-y-0.5 font-mono break-all">
                  {manifest.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
