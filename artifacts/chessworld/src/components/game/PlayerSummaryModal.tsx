import { useEffect, useState } from 'react';
import { Crown, MapPin, Swords, X } from 'lucide-react';
import { fetchPlayerSummary, type PlayerSummary } from '../../lib/friendsApi';
import { useGameStore } from '../../stores/gameStore';
import { useFriendsStore } from '../../stores/friendsStore';

export function PlayerSummaryModal() {
  const playerId = useGameStore((s) => s.selectedPlayerId);
  const close = useGameStore((s) => s.setSelectedPlayerId);
  const [summary, setSummary] = useState<PlayerSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const sendRequest = useFriendsStore((s) => s.sendRequest);
  const accept = useFriendsStore((s) => s.accept);

  const load = async (id: string) => {
    setLoading(true); setError(''); setSummary(null);
    try { setSummary(await fetchPlayerSummary(id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar o jogador.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (playerId) void load(playerId); }, [playerId]);
  if (!playerId) return null;

  const friendshipButton = summary && (() => {
    if (summary.friendship === 'friends') return <button disabled className="w-full rounded-xl bg-emerald-500/15 py-3 font-semibold text-emerald-400">Amigos ✓</button>;
    if (summary.friendship === 'pending_out') return <button disabled className="w-full rounded-xl bg-slate-700 py-3 font-semibold text-slate-400">Solicitação enviada</button>;
    if (summary.friendship === 'pending_in') return <button onClick={async () => { if (summary.requestId) await accept(summary.requestId); await load(playerId); }} className="w-full rounded-xl bg-emerald-500 py-3 font-semibold text-slate-950">Aceitar solicitação</button>;
    return <button onClick={async () => {
      try {
        await sendRequest(summary.userId);
        await load(playerId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Não foi possível enviar a solicitação.');
      }
    }} className="w-full rounded-xl bg-amber-500 py-3 font-semibold text-slate-950">Enviar solicitação de amizade</button>;
  })();

  return (
    <div className="fixed inset-0 z-[500] flex items-end bg-black/70 md:items-center md:justify-center md:p-4" onMouseDown={(e) => e.target === e.currentTarget && close(null)}>
      <section className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl md:max-w-lg md:rounded-2xl">
        <button onClick={() => close(null)} className="float-right p-2 text-slate-400" aria-label="Fechar"><X className="h-5 w-5" /></button>
        {loading && <p className="clear-both py-16 text-center text-slate-400">Carregando jogador...</p>}
        {error && <div className="clear-both py-10 text-center"><p className="mb-4 text-red-300">{error}</p><button onClick={() => void load(playerId)} className="rounded-lg bg-slate-700 px-4 py-2 text-white">Tentar novamente</button></div>}
        {summary && <div className="clear-both">
          <div className="mb-5">
            <div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${summary.online ? 'bg-emerald-400' : 'bg-slate-600'}`} /><h2 className="text-xl font-bold text-white">{summary.username}</h2></div>
            <div className="mt-1 flex flex-wrap gap-3 text-sm text-slate-400"><span>Nível {summary.level}</span>{summary.region && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{summary.region}</span>}</div>
          </div>
          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat icon={<Swords className="h-4 w-4" />} label="Rating" value={summary.chessRating} />
            <Stat label="Gambits" value={summary.gambits} />
            <Stat icon={<Crown className="h-4 w-4" />} label="Crowns" value={summary.crowns} />
            <Stat label="Partidas" value={summary.gamesPlayed} />
          </div>
          <div className="mb-5 rounded-xl bg-slate-800 p-3 text-center text-sm"><span className="text-emerald-400">{summary.wins} V</span><span className="mx-3 text-red-400">{summary.losses} D</span><span className="text-slate-300">{summary.draws} E</span></div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Habilidades</h3>
          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3">{summary.skills.map((skill) => <div key={skill.id} className="rounded-lg bg-slate-800 p-2"><div className="truncate text-xs text-slate-400">{skill.name}</div><div className="font-bold text-white">Nv. {skill.level}</div></div>)}</div>
          {friendshipButton}
        </div>}
      </section>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return <div className="rounded-xl bg-slate-800 p-3"><div className="flex items-center gap-1 text-xs text-slate-400">{icon}{label}</div><div className="font-bold text-white">{value}</div></div>;
}