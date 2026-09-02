/**
 * HOTBAR de ferramentas (canto inferior central): atalho clicável para as
 * PRIMEIRAS ferramentas do inventário de coleta (a ordem vem do drag-and-drop
 * do painel de equipamento). Clicar equipa; clicar na equipada desequipa.
 * A barrinha embaixo de cada slot é a durabilidade atual.
 */
import { useEffect } from 'react';
import { SpriteFrameThumb } from './SpriteFrameThumb';
import { usePlayerCharacterStore } from '../../stores/playerCharacterStore';
import { useToolInventoryStore } from '../../stores/toolInventoryStore';

const HOTBAR_SLOTS = 6;
/** Coluna 11 da folha: arte do golpe (a picareta não tem arte de "parado"). */
export const TOOL_THUMB_COL = 11;

/** Barrinha de durabilidade (verde → amarela → vermelha). */
export function ToolDurabilityBar({
  current,
  max,
  className,
}: {
  current: number;
  max: number;
  className?: string;
}) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  const color = ratio > 0.5 ? 'bg-emerald-500' : ratio > 0.25 ? 'bg-yellow-400' : 'bg-red-500';
  return (
    <div className={`h-1 w-full overflow-hidden rounded-sm bg-black/60 ${className ?? ''}`}>
      <div className={`h-full ${color}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
    </div>
  );
}

export function ToolHotbar() {
  const character = usePlayerCharacterStore((s) => s.character);
  const worldReady = usePlayerCharacterStore((s) => s.worldReady);
  const liveWeapon = usePlayerCharacterStore((s) => s.liveWeapon);
  const equipSender = usePlayerCharacterStore((s) => s.equipSender);
  const items = useToolInventoryStore((s) => s.items);
  const durability = useToolInventoryStore((s) => s.durability);
  const load = useToolInventoryStore((s) => s.load);

  useEffect(() => {
    if (character) void load();
  }, [character, load]);

  if (!character || !worldReady) return null;
  const slots = items.slice(0, HOTBAR_SLOTS);
  if (slots.length === 0) return null;

  const toggle = (ref: string) => {
    if (!equipSender) return;
    if (liveWeapon === ref) equipSender(false);
    else equipSender(true, ref);
  };

  return (
    <div className="pointer-events-auto fixed bottom-2 left-1/2 z-[110] -translate-x-1/2">
      <div className="flex items-end gap-1 rounded-md border-2 border-[#8a5a2b] bg-[#2b1c10]/95 p-1 shadow-lg">
        {slots.map((item, i) => {
          const isEquipped = liveWeapon === item.ref;
          const cur = durability[item.ref] ?? item.maxDurability;
          return (
            <button
              key={item.ref}
              type="button"
              disabled={!equipSender}
              onClick={() => toggle(item.ref)}
              title={`${item.name} — nível ${item.level} · durabilidade ${cur}/${item.maxDurability} · clique para ${isEquipped ? 'remover' : 'equipar'}`}
              className={`relative h-9 w-9 overflow-hidden rounded border-2 bg-black/40 transition-colors sm:h-12 sm:w-12 ${
                isEquipped ? 'border-emerald-500' : 'border-[#6b4a26] hover:border-amber-500'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <SpriteFrameThumb url={item.sheetUrl} col={TOOL_THUMB_COL} size={64} className="h-full w-full" />
              <span className="absolute left-0.5 top-0 text-[8px] font-bold text-amber-200/70">{i + 1}</span>
              <div className="absolute inset-x-0.5 bottom-0.5">
                <ToolDurabilityBar current={cur} max={item.maxDurability} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
