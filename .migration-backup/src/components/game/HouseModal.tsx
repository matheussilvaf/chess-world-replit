import { useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../lib/supabase';
import { X, Home, Trophy, Loader2 } from 'lucide-react';

export function HouseModal() {
  const { selectedHouse, setSelectedHouse, loadHouses, region } = useGameStore();
  const { user, profile, refreshProfile } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!selectedHouse) return null;

  const canBuy = !selectedHouse.owner_user_id && profile && profile.trophies >= selectedHouse.price_trophies;
  const isOwner = selectedHouse.owner_user_id === user?.id;

  const handleBuy = async () => {
    if (!user || !profile || !region || !canBuy) return;
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const newTrophies = profile.trophies - selectedHouse.price_trophies;

      await supabase.from('profiles').update({
        trophies: newTrophies,
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id);

      await supabase.from('houses').update({
        owner_user_id: user.id,
        updated_at: new Date().toISOString(),
      }).eq('id', selectedHouse.id);

      await refreshProfile();
      await loadHouses(region);
      setSuccess('Purchased successfully!');
    } catch (err: any) {
      setError(err.message || 'Purchase failed');
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <Home className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-white font-bold">{selectedHouse.name}</h3>
                <p className="text-slate-400 text-sm">
                  {isOwner ? 'Your property' : selectedHouse.owner_user_id ? 'Owned' : 'Available'}
                </p>
              </div>
            </div>
            <button onClick={() => setSelectedHouse(null)} className="text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="bg-slate-800 rounded-lg p-4 mb-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Price</span>
              <span className="text-yellow-400 flex items-center gap-1">
                <Trophy className="w-3.5 h-3.5" /> {selectedHouse.price_trophies} trophies
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Your Trophies</span>
              <span className="text-white">{profile?.trophies || 0}</span>
            </div>
            {selectedHouse.owner_user_id && !isOwner && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Owner</span>
                <span className="text-emerald-400">Another player</span>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-300 text-sm mb-4">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-emerald-300 text-sm mb-4">
              {success}
            </div>
          )}

          {!selectedHouse.owner_user_id && (
            <button
              onClick={handleBuy}
              disabled={loading || !canBuy}
              className="w-full py-3 rounded-xl font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700 shadow-lg shadow-emerald-500/20"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              ) : !canBuy ? (
                'Not enough trophies'
              ) : (
                'Purchase'
              )}
            </button>
          )}

          {isOwner && (
            <div className="text-center text-emerald-400 font-medium py-2">
              This is your property!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
