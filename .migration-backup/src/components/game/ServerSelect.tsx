import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useGameStore } from '../../stores/gameStore';
import { REGIONS, type Region } from '../../config/game';
import { Globe, Users, ChevronRight, Crown } from 'lucide-react';

export function ServerSelect() {
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [loading, setLoading] = useState(false);
  const { user } = useAuthStore();
  const { enterRegion } = useGameStore();

  const handleEnter = async () => {
    if (!selectedRegion || !user) return;
    setLoading(true);
    await enterRegion(selectedRegion, user.id);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-amber-500/20 rounded-xl mb-4 border border-amber-500/30">
            <Crown className="w-7 h-7 text-amber-400" />
          </div>
          <h1 className="text-3xl font-bold text-white">Choose Your Server</h1>
          <p className="text-slate-400 mt-2">Select a region to enter the world</p>
        </div>

        <div className="space-y-3">
          {REGIONS.map((region) => (
            <button
              key={region.id}
              onClick={() => setSelectedRegion(region.id)}
              className={`w-full flex items-center gap-4 p-5 rounded-xl border transition-all ${
                selectedRegion === region.id
                  ? 'bg-white/10 border-amber-500/50 shadow-lg shadow-amber-500/10'
                  : 'bg-white/5 border-white/10 hover:bg-white/8 hover:border-white/20'
              }`}
            >
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-2xl`} style={{ background: `${region.color}20` }}>
                <Globe className="w-6 h-6" style={{ color: region.color }} />
              </div>
              <div className="flex-1 text-left">
                <div className="text-white font-semibold text-lg">{region.name}</div>
                <div className="text-slate-400 text-sm flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  <span>Online players</span>
                </div>
              </div>
              <ChevronRight className={`w-5 h-5 transition-colors ${selectedRegion === region.id ? 'text-amber-400' : 'text-slate-500'}`} />
            </button>
          ))}
        </div>

        <button
          onClick={handleEnter}
          disabled={!selectedRegion || loading}
          className="w-full mt-6 bg-gradient-to-r from-amber-500 to-amber-600 text-white py-4 rounded-xl font-semibold hover:from-amber-600 hover:to-amber-700 transition-all shadow-lg shadow-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed text-lg"
        >
          {loading ? 'Entering World...' : 'Enter World'}
        </button>
      </div>
    </div>
  );
}
