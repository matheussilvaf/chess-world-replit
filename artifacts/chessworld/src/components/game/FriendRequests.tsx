import { useEffect } from 'react';
import { Check, MapPin, UserMinus, Users, X, XCircle } from 'lucide-react';
import { useGameStore } from '../../stores/gameStore';
import { useFriendsStore } from '../../stores/friendsStore';

export function FriendRequests() {
  const { showFriends, showFriendsTab, toggleFriends, openFriends } = useGameStore();
  const store = useFriendsStore();

  useEffect(() => {
    if (!showFriends) return;
    void store.refresh();
    if (showFriendsTab === 'requests') store.markRequestsSeen();
  }, [showFriends, showFriendsTab]);

  if (!showFriends) return null;
  const requests = showFriendsTab === 'requests';
  return (
    <div className="fixed inset-0 z-[450] flex items-end bg-black/70 md:items-center md:justify-center md:p-4" onMouseDown={(e) => e.target === e.currentTarget && toggleFriends()}>
      <section className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-700 bg-slate-900 shadow-2xl md:max-w-lg md:rounded-2xl">
        <header className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <h2 className="flex items-center gap-2 font-bold text-white"><Users className="h-5 w-5 text-amber-400" /> Amigos</h2>
          <button onClick={toggleFriends} aria-label="Fechar" className="p-2 text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        </header>
        <nav className="grid grid-cols-2 border-b border-slate-700 p-1">
          <button onClick={() => openFriends('friends')} className={`rounded-lg py-2 text-sm font-semibold ${!requests ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}>Amigos ({store.friends.length})</button>
          <button onClick={() => openFriends('requests')} className={`rounded-lg py-2 text-sm font-semibold ${requests ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}>Solicitações {store.incoming.length ? `(${store.incoming.length})` : ''}</button>
        </nav>
        <div className="min-h-48 flex-1 overflow-y-auto p-4">
          {store.loading && <p className="py-10 text-center text-sm text-slate-400">Carregando...</p>}
          {store.error && <p className="mb-3 rounded-lg bg-red-950/50 p-3 text-sm text-red-300">{store.error}</p>}
          {!store.loading && !requests && (store.friends.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">Você ainda não tem amigos. Toque em outro jogador no mundo para adicioná-lo.</p>
          ) : <div className="space-y-2">{store.friends.map((friend) => (
            <article key={friend.userId} className="flex items-center gap-3 rounded-xl bg-slate-800 p-3">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${friend.online ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{friend.username}</div>
                <div className="flex flex-wrap gap-x-3 text-xs text-slate-400">
                  <span>Nv. {friend.level}</span><span>{friend.chessRating} ELO</span>
                  {friend.region && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{friend.region}</span>}
                </div>
              </div>
              <button onClick={() => window.confirm(`Remover ${friend.username} dos amigos?`) && void store.remove(friend.userId)} className="rounded-lg p-2 text-red-400 hover:bg-red-500/10" aria-label="Remover amigo"><UserMinus className="h-4 w-4" /></button>
            </article>
          ))}</div>)}
          {!store.loading && requests && (
            <div className="space-y-5">
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Recebidas</h3>
                {store.incoming.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Nenhuma solicitação recebida.</p> : (
                  <div className="space-y-2">{store.incoming.map((request) => (
                    <article key={request.id} className="flex items-center gap-3 rounded-xl bg-slate-800 p-3">
                      <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-white">{request.from.username}</div><div className="text-xs text-slate-400">Nv. {request.from.level} · {request.from.chessRating} ELO</div></div>
                      <button onClick={() => void store.accept(request.id)} className="rounded-lg bg-emerald-500/15 p-2 text-emerald-400" aria-label="Aceitar"><Check className="h-4 w-4" /></button>
                      <button onClick={() => void store.reject(request.id)} className="rounded-lg bg-red-500/15 p-2 text-red-400" aria-label="Recusar"><XCircle className="h-4 w-4" /></button>
                    </article>
                  ))}</div>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Enviadas</h3>
                {store.outgoing.length === 0 ? <p className="text-center text-sm text-slate-500">Nenhuma solicitação enviada.</p> : store.outgoing.map((request) => (
                  <article key={request.id} className="mb-2 flex items-center justify-between rounded-xl bg-slate-800 p-3"><span className="text-sm text-white">{request.to.username}</span><span className="text-xs text-amber-400">Enviada</span></article>
                ))}
              </section>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}