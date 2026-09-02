/**
 * Painel de EQUIPAMENTO (estilo RPG pixelado, como a referência do usuário).
 *
 * Duas seções:
 *  - "Armas de teste": itens fixos (arco, espada, cajado, lança de madeira).
 *  - "Ferramentas": inventário DINÂMICO — todas as variações de crafttools
 *    marcadas como "incluir no inventário" no /admin/rigs, com barrinha de
 *    durabilidade e REORDENAÇÃO por arrastar-e-soltar (pointer events; a
 *    ordem também define os slots da hotbar). Arrastar = soltar em cima de
 *    outro slot; clique curto = equipar/desequipar.
 *
 * Clicar num item equipa em tempo real via `equip_weapon {equip, ref}`;
 * clicar no item já equipado desequipa. Nada é auto-equipado (padrão = mão).
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatedPreview } from '../admin/character-generator/AnimatedPreview';
import { SpriteFrameThumb } from './SpriteFrameThumb';
import { ToolDurabilityBar, TOOL_THUMB_COL } from './ToolHotbar';
import { loadLayerCanvases, type LayerSpec, type LoadedLayer } from '../../lib/character-generator/compositor';
import { getSkinTone } from '../../lib/character-generator/skinTones';
import type { GeneratorManifest } from '../../lib/character-generator/types';
import { getGeneratorManifest } from '../../game/characters/appearanceRuntime';
import { PLAYER_CLASS_LABELS } from '../../shared/characters/PlayerCharacterShapes';
import { usePlayerCharacterStore } from '../../stores/playerCharacterStore';
import { useAuthStore } from '../../stores/authStore';
import { useToolInventoryStore, type ToolInventoryItem } from '../../stores/toolInventoryStore';

/**
 * Armas de teste (variação madeira). Miniaturas: o arco usa a coluna 16
 * (folhas bowandarrow_* só têm arte nas colunas 15–18); as demais, coluna 1.
 */
const TEST_ITEMS: ReadonlyArray<{
  ref: string;
  category: 'weapon' | 'crafttools';
  familyId: string;
  variantId: string;
  name: string;
  thumbCol: number;
}> = [
  { ref: 'gen:weapon/bowandarrow/wood', category: 'weapon', familyId: 'bowandarrow', variantId: 'wood', name: 'Arco (madeira)', thumbCol: 16 },
  { ref: 'gen:weapon/sword/wood', category: 'weapon', familyId: 'sword', variantId: 'wood', name: 'Espada (madeira)', thumbCol: 1 },
  { ref: 'gen:weapon/wand/wood', category: 'weapon', familyId: 'wand', variantId: 'wood', name: 'Cajado (madeira)', thumbCol: 1 },
  { ref: 'gen:weapon/spear/wood', category: 'weapon', familyId: 'spear', variantId: 'wood', name: 'Lança (madeira)', thumbCol: 1 },
];

/** Distância (px) a partir da qual o gesto vira arrasto (menos = clique). */
const DRAG_THRESHOLD_PX = 6;

interface ToolDragState {
  /** Índice do item sendo arrastado (na ordem atual do store). */
  index: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Slot sob o ponteiro agora (destino do drop). */
  over: number | null;
  /** true depois de passar o threshold — deixou de ser clique. */
  active: boolean;
}

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
  const toolItems = useToolInventoryStore((s) => s.items);
  const toolDurability = useToolInventoryStore((s) => s.durability);
  const toolError = useToolInventoryStore((s) => s.error);
  const loadTools = useToolInventoryStore((s) => s.load);
  const moveItem = useToolInventoryStore((s) => s.moveItem);

  const [manifest, setManifest] = useState<GeneratorManifest | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [layers, setLayers] = useState<LoadedLayer[]>([]);
  const [toolDrag, setToolDrag] = useState<ToolDragState | null>(null);

  // Manifest + inventário de ferramentas ao abrir (cacheados — só a 1ª custa rede).
  useEffect(() => {
    if (!panelOpen || !character) return;
    let cancelled = false;
    setLoadErr(null);
    void loadTools();
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
  }, [panelOpen, character, loadTools]);

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

  /** URLs das folhas das armas de teste (miniaturas), resolvidas do manifest. */
  const sheetUrls = useMemo<Record<string, string | null>>(() => {
    const out: Record<string, string | null> = {};
    if (!manifest) return out;
    for (const item of TEST_ITEMS) {
      const fam = manifest.categories[item.category]?.find((f) => f.id === item.familyId);
      const v = fam ? (fam.variants.find((x) => x.id === item.variantId) ?? fam.default) : null;
      out[item.ref] = v ? `${import.meta.env.BASE_URL}${v.url}` : null;
    }
    return out;
  }, [manifest]);

  if (!character || !panelOpen) return null;

  const equippedName =
    TEST_ITEMS.find((i) => i.ref === liveWeapon)?.name ??
    toolItems.find((i) => i.ref === liveWeapon)?.name ??
    null;

  const toggleItem = (ref: string) => {
    if (!equipSender) return;
    if (liveWeapon === ref) equipSender(false);
    else equipSender(true, ref);
  };

  // ---- Drag-and-drop das ferramentas (pointer events; mouse E toque) ----

  const toolIndexFromPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-tool-idx]');
    if (!el) return null;
    const idx = Number(el.getAttribute('data-tool-idx'));
    return Number.isInteger(idx) && idx >= 0 && idx < toolItems.length ? idx : null;
  };

  const onToolPointerDown = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setToolDrag({
      index,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      over: null,
      active: false,
    });
  };

  const onToolPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const cx = e.clientX;
    const cy = e.clientY;
    setToolDrag((d) => {
      if (!d) return d;
      const active = d.active || Math.hypot(cx - d.startX, cy - d.startY) > DRAG_THRESHOLD_PX;
      return { ...d, x: cx, y: cy, active, over: active ? toolIndexFromPoint(cx, cy) : null };
    });
  };

  const onToolPointerUp = (item: ToolInventoryItem) => {
    const d = toolDrag;
    setToolDrag(null);
    if (!d) return;
    if (d.active) {
      // Soltou: troca de posição (a ordem persiste e alimenta a hotbar).
      if (d.over != null && d.over !== d.index) moveItem(d.index, d.over);
    } else {
      toggleItem(item.ref); // gesto curto = clique
    }
  };

  const draggedItem = toolDrag?.active ? (toolItems[toolDrag.index] ?? null) : null;

  const toolCells = Math.max(8, Math.ceil(toolItems.length / 4) * 4);

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
          {toolError && (
            <p className="mb-2 rounded border-2 border-red-800 bg-red-950/60 p-2 text-xs text-red-200">{toolError}</p>
          )}

          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200/60">Armas de teste</p>
          <div className="grid grid-cols-4 gap-1.5">
            {TEST_ITEMS.map((item) => {
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
            })}
          </div>

          <p className="mb-1 mt-3 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200/60">
            Ferramentas <span className="normal-case tracking-normal text-amber-200/40">(arraste para organizar — os 6 primeiros vão para a hotbar)</span>
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {Array.from({ length: toolCells }, (_, i) => {
              const item = toolItems[i];
              if (!item) {
                return (
                  <div
                    key={`empty-${i}`}
                    className="flex aspect-square items-center justify-center rounded border-2 border-[#6b4a26]/50 bg-black/25 text-amber-100/20"
                  >
                    ·
                  </div>
                );
              }
              const isEquipped = liveWeapon === item.ref;
              const cur = toolDurability[item.ref] ?? item.maxDurability;
              const isDragSource = toolDrag?.active && toolDrag.index === i;
              const isDropTarget = toolDrag?.active && toolDrag.over === i && toolDrag.index !== i;
              return (
                <button
                  key={item.ref}
                  type="button"
                  data-tool-idx={i}
                  disabled={!equipSender}
                  onPointerDown={(e) => onToolPointerDown(e, i)}
                  onPointerMove={onToolPointerMove}
                  onPointerUp={() => onToolPointerUp(item)}
                  onPointerCancel={() => setToolDrag(null)}
                  title={`${item.name} — nível ${item.level} · durabilidade ${cur}/${item.maxDurability}`}
                  className={`relative aspect-square touch-none select-none overflow-hidden rounded border-2 bg-black/40 transition-colors ${
                    isDropTarget
                      ? 'border-amber-400 bg-amber-500/20'
                      : isEquipped
                        ? 'border-emerald-500'
                        : 'border-[#6b4a26] hover:border-amber-500'
                  } ${isDragSource ? 'opacity-40' : ''} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <SpriteFrameThumb url={item.sheetUrl} col={TOOL_THUMB_COL} size={64} className="h-full w-full" />
                  <span className="absolute right-0.5 top-0 text-[8px] font-bold text-amber-200/80">{item.level}</span>
                  {isEquipped && (
                    <span className="absolute left-0 right-0 top-0 bg-emerald-600/95 py-[1px] text-center text-[8px] font-bold uppercase tracking-wider text-white">
                      Equipado
                    </span>
                  )}
                  <div className="absolute inset-x-0.5 bottom-0.5">
                    <ToolDurabilityBar current={cur} max={item.maxDurability} />
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs text-amber-100/80">
              {equippedName ? `${equippedName} — em uso` : 'Nenhuma arma equipada'}
            </p>
            {equippedName && (
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

      {/* Fantasma do arrasto (segue o ponteiro). */}
      {draggedItem && toolDrag && (
        <div
          className="pointer-events-none fixed z-[200] h-12 w-12 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded border-2 border-amber-400 bg-[#2b1c10]/95 shadow-xl"
          style={{ left: toolDrag.x, top: toolDrag.y }}
        >
          <SpriteFrameThumb url={draggedItem.sheetUrl} col={TOOL_THUMB_COL} size={64} className="h-full w-full" />
        </div>
      )}
    </div>
  );
}
