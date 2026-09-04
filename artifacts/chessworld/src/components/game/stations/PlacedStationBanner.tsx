/**
 * Faixa no topo do card de uma estação PORTÁTIL posicionada: dono, durabilidade
 * restante (cada craft gasta 1), tempo até virar item no chão e, para o dono,
 * o botão "Recolher" (volta para o inventário com a durabilidade que restou).
 */
import { useEffect, useState } from 'react';
import { Clock3, Gauge, Loader2, PackageOpen, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';
import { usePlacedStationsStore, type PlacedStationView } from '../../../stores/placedStationsStore';
import { getInventoryBridge } from '../../../game/inventory/inventoryBridge';

const PICKUP_TIMEOUT_MS = 8000;

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function PlacedStationBanner({ station }: { station: PlacedStationView }) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const pickupRequestId = usePlacedStationsStore((s) => s.pickupRequestId);
  const setPickupRequestId = usePlacedStationsStore((s) => s.setPickupRequestId);
  const pushNotice = usePlacedStationsStore((s) => s.pushNotice);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Sem resposta do servidor à recolha: libera o botão.
  useEffect(() => {
    if (!pickupRequestId) return;
    const timer = window.setTimeout(() => {
      setPickupRequestId(null);
      pushNotice('error', 'Sem resposta do servidor ao recolher. Tente de novo.');
    }, PICKUP_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [pickupRequestId, setPickupRequestId, pushNotice]);

  const isOwner = !!userId && station.ownerId === userId;
  const ratio = station.maxDurability > 0 ? station.durability / station.maxDurability : 0;
  const tone = ratio > 0.5 ? 'bg-emerald-500' : ratio > 0.2 ? 'bg-amber-400' : 'bg-red-500';
  const remainingMs = station.expiresAt - now;
  const picking = !!pickupRequestId;

  const pickup = () => {
    const bridge = getInventoryBridge();
    if (!bridge || picking) return;
    const requestId = crypto.randomUUID();
    setPickupRequestId(requestId);
    bridge.sendStationPickup({ requestId, placedId: station.id });
  };

  return (
    <div className="flex items-center gap-3 border-b border-neutral-800 bg-[#141416] px-4 py-2 text-[11px] text-neutral-300" data-testid="placed-station-banner">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate">
          {isOwner ? (
            <span className="font-semibold text-amber-200">Sua estação portátil</span>
          ) : (
            <span className="flex items-center gap-1 truncate"><ShieldCheck className="h-3 w-3 shrink-0 text-emerald-400" /> Estação de <b className="text-neutral-100">{station.ownerName}</b> — uso permitido</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3">
          <span className="flex items-center gap-1" title="Durabilidade (crafts restantes)">
            <Gauge className="h-3 w-3 shrink-0 text-neutral-400" />
            <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-neutral-800">
              <span className={`absolute inset-y-0 left-0 rounded-full ${tone}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
            </span>
            <span className="tabular-nums" data-testid="text-placed-durability">{station.durability}/{station.maxDurability}</span>
          </span>
          <span className="flex items-center gap-1 tabular-nums" title="Tempo até virar item no chão">
            <Clock3 className="h-3 w-3 shrink-0 text-neutral-400" /> {formatRemaining(remainingMs)}
          </span>
        </div>
        {station.durability <= 0 && (
          <div className="mt-1 text-red-300">Sem durabilidade — não dá mais para criar itens aqui.</div>
        )}
      </div>
      {isOwner && (
        <button
          type="button"
          onClick={pickup}
          disabled={picking}
          data-testid="button-pickup-station"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-amber-600/70 bg-amber-900/40 px-2.5 text-xs font-semibold text-amber-100 hover:bg-amber-800/60 disabled:cursor-wait disabled:opacity-60"
          title="Volta para o inventário com a durabilidade que restou"
        >
          {picking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageOpen className="h-3.5 w-3.5" />}
          Recolher
        </button>
      )}
    </div>
  );
}
