import { useAuthStore } from '../../stores/authStore';
import { useGameStore } from '../../stores/gameStore';
import { X, Star, Trophy, Crown } from 'lucide-react';

export function PlayerProfile() {
  const { profile } = useAuthStore();
  const { showProfile, toggleProfile } = useGameStore();

  if (!showProfile || !profile) return null;

  const winRate = profile.games_played > 0
    ? Math.round((profile.wins / profile.games_played) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-md overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-700 p-6 relative">
          <button onClick={toggleProfile} className="absolute top-4 right-4 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center border-2 border-amber-400">
              <Crown className="w-8 h-8 text-amber-400" />
            </div>
            <div>
              <h2 className="text-white text-xl font-bold">{profile.username}</h2>
              <div className="flex items-center gap-3 mt-1">
                <span className="flex items-center gap-1 text-amber-400 text-sm">
                  <Star className="w-3.5 h-3.5" /> {profile.rating} ELO
                </span>
                <span className="flex items-center gap-1 text-yellow-400 text-sm">
                  <Trophy className="w-3.5 h-3.5" /> {profile.trophies}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <StatBox label="Played" value={profile.games_played} />
            <StatBox label="Wins" value={profile.wins} color="text-emerald-400" />
            <StatBox label="Losses" value={profile.losses} color="text-red-400" />
            <StatBox label="Draws" value={profile.draws} color="text-slate-400" />
          </div>

          <div className="bg-slate-800/50 rounded-xl p-4">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-sm">Win Rate</span>
              <span className="text-white font-bold">{winRate}%</span>
            </div>
            <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all"
                style={{ width: `${winRate}%` }}
              />
            </div>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Region</span>
              <span className="text-white capitalize">{profile.current_region?.replace('_', ' ')}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Board Theme</span>
              <span className="text-white capitalize">{profile.board_theme}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Piece Style</span>
              <span className="text-white capitalize">{profile.piece_style}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Member Since</span>
              <span className="text-white">{new Date(profile.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, color = 'text-white' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-3 text-center">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-slate-500 text-xs">{label}</div>
    </div>
  );
}
