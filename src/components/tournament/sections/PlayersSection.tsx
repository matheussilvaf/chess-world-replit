import { useState } from 'react';
import { tournamentApi } from '../api';
import { Users, Plus, Trash2, Edit3, X, Check } from 'lucide-react';

interface Props {
  tournament: any;
  presets: any[];
  onAction: (fn: () => Promise<any>) => void;
}

export function PlayersSection({ tournament, presets, onAction }: Props) {
  const [newName, setNewName] = useState('');
  const [newRating, setNewRating] = useState('1500');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRating, setEditRating] = useState('');

  const isSetup = tournament.status === 'setup';
  const players = tournament.players || [];

  const addPlayer = () => {
    if (!newName.trim()) return;
    onAction(async () => {
      const result = await tournamentApi.addPlayer(tournament.id, newName.trim(), parseInt(newRating) || 1500);
      setNewName('');
      setNewRating('1500');
      return { tournament: { ...tournament, players: [...players, result] } };
    });
  };

  const removePlayer = (playerId: string) => {
    onAction(() => tournamentApi.removePlayer(tournament.id, playerId).then(() => tournamentApi.getTournament(tournament.id)).then(t => ({ tournament: t })));
  };

  const startEdit = (player: any) => {
    setEditingId(player.id);
    setEditName(player.name);
    setEditRating(String(player.rating));
  };

  const saveEdit = (playerId: string) => {
    onAction(async () => {
      await tournamentApi.updatePlayer(tournament.id, playerId, editName, parseInt(editRating) || 1500);
      setEditingId(null);
      return { tournament: await tournamentApi.getTournament(tournament.id) };
    });
  };

  const loadPreset = (index: number) => {
    onAction(() => tournamentApi.loadPreset(tournament.id, index).then(t => ({ tournament: t })));
  };

  const clearAll = () => {
    if (!confirm('Clear all players?')) return;
    onAction(() => tournamentApi.clearPlayers(tournament.id).then(() => tournamentApi.getTournament(tournament.id)).then(t => ({ tournament: t })));
  };

  const withdrawPlayer = (playerId: string) => {
    if (!confirm('Withdraw this player?')) return;
    onAction(() => tournamentApi.withdrawPlayer(tournament.id, playerId).then(t => t));
  };

  return (
    <section className="card">
      <div className="card-header">
        <Users className="w-5 h-5 text-emerald-400" />
        <h2 className="text-base font-semibold">Participants ({players.length})</h2>
      </div>

      {/* Add player form (setup only) */}
      {isSetup && (
        <div className="p-4 border-b border-slate-700/50 space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addPlayer()}
              className="input flex-1"
            />
            <input
              type="number"
              placeholder="Rating"
              value={newRating}
              onChange={e => setNewRating(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addPlayer()}
              className="input w-24"
            />
            <button onClick={addPlayer} className="btn-sm btn-primary">
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Presets */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500">Presets:</span>
            {presets.map((p: any, i: number) => (
              <button
                key={i}
                onClick={() => loadPreset(i)}
                className="text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              >
                {p.name}
              </button>
            ))}
            {players.length > 0 && (
              <button
                onClick={clearAll}
                className="text-xs px-2 py-1 rounded bg-red-900/30 border border-red-700/50 text-red-400 hover:text-red-200 ml-auto transition-colors"
              >
                Clear All
              </button>
            )}
          </div>
        </div>
      )}

      {/* Player list */}
      {players.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50 text-xs text-slate-500 uppercase">
                {tournament.status !== 'setup' && <th className="px-3 py-2 text-left">TPN</th>}
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-right">Rating</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...players]
                .sort((a: any, b: any) => {
                  if (tournament.status !== 'setup' && a.tpn && b.tpn) return a.tpn - b.tpn;
                  return b.rating - a.rating;
                })
                .map((player: any) => (
                  <tr key={player.id} className={`border-b border-slate-800/50 ${player.status === 'withdrawn' ? 'opacity-50' : ''}`}>
                    {tournament.status !== 'setup' && (
                      <td className="px-3 py-2 text-slate-400 font-mono text-xs">{player.tpn}</td>
                    )}
                    <td className="px-3 py-2">
                      {editingId === player.id ? (
                        <input value={editName} onChange={e => setEditName(e.target.value)} className="input text-sm py-0.5" />
                      ) : (
                        <span className="text-slate-200">{player.name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {editingId === player.id ? (
                        <input value={editRating} onChange={e => setEditRating(e.target.value)} className="input text-sm py-0.5 w-20 text-right" />
                      ) : (
                        <span className="text-slate-300">{player.rating}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        player.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                      }`}>
                        {player.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isSetup && editingId !== player.id && (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => startEdit(player)} className="p-1 text-slate-500 hover:text-blue-400">
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => removePlayer(player.id)} className="p-1 text-slate-500 hover:text-red-400">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      {isSetup && editingId === player.id && (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => saveEdit(player.id)} className="p-1 text-emerald-400">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setEditingId(null)} className="p-1 text-slate-500">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      {tournament.status === 'active' && player.status === 'active' && (
                        <button onClick={() => withdrawPlayer(player.id)} className="text-xs text-red-400 hover:text-red-300">
                          Withdraw
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-4 text-center text-slate-500 text-sm">No players added yet</div>
      )}
    </section>
  );
}
