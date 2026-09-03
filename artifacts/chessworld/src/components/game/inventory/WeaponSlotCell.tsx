/**
 * Slot reservado à arma da classe — o primeiro do acesso rápido. Mostra o
 * ícone da arma (catálogo do gerador) e o estado equipada/guardada; clicar
 * alterna. O servidor escolhe a arma (default-weapons da classe); a ref
 * local serve só para desenhar o ícone antes da primeira resposta.
 */
import { useEffect } from 'react';
import { Check, Swords } from 'lucide-react';
import type { CraftCatalog } from '../../../lib/craft/craftCatalog';
import { inventoryEntry } from '../../../lib/inventory/inventoryVisualCatalog';
import { usePlayerCharacterStore } from '../../../stores/playerCharacterStore';
import { InventorySlotCell } from './InventorySlotCell';

/** true se a ref equipada ao vivo é uma ARMA (e não ferramenta). */
export function isWeaponRef(ref: string | null | undefined): boolean {
  return !!ref && ref.startsWith('gen:weapon/');
}

export function WeaponSlotCell({
  index,
  catalog,
  thumbSize = 40,
  compact = false,
}: {
  index: number;
  catalog: CraftCatalog | null;
  thumbSize?: number;
  /** Hotbar: badges menores. */
  compact?: boolean;
}) {
  const character = usePlayerCharacterStore((s) => s.character);
  const classWeaponRef = usePlayerCharacterStore((s) => s.classWeaponRef);
  const loadClassWeapon = usePlayerCharacterStore((s) => s.loadClassWeapon);
  const live = usePlayerCharacterStore((s) => s.liveWeapon);
  const send = usePlayerCharacterStore((s) => s.equipSender);

  useEffect(() => {
    if (character && classWeaponRef === undefined) void loadClassWeapon();
  }, [character, classWeaponRef, loadClassWeapon]);

  const equipped = isWeaponRef(live);
  const shownRef = equipped ? live : classWeaponRef ?? null;
  const noWeapon = classWeaponRef === null && !equipped;
  const name = shownRef ? inventoryEntry(catalog, shownRef)?.name ?? 'Arma da classe' : 'Arma da classe';
  const title = noWeapon
    ? 'Sua classe ainda não tem arma liberada'
    : equipped
      ? `${name} — equipada (clique para guardar)`
      : `${name} — clique para equipar`;

  return (
    <InventorySlotCell
      index={index}
      itemKey={shownRef}
      catalog={catalog}
      tone="weapon"
      active={equipped}
      thumbSize={thumbSize}
      title={title}
      disabled={!send || noWeapon}
      className={`cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${classWeaponRef === undefined && !equipped ? 'animate-pulse' : ''}`}
      onClick={() => send?.(!equipped)}
      overlay={
        <>
          <span
            className={`pointer-events-none absolute left-0.5 top-0.5 flex items-center justify-center rounded-sm bg-[#3b2411] text-amber-200 shadow-[0_0_0_1px_rgba(0,0,0,.5)] ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`}
            aria-hidden
          >
            <Swords className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
          </span>
          {noWeapon && (
            <span className="pointer-events-none absolute inset-x-0 bottom-0.5 text-center text-[8px] font-semibold uppercase tracking-wide text-amber-200/70">
              sem arma
            </span>
          )}
          {equipped ? (
            <span
              className={`pointer-events-none absolute -right-1 -top-1 flex items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_0_0_2px_#19100a] ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`}
              aria-hidden
            >
              <Check className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} strokeWidth={3} />
            </span>
          ) : (
            !noWeapon && !compact && (
              <span className="pointer-events-none absolute inset-x-0 bottom-0.5 text-center text-[8px] font-semibold uppercase tracking-wide text-amber-200/60">
                guardada
              </span>
            )
          )}
        </>
      }
    />
  );
}
