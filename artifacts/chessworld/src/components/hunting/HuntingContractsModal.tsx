import { useEffect } from 'react';
import { Clock3, Coins, Crosshair, Star, X } from 'lucide-react';
import { getWorldRoom } from '../../game/network/colyseusClient';
import { HUNT_MSG, type HuntContractView } from '../../shared/hunting/HuntingShapes';
import { useHuntingStore } from '../../stores/huntingStore';

const duration = (minutes: number) => minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
const remaining = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
};
const lockLabel = (ms: number) => {
  const minutes = Math.max(0, Math.ceil(ms / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export function HuntingContractsModal() {
  const payload = useHuntingStore((s) => s.contracts);
  const active = useHuntingStore((s) => s.active);
  const now = useHuntingStore((s) => s.now);
  const pending = useHuntingStore((s) => s.pending);
  const error = useHuntingStore((s) => s.error);
  const close = () => useHuntingStore.getState().setModalOpen(false);

  useEffect(() => {
    const timer = window.setInterval(() => useHuntingStore.getState().tick(), 1000);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', key);
    return () => { window.clearInterval(timer); window.removeEventListener('keydown', key); };
  }, []);

  const send = (type: typeof HUNT_MSG.accept | typeof HUNT_MSG.claim | typeof HUNT_MSG.abandon, body: Record<string, string>) => {
    const room = getWorldRoom();
    if (!room) return;
    const requestId = crypto.randomUUID();
    void useHuntingStore.getState().trackRequest(requestId);
    room.send(type, { requestId, ...body });
  };

  return (
    <div className="absolute inset-0 z-[500] flex items-center justify-center bg-black/65 p-2 backdrop-blur-sm sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section className="pointer-events-auto flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-amber-700/60 bg-[#17120d] text-amber-50 shadow-2xl">
        <header className="flex items-center justify-between border-b border-amber-900/70 bg-[#24180d] px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold"><Crosshair className="h-5 w-5 text-amber-400" /> Contratos de Caça</h2>
            <p className="text-xs text-amber-200/60">Escolha uma presa e retorne ao caçador para resgatar.</p>
          </div>
          <button type="button" onClick={close} aria-label="Fechar" className="rounded-lg p-2 text-amber-200 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </header>
        <div className="overflow-y-auto p-3 sm:p-5">
          {payload?.tableMissing && <p className="mb-3 rounded-lg border border-red-700/60 bg-red-950/50 p-3 text-sm text-red-200">Os contratos estão temporariamente indisponíveis.</p>}
          {error && <p className="mb-3 rounded-lg border border-red-700/60 bg-red-950/50 p-3 text-sm text-red-200">{error}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {payload?.contracts.map((contract) => (
              <ContractCard
                key={contract.id}
                contract={contract}
                active={active?.contractId === contract.id ? active : null}
                now={now}
                busy={Object.keys(pending).length > 0}
                send={send}
              />
            ))}
          </div>
          {!payload?.contracts.length && !payload?.tableMissing && <p className="py-10 text-center text-sm text-amber-100/50">Nenhum contrato disponível.</p>}
        </div>
      </section>
    </div>
  );
}

function ContractCard({ contract, active, now, busy, send }: {
  contract: HuntContractView;
  active: ReturnType<typeof useHuntingStore.getState>['active'];
  now: number;
  busy: boolean;
  send: (type: typeof HUNT_MSG.accept | typeof HUNT_MSG.claim | typeof HUNT_MSG.abandon, body: Record<string, string>) => void;
}) {
  const availability = active ? 'active' : contract.availability;
  return (
    <article className={`rounded-xl border p-4 ${availability === 'active' ? 'border-amber-400/70 bg-amber-900/20' : 'border-amber-900/60 bg-black/20'}`}>
      <h3 className="font-bold text-white">{contract.animalName}</h3>
      <p className="mt-1 text-sm text-amber-100">Caçar {contract.quantity} × {contract.animalName}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-amber-100/70">
        <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {duration(contract.timeLimitMinutes)}</span>
        <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 text-emerald-400" /> {contract.xpReward} XP Caça</span>
        <span className="flex items-center gap-1"><Coins className="h-3.5 w-3.5 text-yellow-400" /> {contract.crownsReward} Crowns</span>
        <span>Recarga: {contract.cooldownHours}h</span>
      </div>
      {active && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs"><span>{active.killed} / {active.quantity}</span><span>{remaining(active.deadline - now)}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-black/50"><div className="h-full bg-amber-400" style={{ width: `${Math.min(100, active.killed / active.quantity * 100)}%` }} /></div>
          {!!active.partyMembers?.length && <p className="mt-2 text-xs text-amber-200/70">Caçando com: {active.partyMembers.map((member) => member.username).join(', ')}</p>}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {availability === 'available' && <button disabled={busy} onClick={() => send(HUNT_MSG.accept, { contractId: contract.id })} className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-black disabled:opacity-40">Aceitar</button>}
        {active?.complete && <button disabled={busy} onClick={() => send(HUNT_MSG.claim, {})} className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-black disabled:opacity-40">Resgatar recompensa</button>}
        {active && <button disabled={busy} onClick={() => { if (window.confirm('Abandonar este contrato?')) send(HUNT_MSG.abandon, {}); }} className="rounded-lg border border-red-700 px-3 py-2 text-sm text-red-200 disabled:opacity-40">Abandonar</button>}
        {active && <button disabled={busy} onClick={() => useHuntingStore.getState().setInvitePickerOpen(true)} className="rounded-lg border border-amber-600 px-3 py-2 text-sm text-amber-100 disabled:opacity-40">Convidar um amigo</button>}
        {availability === 'locked' && <span className="text-sm text-slate-400">Disponível em {lockLabel((contract.lockedUntil ?? now) - now)}</span>}
        {availability === 'busy' && !active && <span className="text-sm text-slate-400">Conclua seu contrato atual.</span>}
      </div>
    </article>
  );
}