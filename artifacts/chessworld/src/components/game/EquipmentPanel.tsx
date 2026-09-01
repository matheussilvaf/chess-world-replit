/**
 * Painel de EQUIPAMENTO (estilo RPG pixelado, como a referência do usuário).
 *
 * FASE DE TESTE DAS ARMAS NOVAS: os 4 primeiros slots da grade são itens
 * fixos de madeira — arco (primeiro), espada, cajado e lança. Clicar num
 * item equipa AQUELA arma em tempo real via `equip_weapon {equip, ref}`;
 * clicar no item já equipado desequipa. Nada é auto-equipado: o padrão é
 * mão limpa. Desktop: cartão à direita. Mobile: folha inferior.
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatedPreview } from '../admin/character-generator/AnimatedPreview';
import { SpriteFrameThumb } from './SpriteFrameThumb';
import { loadLayerCanvases, type LayerSpec, type LoadedLayer } from '../../lib/character-generator/compositor';
import { getSkinTone } from '../../lib/character-generator/skinTones';
import type { GeneratorManifest } from '../../lib/character-generator/types';
import { getGeneratorManifest } from '../../game/characters/appearanceRuntime';
import { PLAYER_CLASS_LABELS } from '../../shared/characters/PlayerCharacterShapes';
import { usePlayerCharacterStore } from '../../stores/playerCharacterStore';
import { useAuthStore } from '../../stores/authStore';

/**
 * Itens de teste (armas finais, variação madeira). O arco usa a coluna 16
 * como miniatura: as folhas bowandarrow_* só têm arte nas colunas 15–18.
 */
const TEST_ITEMS: ReadonlyArray<{
  ref: string;
  familyId: string;
  variantId: string;
  name: string;
  thumbCol: number;
}> = [
  { ref: 'gen:weapon/bowandarrow/wood', familyId: 'bowandarrow', variantId: 'wood', name: 'Arco (madeira)', thumbCol: 16 },
  { ref: 'gen:weapon/sword/wood', familyId: 'sword', variantId: 'wood', name: 'Espada (madeira)', thumbCol: 1 },
  { ref: 'gen:weapon/wand/wood', familyId: 'wand', variantId: 'wood', name: 'Cajado (madeira)', thumbCol: 1 },
  { ref: 'gen:weapon/spear/wood', familyId: 'spear', variantId: 'wood', name: 'Lança (madeira)', thumbCol: 1 },
];

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
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [layers, setLayers] = useState<LoadedLayer[]>([]);

  // Manifest ao abrir (cacheado por módulo — só a 1ª abertura custa rede).
  useEffect(() => {
    if (!panelOpen || !character) return;
    let cancelled = false;
    setLoadErr(null);
    getGeneratorManifest()
      .then((mf) => {
        if (!cancelled) setManifest(mf);
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

  /** URLs das folhas dos itens de teste (miniaturas), resolvidas do manifest. */
  const sheetUrls = useMemo<Record<string, string | null>>(() => {
    const out: Record<string, string | null> = {};
    if (!manifest) return out;
    for (const item of TEST_ITEMS) {
      const fam = manifest.categories['weapon']?.find((f) => f.id === item.familyId);
      const v = fam ? (fam.variants.find((x) => x.id === item.variantId) ?? fam.default) : null;
      out[item.ref] = v ? `${import.meta.env.BASE_URL}${v.url}` : null;
    }
    return out;
  }, [manifest]);

  if (!character || !panelOpen) return null;

  const equippedItem = TEST_ITEMS.find((i) => i.ref === liveWeapon) ?? null;

  const toggleItem = (ref: string) => {
    if (!equipSender) return;
    if (liveWeapon === ref) equipSender(false);
    else equipSender(true, ref);
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
              const item = TEST_ITEMS[i];
              if (item) {
                const isEquipped = liveWeapon === item.ref;
                const url = sheetUrls[item.ref] ?? null;
                return (
                  <button
                    key={item.ref}
                    type="button"
                    disabled={!equipSender}
                    onClick={() => toggleItem(item.ref)}
                    title={`${item.name} — clique para ${isEquipped ? 'remover' : 'equipar'}`}
                    className={`relative aspect-square overflow-hidden rounded border-2 bg-black/40 transition-colors ${
                      isEquipped ? 'border-emerald-500' : 'border-[#6b4a26] hover:border-amber-500'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {url ? (
                      <SpriteFrameThumb url={url} col={item.thumbCol} size={64} className="h-full w-full" />
                    ) : (
                      <span className="text-lg">⚔️</span>
                    )}
                    {isEquipped && (
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
              {equippedItem ? `${equippedItem.name} — em uso` : 'Nenhuma arma equipada'}
            </p>
            {equippedItem && (
              <button
                type="button"
                disabled={!equipSender}
                onClick={() => equipSender?.(false)}
                className="shrink-0 rounded-md border-2 border-red-700 bg-red-900/50 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-red-100 transition-colors hover:bg-red-900/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Remover
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
