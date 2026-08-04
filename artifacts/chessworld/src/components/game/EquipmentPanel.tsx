/**
 * Painel de EQUIPAMENTO (estilo RPG pixelado, como a referência do usuário).
 *
 * Grade 4×4 de slots; hoje só o slot da arma da classe é funcional — as
 * demais casas ficam vazias para o futuro. Clicar no slot (ou no botão)
 * equipa/desequipa EM TEMPO REAL via `equip_weapon` (o servidor decide a
 * arma pela classe e publica no estado; a textura troca quando o estado
 * volta). Desktop: cartão à direita. Mobile: folha inferior.
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatedPreview } from '../admin/character-generator/AnimatedPreview';
import { SpriteFrameThumb } from './SpriteFrameThumb';
import { loadLayerCanvases, type LayerSpec, type LoadedLayer } from '../../lib/character-generator/compositor';
import { getSkinTone } from '../../lib/character-generator/skinTones';
import type { GeneratorManifest } from '../../lib/character-generator/types';
import { getGeneratorManifest } from '../../game/characters/appearanceRuntime';
import { fetchPublicAssetCategories } from '../../lib/playerCharacterApi';
import {
  PLAYER_CLASS_LABELS,
  WEAPON_REF_RE,
  findClassWeaponRef,
} from '../../shared/characters/PlayerCharacterShapes';
import { usePlayerCharacterStore } from '../../stores/playerCharacterStore';
import { useAuthStore } from '../../stores/authStore';

/** Nome amigável da arma padrão de cada classe. */
const WEAPON_NAMES: Record<string, string> = {
  guerreiro: 'Lança',
  assassino: 'Espada',
  arqueiro: 'Arco',
  mago: 'Cajado',
};

const SLOT_COUNT = 16;

export function EquipmentButton() {
  const character = usePlayerCharacterStore((s) => s.character);
  const panelOpen = usePlayerCharacterStore((s) => s.panelOpen);
  const setPanelOpen = usePlayerCharacterStore((s) => s.setPanelOpen);
  if (!character) return null;
  return (
    <button
      type="button"
      title="Equipamento"
      onClick={() => setPanelOpen(!panelOpen)}
      className="fixed bottom-3 right-3 z-[120] flex h-12 w-12 items-center justify-center rounded-md border-2 border-[#8a5a2b] bg-[#2b1c10]/95 text-2xl shadow-lg transition-colors hover:border-amber-500"
    >
      🎒
    </button>
  );
}

export function EquipmentPanel() {
  const character = usePlayerCharacterStore((s) => s.character);
  const panelOpen = usePlayerCharacterStore((s) => s.panelOpen);
  const setPanelOpen = usePlayerCharacterStore((s) => s.setPanelOpen);
  const liveWeapon = usePlayerCharacterStore((s) => s.liveWeapon);
  const equipSender = usePlayerCharacterStore((s) => s.equipSender);
  const profile = useAuthStore((s) => s.profile);

  const [manifest, setManifest] = useState<GeneratorManifest | null>(null);
  const [classWeaponRef, setClassWeaponRef] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [layers, setLayers] = useState<LoadedLayer[]>([]);

  // Catálogos ao abrir (cacheados por módulo — só a 1ª abertura custa rede).
  useEffect(() => {
    if (!panelOpen || !character) return;
    let cancelled = false;
    setLoadErr(null);
    Promise.all([getGeneratorManifest(), fetchPublicAssetCategories()])
      .then(([mf, categories]) => {
        if (cancelled) return;
        setManifest(mf);
        setClassWeaponRef(findClassWeaponRef(categories, character.classId));
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [panelOpen, character]);

  // Preview do próprio personagem (parado, de frente).
  const previewSpecs = useMemo<LayerSpec[]>(() => {
    if (!panelOpen || !manifest || !character) return [];
    const base = import.meta.env.BASE_URL;
    const list: LayerSpec[] = [];
    const shadow = manifest.categories['shadow']?.[0];
    if (shadow) list.push({ category: 'shadow', url: `${base}${shadow.default.url}` });
    const order = ['bottom', 'top', 'head', 'hair'] as const;
    for (const key of order) {
      const c = character.appearance.layers[key];
      if (!c) continue;
      const fam = manifest.categories[key]?.find((f) => f.id === c.familyId);
      if (!fam) continue;
      const v = fam.variants.find((x) => x.id === c.variantId) ?? fam.default;
      list.push({ category: key, url: `${base}${v.url}` });
    }
    return list;
  }, [panelOpen, manifest, character]);

  useEffect(() => {
    let cancelled = false;
    if (previewSpecs.length === 0 || !character) {
      setLayers([]);
      return;
    }
    loadLayerCanvases(previewSpecs, getSkinTone(character.appearance.skinTone)).then((r) => {
      if (!cancelled) setLayers(r.layers);
    });
    return () => {
      cancelled = true;
    };
  }, [previewSpecs, character]);

  /** URL da folha da arma da classe (para a miniatura do slot). */
  const weaponSheetUrl = useMemo(() => {
    if (!manifest || !classWeaponRef) return null;
    const m = WEAPON_REF_RE.exec(classWeaponRef);
    if (!m) return null;
    const [, familyId, variantId] = m;
    const fam = manifest.categories['weapon']?.find((f) => f.id === familyId);
    if (!fam) return null;
    const v = fam.variants.find((x) => x.id === variantId) ?? fam.default;
    return `${import.meta.env.BASE_URL}${v.url}`;
  }, [manifest, classWeaponRef]);

  if (!character || !panelOpen) return null;

  const equipped = liveWeapon !== '';
  const weaponName = WEAPON_NAMES[character.classId] ?? 'Arma';
  const canEquip = !!equipSender && !!classWeaponRef;

  const toggleEquip = () => {
    if (!canEquip) return;
    equipSender!(!equipped);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[150] max-h-[70vh] w-full overflow-y-auto rounded-t-xl border-4 border-b-0 border-[#8a5a2b] bg-[#2b1c10] shadow-[0_0_50px_rgba(0,0,0,0.85)] md:inset-x-auto md:bottom-[70px] md:right-3 md:w-[360px] md:rounded-lg md:border-b-4">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b-2 border-[#8a5a2b] bg-[#3a2817] px-4 py-2.5">
        <h3 className="text-sm font-bold uppercase tracking-[0.25em] text-amber-300">Equipamento</h3>
        <button
          type="button"
          aria-label="Fechar"
          onClick={() => setPanelOpen(false)}
          className="rounded px-1.5 text-lg leading-none text-amber-200/80 hover:text-amber-100"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        {/* Personagem */}
        <div className="flex shrink-0 flex-col items-center gap-1 sm:w-36">
          {layers.length > 0 ? (
            <AnimatedPreview layers={layers} animId="stand" dirId="south" size={112} />
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-[11px] text-amber-100/50">
              …
            </div>
          )}
          <p className="max-w-full truncate text-sm font-bold text-amber-100">
            {profile?.username ?? 'Jogador'}
          </p>
          <p className="rounded border border-[#6b4a26] bg-black/30 px-2 py-0.5 text-[11px] uppercase tracking-wider text-amber-200/90">
            {PLAYER_CLASS_LABELS[character.classId]}
          </p>
        </div>

        {/* Slots */}
        <div className="min-w-0 flex-1">
          {loadErr && (
            <p className="mb-2 rounded border-2 border-red-800 bg-red-950/60 p-2 text-xs text-red-200">{loadErr}</p>
          )}
          <div className="grid grid-cols-4 gap-1.5">
            {Array.from({ length: SLOT_COUNT }, (_, i) => {
              if (i === 0) {
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={!canEquip}
                    onClick={toggleEquip}
                    title={`${weaponName} — clique para ${equipped ? 'remover' : 'equipar'}`}
                    className={`relative aspect-square overflow-hidden rounded border-2 bg-black/40 transition-colors ${
                      equipped ? 'border-emerald-500' : 'border-[#6b4a26] hover:border-amber-500'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {weaponSheetUrl ? (
                      <SpriteFrameThumb url={weaponSheetUrl} size={64} className="h-full w-full" />
                    ) : (
                      <span className="text-lg">⚔️</span>
                    )}
                    {equipped && (
                      <span className="absolute left-0 right-0 top-0 bg-emerald-600/95 py-[1px] text-center text-[8px] font-bold uppercase tracking-wider text-white">
                        Equipado
                      </span>
                    )}
                  </button>
                );
              }
              return (
                <div
                  key={i}
                  className="flex aspect-square items-center justify-center rounded border-2 border-[#6b4a26]/50 bg-black/25 text-amber-100/20"
                >
                  ·
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs text-amber-100/80">
              {weaponName} da classe {equipped ? '— em uso' : '— guardada'}
            </p>
            <button
              type="button"
              disabled={!canEquip}
              onClick={toggleEquip}
              className={`shrink-0 rounded-md border-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                equipped
                  ? 'border-red-700 bg-red-900/50 text-red-100 hover:bg-red-900/80'
                  : 'border-amber-500 bg-amber-600 text-black hover:bg-amber-500'
              }`}
            >
              {equipped ? 'Remover' : 'Equipar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
