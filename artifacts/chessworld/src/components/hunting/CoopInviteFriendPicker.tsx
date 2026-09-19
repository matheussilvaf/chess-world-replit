import { useEffect } from 'react';
import { X } from 'lucide-react';
import { getWorldRoom } from '../../game/network/colyseusClient';
import { HUNT_MSG } from '../../shared/hunting/HuntingShapes';
import { useFriendsStore } from '../../stores/friendsStore';
import { useHuntingStore } from '../../stores/huntingStore';

export function CoopInviteFriendPicker() {
  const friends = useFriendsStore((state) => state.friends);
  const loading = useFriendsStore((state) => state.loading);
  useEffect(() => { void useFriendsStore.getState().refresh(); }, []);
  const close = () => useHuntingStore.getState().setInvitePickerOpen(false);
  const invite = (friendUserId: string) => {
    const room = getWorldRoom();
    if (!room) return;
    const requestId = crypto.randomUUID();
    void useHuntingStore.getState().trackRequest(requestId);
    room.send(HUNT_MSG.coopInvite, { requestId, friendUserId });
  };
  return (
    <div className="absolute inset-0 z-[510] flex items-center justify-center bg-black/70 p-3">
      <section className="w-full max-w-sm rounded-2xl border border-amber-700/60 bg-[#17120d] p-4 text-amber-50">
        <div className="flex justify-between"><h2 className="font-bold">Convidar amigo</h2><button onClick={close}><X className="h-5 w-5" /></button></div>
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {[...friends].sort((a, b) => Number(b.online) - Number(a.online)).map((friend) => <div key={friend.userId} className="flex items-center justify-between rounded-lg bg-black/25 p-3"><div><p className="text-sm font-semibold">{friend.username}</p><p className="text-xs text-slate-400">{friend.online ? 'online' : 'offline'}</p></div><button disabled={!friend.online} onClick={() => invite(friend.userId)} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-black disabled:opacity-30">Convidar</button></div>)}
          {!loading && !friends.length && <p className="py-6 text-center text-sm text-slate-400">Nenhum amigo encontrado.</p>}
        </div>
      </section>
    </div>
  );
}