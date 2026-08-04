/**
 * Modal de criação de personagem — obrigatório e não-fechável enquanto o
 * jogador não tiver personagem salvo.
 *
 * Passo 1: escolha da classe (assassino / arqueiro / guerreiro / mago).
 * Passo 2: aparência — SOMENTE peças liberadas na categoria de assets
 * `default-character` (cabeça, camisa, calça, cabelo opcional) + tom de pele.
 *
 * Salvar → PUT /api/me/character → avisa a sala (character_ready) → o
 * servidor publica a receita no estado → a cena aplica (o modal some quando
 * o store recebe o personagem).
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatedPreview } from '../admin/character-generator/AnimatedPreview';
import { SpriteFrameThumb } from '../game/SpriteFrameThumb';
import { loadLayerCanvases, type LayerSpec, type LoadedLayer } from '../../lib/character-generator/compositor';
import { SKIN_TONES, getSkinTone } from '../../lib/character-generator/skinTones';
import { CATEGORY_LABELS, DIRECTIONS } from '../../lib/character-generator/constants';
import type { GeneratorFamily, GeneratorManifest } from '../../lib/character-generator/types';
import { getGeneratorManifest } from '../../game/characters/appearanceRuntime';
import {
  DEFAULT_CHARACTER_CATEGORY_ID,
  PLAYER_CLASS_IDS,
  PLAYER_CLASS_LABELS,
  type AppearanceLayerChoice,
  type CharacterAppearanceV1,
  type PlayerClassId,
} from '../../shared/characters/PlayerCharacterShapes';
import { fetchPublicAssetCategories, saveMyCharacter } from '../../lib/playerCharacterApi';
import { usePlayerCharacterStore } from '../../stores/playerCharacterStore';
import { RigApiError } from '../admin/rig-editor/rigApi';

const CLASS_META: Record<PlayerClassId, { icon: string; desc: string }> = {
  guerreiro: { icon: '🛡️', desc: 'Linha de frente: lança firme e postura sólida.' },
  assassino: { icon: '🗡️', desc: 'Lâmina veloz para golpes precisos.' },
  arqueiro: { icon: '🏹', desc: 'Domina o arco: acerta de longe.' },
  mago: { icon: '🔮', desc: 'Canaliza poder arcano no cajado.' },
};

type LayerKey = 'head' | 'top' | 'bottom' | 'hair';
const LAYER_KEYS: LayerKey[] = ['head', 'top', 'bottom', 'hair'];

interface AllowedFamily {
  familyId: string;
  /** Variantes liberadas (sempre ⊆ variantes do manifest). */
  variantIds: string[];
  family: GeneratorFamily;
}

const REF_RE = /^gen:([a-z]+)\/([^/]+?)(?:\/([^/]+))?$/;

/** Todas as variantes de uma família (default primeiro, sem duplicar). */
function familyVariantIds(family: GeneratorFamily): string[] {
  const ids = [family.default.id];
  for (const v of family.variants) if (!ids.includes(v.id)) ids.push(v.id);
  return ids;
}

/** Cruza os refs liberados da categoria com o manifest → famílias por camada. */
function buildAllowed(refs: string[], manifest: GeneratorManifest): Record<LayerKey, AllowedFamily[]> {
  const out: Record<LayerKey, AllowedFamily[]> = { head: [], top: [], bottom: [], hair: [] };
  const byKey = new Map<string, AllowedFamily>();
  for (const raw of refs) {
    const m = REF_RE.exec(raw.trim());
    if (!m) continue;
    const [, category, familyId, variantId] = m;
    if (!(LAYER_KEYS as string[]).includes(category)) continue;
    const family = manifest.categories[category]?.find((f) => f.id === familyId);
    if (!family) continue;
    const all = familyVariantIds(family);
    const key = `${category}/${familyId}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { familyId, variantIds: [], family };
      byKey.set(key, entry);
      out[category as LayerKey].push(entry);
    }
    if (!variantId) {
      entry.variantIds = all; // ref no nível da família = todas as variantes
    } else if (all.includes(variantId) && !entry.variantIds.includes(variantId)) {
      entry.variantIds.push(variantId);
    }
  }
  for (const k of LAYER_KEYS) out[k] = out[k].filter((e) => e.variantIds.length > 0);
  return out;
}

function variantUrl(family: GeneratorFamily, variantId: string): string | null {
  const v = family.variants.find((x) => x.id === variantId) ?? (family.default.id === variantId ? family.default : null);
  return v ? `${import.meta.env.BASE_URL}${v.url}` : null;
}

export function CharacterCreationModal() {
  const setCharacter = usePlayerCharacterStore((s) => s.setCharacter);
  const characterReadySender = usePlayerCharacterStore((s) => s.characterReadySender);

  const [step, setStep] = useState<1 | 2>(1);
  const [classId, setClassId] = useState<PlayerClassId | null>(null);

  const [manifest, setManifest] = useState<GeneratorManifest | null>(null);
  const [allowed, setAllowed] = useState<Record<LayerKey, AllowedFamily[]> | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loadTick, setLoadTick] = useState(0);

  const [tone, setTone] = useState('default');
  const [choice, setChoice] = useState<Record<LayerKey, AppearanceLayerChoice | null>>({
    head: null,
    top: null,
    bottom: null,
    hair: null,
  });
  const [dirIdx, setDirIdx] = useState(0);
  const [layers, setLayers] = useState<LoadedLayer[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveSql, setSaveSql] = useState<string | null>(null);

  // Catálogos (manifest + categoria default-character) — com retry manual.
  useEffect(() => {
    let cancelled = false;
    setLoadErr(null);
    Promise.all([getGeneratorManifest(), fetchPublicAssetCategories()])
      .then(([mf, categories]) => {
        if (cancelled) return;
        const cat = categories[DEFAULT_CHARACTER_CATEGORY_ID];
        if (!cat || cat.assetRefs.length === 0) {
          setLoadErr('A categoria "default-character" não tem peças liberadas. Avise um administrador.');
          return;
        }
        const alw = buildAllowed(cat.assetRefs, mf);
        if (alw.head.length === 0 || alw.top.length === 0 || alw.bottom.length === 0) {
          setLoadErr('Faltam peças obrigatórias (cabeça/camisa/calça) na categoria "default-character".');
          return;
        }
        setManifest(mf);
        setAllowed(alw);
        setChoice((prev) => ({
          head: prev.head ?? { familyId: alw.head[0].familyId, variantId: alw.head[0].variantIds[0] },
          top: prev.top ?? { familyId: alw.top[0].familyId, variantId: alw.top[0].variantIds[0] },
          bottom: prev.bottom ?? { familyId: alw.bottom[0].familyId, variantId: alw.bottom[0].variantIds[0] },
          hair: prev.hair ?? (alw.hair[0] ? { familyId: alw.hair[0].familyId, variantId: alw.hair[0].variantIds[0] } : null),
        }));
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [loadTick]);

  // Recompõe o preview quando escolha/tom mudam.
  const specs = useMemo<LayerSpec[]>(() => {
    if (!manifest || !allowed) return [];
    const list: LayerSpec[] = [];
    const shadow = manifest.categories['shadow']?.[0];
    if (shadow) list.push({ category: 'shadow', url: `${import.meta.env.BASE_URL}${shadow.default.url}` });
    // Ordem de desenho sul: calça → camisa → cabeça → cabelo (compositor
    // reordena internamente por direção).
    for (const key of ['bottom', 'top', 'head', 'hair'] as LayerKey[]) {
      const c = choice[key];
      if (!c) continue;
      const fam = allowed[key].find((f) => f.familyId === c.familyId)?.family;
      if (!fam) continue;
      const url = variantUrl(fam, c.variantId);
      if (url) list.push({ category: key, url });
    }
    return list;
  }, [manifest, allowed, choice]);

  useEffect(() => {
    let cancelled = false;
    if (specs.length === 0) {
      setLayers([]);
      return;
    }
    loadLayerCanvases(specs, getSkinTone(tone)).then((result) => {
      if (!cancelled) setLayers(result.layers);
    });
    return () => {
      cancelled = true;
    };
  }, [specs, tone]);

  const pickFamily = (key: LayerKey, fam: AllowedFamily | null) => {
    setChoice((prev) => ({
      ...prev,
      [key]: fam ? { familyId: fam.familyId, variantId: fam.variantIds[0] } : null,
    }));
  };

  const pickVariant = (key: LayerKey, variantId: string) => {
    setChoice((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key]!, variantId } } : prev));
  };

  const randomize = () => {
    if (!allowed) return;
    const rnd = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
    const pick = (fams: AllowedFamily[]): AppearanceLayerChoice => {
      const f = rnd(fams);
      return { familyId: f.familyId, variantId: rnd(f.variantIds) };
    };
    setChoice({
      head: pick(allowed.head),
      top: pick(allowed.top),
      bottom: pick(allowed.bottom),
      hair: allowed.hair.length > 0 ? pick(allowed.hair) : null,
    });
    setTone(SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)].id);
  };

  const save = async () => {
    if (!classId || !choice.head || !choice.top || !choice.bottom || saving) return;
    setSaving(true);
    setSaveErr(null);
    setSaveSql(null);
    try {
      const appearance: CharacterAppearanceV1 = {
        v: 1,
        skinTone: tone,
        layers: { head: choice.head, top: choice.top, bottom: choice.bottom, hair: choice.hair },
      };
      const res = await saveMyCharacter(classId, appearance);
      characterReadySender?.(); // sala ao vivo: recarrega a receita do banco
      setCharacter(res.character); // fecha o modal (gate no GameCanvas)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
      if (e instanceof RigApiError) {
        const sql = (e as RigApiError & { tableSql?: string }).tableSql;
        if (sql) setSaveSql(sql);
      }
      setSaving(false);
    }
  };

  const dir = DIRECTIONS[dirIdx];

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 p-3">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-lg border-4 border-[#8a5a2b] bg-[#2b1c10] shadow-[0_0_60px_rgba(0,0,0,0.9)]">
        <div className="sticky top-0 z-10 border-b-2 border-[#8a5a2b] bg-[#3a2817] px-4 py-3 text-center">
          <h2 className="text-lg font-bold uppercase tracking-[0.2em] text-amber-300">Crie seu personagem</h2>
          <p className="mt-0.5 text-xs text-amber-100/70">
            {step === 1 ? 'Escolha sua classe para começar' : 'Monte sua aparência'}
          </p>
        </div>

        <div className="p-4">
          {step === 1 && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {PLAYER_CLASS_IDS.map((id) => {
                  const meta = CLASS_META[id];
                  const selected = classId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setClassId(id)}
                      className={`flex items-start gap-3 rounded-md border-2 p-3 text-left transition-colors ${
                        selected
                          ? 'border-amber-400 bg-amber-900/40'
                          : 'border-[#6b4a26] bg-black/20 hover:border-amber-700 hover:bg-black/30'
                      }`}
                    >
                      <span className="text-3xl leading-none">{meta.icon}</span>
                      <span>
                        <span className="block font-bold uppercase tracking-wider text-amber-200">
                          {PLAYER_CLASS_LABELS[id]}
                        </span>
                        <span className="mt-0.5 block text-xs text-amber-100/70">{meta.desc}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={!classId}
                  onClick={() => setStep(2)}
                  className="rounded-md border-2 border-amber-500 bg-amber-600 px-5 py-2 font-bold uppercase tracking-wider text-black transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:border-[#6b4a26] disabled:bg-black/20 disabled:text-amber-100/40"
                >
                  Continuar →
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {loadErr && (
                <div className="rounded-md border-2 border-red-800 bg-red-950/60 p-3 text-sm text-red-200">
                  {loadErr}
                  <button
                    type="button"
                    onClick={() => setLoadTick((t) => t + 1)}
                    className="ml-2 underline hover:text-red-100"
                  >
                    Tentar de novo
                  </button>
                </div>
              )}

              {!loadErr && !allowed && (
                <p className="py-10 text-center text-sm text-amber-100/70">Carregando peças…</p>
              )}

              {allowed && (
                <div className="flex flex-col gap-4 md:flex-row">
                  {/* Preview + tom de pele */}
                  <div className="flex shrink-0 flex-col items-center gap-2 md:w-52">
                    {layers.length > 0 ? (
                      <AnimatedPreview layers={layers} animId="walk" dirId={dir.id} size={160} />
                    ) : (
                      <div className="flex h-40 w-40 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-xs text-amber-100/50">
                        Compondo…
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setDirIdx((i) => (i + 1) % DIRECTIONS.length)}
                      className="rounded border border-[#6b4a26] bg-black/30 px-3 py-1 text-xs text-amber-100/90 hover:border-amber-600"
                    >
                      ↻ Girar ({dir.label})
                    </button>
                    <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                      {SKIN_TONES.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          title={t.label}
                          onClick={() => setTone(t.id)}
                          className={`h-7 w-7 rounded-full border-2 ${
                            tone === t.id ? 'border-amber-300 ring-2 ring-amber-400/60' : 'border-black/60'
                          }`}
                          style={{ backgroundColor: t.swatch }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Seleção de peças */}
                  <div className="min-w-0 flex-1 space-y-3">
                    {LAYER_KEYS.map((key) => {
                      const fams = allowed[key];
                      if (fams.length === 0 && key !== 'hair') return null;
                      const current = choice[key];
                      const currentFam = current ? fams.find((f) => f.familyId === current.familyId) : null;
                      return (
                        <div key={key}>
                          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-amber-200/90">
                            {CATEGORY_LABELS[key] ?? key}
                            {key === 'hair' && <span className="font-normal text-amber-100/50"> (opcional)</span>}
                          </p>
                          <div className="flex gap-1.5 overflow-x-auto pb-1">
                            {key === 'hair' && (
                              <button
                                type="button"
                                onClick={() => pickFamily('hair', null)}
                                title="Sem cabelo"
                                className={`flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded border-2 text-lg ${
                                  current === null
                                    ? 'border-amber-400 bg-amber-900/40'
                                    : 'border-[#6b4a26] bg-black/30 hover:border-amber-700'
                                }`}
                              >
                                🚫
                              </button>
                            )}
                            {fams.map((f) => {
                              const url = variantUrl(f.family, f.variantIds[0]);
                              const selected = current?.familyId === f.familyId;
                              return (
                                <button
                                  key={f.familyId}
                                  type="button"
                                  title={f.familyId}
                                  onClick={() => pickFamily(key, f)}
                                  className={`shrink-0 rounded border-2 ${
                                    selected
                                      ? 'border-amber-400 bg-amber-900/40'
                                      : 'border-[#6b4a26] bg-black/30 hover:border-amber-700'
                                  }`}
                                >
                                  {url && <SpriteFrameThumb url={url} size={48} />}
                                </button>
                              );
                            })}
                          </div>
                          {currentFam && currentFam.variantIds.length > 1 && (
                            <div className="mt-1 flex gap-1 overflow-x-auto pb-1">
                              {currentFam.variantIds.map((vid) => {
                                const url = variantUrl(currentFam.family, vid);
                                const selected = current?.variantId === vid;
                                return (
                                  <button
                                    key={vid}
                                    type="button"
                                    title={vid}
                                    onClick={() => pickVariant(key, vid)}
                                    className={`shrink-0 rounded border ${
                                      selected
                                        ? 'border-amber-400 bg-amber-900/40'
                                        : 'border-[#6b4a26]/70 bg-black/20 hover:border-amber-700'
                                    }`}
                                  >
                                    {url && <SpriteFrameThumb url={url} size={38} />}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-md border-2 border-[#6b4a26] bg-black/20 px-4 py-2 text-sm text-amber-100/90 hover:border-amber-700"
                >
                  ← Classe
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={randomize}
                    disabled={!allowed}
                    className="rounded-md border-2 border-[#6b4a26] bg-black/20 px-4 py-2 text-sm text-amber-100/90 hover:border-amber-700 disabled:opacity-50"
                  >
                    🎲 Aleatório
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={!allowed || saving || !classId}
                    className="rounded-md border-2 border-amber-500 bg-amber-600 px-5 py-2 font-bold uppercase tracking-wider text-black hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? 'Criando…' : 'Criar personagem'}
                  </button>
                </div>
              </div>

              {saveErr && (
                <div className="mt-3 rounded-md border-2 border-red-800 bg-red-950/60 p-3 text-sm text-red-200">
                  {saveErr}
                  {saveSql && (
                    <textarea
                      readOnly
                      value={saveSql}
                      onFocus={(e) => e.currentTarget.select()}
                      className="mt-2 h-28 w-full rounded bg-black/60 p-2 font-mono text-[11px] text-red-100"
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
