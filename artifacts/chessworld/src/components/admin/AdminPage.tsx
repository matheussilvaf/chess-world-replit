import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useInteractionStore } from '../../stores/interactionStore';
import { getColyseusHttpUrl } from '../../config/colyseus';
import { Settings, Gauge, ZoomIn, ArrowLeft, Crosshair, Bug, Waypoints } from 'lucide-react';
import { TournamentConfigSection } from './TournamentConfigSection';

interface GameSettings {
  default_zoom: number;
  player_speed: number;
  show_debug_visuals: boolean;
}

export function AdminPage() {
  const [settings, setSettings] = useState<GameSettings>({ default_zoom: 2, player_speed: 3, show_debug_visuals: false });
  const [saving, setSaving] = useState(false);
  const { debugEnabled, setDebugEnabled } = useInteractionStore();
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const { data } = await supabase
      .from('game_settings')
      .select('default_zoom, player_speed, show_debug_visuals')
      .eq('id', 1)
      .maybeSingle();
    if (data) {
      setSettings({
        default_zoom: Number(data.default_zoom),
        player_speed: Number(data.player_speed),
        show_debug_visuals: Boolean(data.show_debug_visuals),
      });
    }
  };

  const saveSettings = useCallback(async (newSettings: GameSettings) => {
    setSaving(true);
    const { error } = await supabase
      .from('game_settings')
      .update({
        default_zoom: newSettings.default_zoom,
        player_speed: newSettings.player_speed,
        show_debug_visuals: newSettings.show_debug_visuals,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);

    setSaving(false);
    if (!error) {
      setLastSaved(new Date().toLocaleTimeString());
    }
  }, []);

  const handleZoomChange = (value: number) => {
    const clamped = Math.round(value * 4) / 4; // snap to 0.25 steps
    const newSettings = { ...settings, default_zoom: clamped };
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const handleSpeedChange = (value: number) => {
    const clamped = Math.round(value * 10) / 10; // snap to 0.1 steps
    const newSettings = { ...settings, player_speed: clamped };
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-2xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex items-center gap-4 mb-10">
          <a
            href="/"
            className="flex items-center justify-center w-10 h-10 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-slate-300" />
          </a>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Settings className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Game Settings</h1>
              <p className="text-sm text-slate-400">Adjust global game parameters in real-time</p>
            </div>
          </div>
        </div>

        {/* Status bar */}
        {lastSaved && (
          <div className="mb-6 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <p className="text-sm text-emerald-400">
              {saving ? 'Saving...' : `Last saved at ${lastSaved}`}
            </p>
          </div>
        )}

        {/* Settings Cards */}
        <div className="space-y-6">
          {/* Zoom Setting */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <ZoomIn className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <h2 className="text-base font-medium text-white">Default Camera Zoom</h2>
                <p className="text-sm text-slate-400">How close the camera is to the character</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Zoom Level</span>
                <span className="text-lg font-mono font-semibold text-blue-400">
                  {settings.default_zoom.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="4"
                step="0.25"
                value={settings.default_zoom}
                onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
                className="w-full h-2 rounded-full appearance-none bg-slate-700 cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500
                  [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-grab
                  [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5
                  [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-500
                  [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-grab"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>0.5x (Far)</span>
                <span>2x (Default)</span>
                <span>4x (Close)</span>
              </div>
            </div>

            {/* Quick presets */}
            <div className="flex gap-2 mt-4">
              {[0.5, 1, 1.5, 2, 2.5, 3, 4].map((z) => (
                <button
                  key={z}
                  onClick={() => handleZoomChange(z)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    settings.default_zoom === z
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {z}x
                </button>
              ))}
            </div>
          </div>

          {/* Speed Setting */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Gauge className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <h2 className="text-base font-medium text-white">Character Speed</h2>
                <p className="text-sm text-slate-400">How fast the character moves across the map</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Speed</span>
                <span className="text-lg font-mono font-semibold text-amber-400">
                  {settings.player_speed.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="10"
                step="0.1"
                value={settings.player_speed}
                onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                className="w-full h-2 rounded-full appearance-none bg-slate-700 cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-500
                  [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-grab
                  [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5
                  [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-amber-500
                  [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-grab"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>0.5 (Slow)</span>
                <span>3 (Default)</span>
                <span>10 (Fast)</span>
              </div>
            </div>

            {/* Quick presets */}
            <div className="flex gap-2 mt-4">
              {[1, 2, 3, 4, 5, 7, 10].map((s) => (
                <button
                  key={s}
                  onClick={() => handleSpeedChange(s)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    settings.player_speed === s
                      ? 'bg-amber-500 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Interaction Debug Toggle */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <Waypoints className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-base font-medium text-white">Interaction Debug</h2>
                  <p className="text-sm text-slate-400">Show debug modals for map interactions (tables, houses, buildings)</p>
                </div>
              </div>
              <button
                onClick={() => setDebugEnabled(!debugEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  debugEnabled ? 'bg-amber-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    debugEnabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Debug Visuals Toggle */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                  <Bug className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-base font-medium text-white">Debug Visuals</h2>
                  <p className="text-sm text-slate-400">Show collision body, sprite origin, and path overlays</p>
                </div>
              </div>
              <button
                onClick={() => {
                  const next = { ...settings, show_debug_visuals: !settings.show_debug_visuals };
                  setSettings(next);
                  saveSettings(next);
                }}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  settings.show_debug_visuals ? 'bg-cyan-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    settings.show_debug_visuals ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Tournament Configuration */}
        <div className="space-y-6">
          <TournamentConfigSection serverUrl={getColyseusHttpUrl()} />
        </div>

        {/* Footer info */}
        <div className="mt-8 pt-6 border-t border-slate-800">
          <a
            href="/admin/characters"
            className="flex items-center gap-3 px-5 py-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500/30 hover:bg-slate-800/80 transition-all group"
          >
            <div className="w-9 h-9 rounded-lg bg-cyan-500/10 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
              <Crosshair className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-white">Character Configuration</h3>
              <p className="text-xs text-slate-400">Edit origin, collision body, and frame positions</p>
            </div>
          </a>
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          Changes are applied in real-time to all connected players.
        </p>
      </div>
    </div>
  );
}
