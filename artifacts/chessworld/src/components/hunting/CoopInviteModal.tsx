import { Clock3, Coins, Star, Users, X } from 'lucide-react';
import { useEffect } from 'react';
import { getWorldRoom } from '../../game/network/colyseusClient';
import { HUNT_MSG } from '../../shared/hunting/HuntingShapes';
import { useHuntingStore } from '../../stores/huntingStore';

export function CoopInviteModal() {
  const invite = useHuntingStore((state) => state.coopInvite);
  const close = () => useHuntingStore.getState().setCoopInvite(null);
  useEffect(() => {
    if (!invite) return;
    const timer = window.setTimeout(close, Math.max(0, invite.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [invite?.inviteId]);
  if (!invite || invite.expiresAt <= Date.now()) return null;
  const respond = (accept: boolean) => {
    const room = getWorldRoom();
    if (!room) return;
    const requestId = crypto.randomUUID();
    void useHuntingStore.getState().trackRequest(requestId);
    room.send(HUNT_MSG.coopRespond, { requestId, inviteId: invite.inviteId, accept });
    close();
  };
  const seconds = Math.max(0, Math.ceil((invite.expiresAt - Date.now()) / 1000));
  return (
    <div className="absolute inset-0 z-[520] flex items-center justify-center bg-black/70 p-3">
      <section className="w-full max-w-sm rounded-2xl border border-amber-600/60 bg-[#17120d] p-5 text-amber-50 shadow-2xl">
        <div className="flex justify-between"><h2 className="flex items-center gap-2 font-bold"><Users className="h-5 w-5 text-amber-400" /> Caçada em grupo</h2><button onClick={close}><X className="h-5 w-5" /></button></div>
        <p className="mt-3 text-sm"><b>{invite.fromUsername}</b> convidou você para caçar junto.</p>
        <div className="mt-4 rounded-xl bg-black/25 p-3 text-sm">
          <p className="font-bold">{invite.contract.animalName}</p>
          <p>{invite.contract.killed}/{invite.contract.quantity} abatidos</p>
          <div className="mt-2 flex gap-4 text-xs text-amber-200/70"><span className="flex gap-1"><Star className="h-4 w-4" />{invite.contract.xpReward} XP</span><span className="flex gap-1"><Coins className="h-4 w-4" />{invite.contract.crownsReward}</span></div>
          <p className="mt-2 flex items-center gap-1 text-xs"><Clock3 className="h-4 w-4" /> Convite expira em {seconds}s</p>
        </div>
        <div className="mt-4 flex gap-2"><button onClick={() => respond(true)} className="flex-1 rounded-lg bg-emerald-500 px-3 py-2 font-bold text-black">Aceitar</button><button onClick={() => respond(false)} className="flex-1 rounded-lg border border-red-700 px-3 py-2 text-red-200">Recusar</button></div>
      </section>
    </div>
  );
}