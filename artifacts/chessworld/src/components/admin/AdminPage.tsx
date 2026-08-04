import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useInteractionStore } from '../../stores/interactionStore';
import { getColyseusHttpUrl } from '../../config/colyseus';
import { Settings, Gauge, ZoomIn, ArrowLeft, Crosshair, Bug, Waypoints, Monitor, Smartphone, MessageSquare, Wand2, Swords, Hammer } from 'lucide-react';
import { TournamentConfigSection } from './TournamentConfigSection';

interface GameSettings {
  default_zoom: number;
  player_speed: number;
  show_debug_visuals: boolean;
  board_zoom_desktop: number;
  board_zoom_mobile: number;
  chat_preview_seconds: number;
  character_switch_enabled: boolean;
}

const BOARD_ZOOM_MIGRATION_SQL = `ALTER TABLE game_settings
  ADD COLUMN IF NOT EXISTS board_zoom_desktop numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS board_zoom_mobile numeric NOT NULL DEFAULT 2.5;`;

const CHAT_PREVIEW_MIGRATION_SQL = `ALTER TABLE game_settings
  ADD COLUMN IF NOT EXISTS chat_preview_seconds numeric NOT NULL DEFAULT 3;`;

export function AdminPage() {
  // The game forces overflow:hidden on html/body/#root. Override it here so
  // the admin page scrolls normally, and restore on unmount.
  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')].filter(Boolean) as HTMLElement[];
    const prev = els.map(el => el.style.overflow);
    els.forEach(el => { el.style.overflow = 'auto'; });
    return () => { els.forEach((el, i) => { el.style.overflow = prev[i]; }); };
  }, []);

  const [settings, setSettings] = useState<GameSettings>({
    default_zoom: 2,
    player_speed: 3,
    show_debug_visuals: false,
    board_zoom_desktop: 3,
    board_zoom_mobile: 2.5,
    chat_preview_seconds: 3,
    character_switch_enabled: false,
  });
  const [saving, setSaving] = useState(false);
  const { debugEnabled, setDebugEnabled } = useInteractionStore();
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  // The board zoom columns may not exist yet (added via SQL editor migration)
  const [boardZoomMissing, setBoardZoomMissing] = useState(false);
  // Same for the chat preview duration column
  const [chatPreviewMissing, setChatPreviewMissing] = useState(false);
  // Same for the character switch flag column
  const [switchFlagMissing, setSwitchFlagMissing] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    // select('*') so the query still works before the board zoom migration
    const { data } = await supabase
      .from('game_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (data) {
      const row = data as Record<string, unknown>;
      const hasBoardZoom = row.board_zoom_desktop != null;
      const hasChatPreview = row.chat_preview_seconds != null;
      const hasSwitchFlag = row.character_switch_enabled != null;
      setBoardZoomMissing(!hasBoardZoom);
      setChatPreviewMissing(!hasChatPreview);
      setSwitchFlagMissing(!hasSwitchFlag);
      setSettings({
        default_zoom: Number(row.default_zoom),
        player_speed: Number(row.player_speed),
        show_debug_visuals: Boolean(row.show_debug_visuals),
        board_zoom_desktop: hasBoardZoom ? Number(row.board_zoom_desktop) : 3,
        board_zoom_mobile: row.board_zoom_mobile != null ? Number(row.board_zoom_mobile) : 2.5,
        chat_preview_seconds: hasChatPreview ? Number(row.chat_preview_seconds) : 3,
        character_switch_enabled: Boolean(row.character_switch_enabled),
      });
    }
  };

  const saveSettings = useCallback(async (newSettings: GameSettings) => {
    setSaving(true);
    const payload: Record<string, unknown> = {
      default_zoom: newSettings.default_zoom,
      player_speed: newSettings.player_speed,
      show_debug_visuals: newSettings.show_debug_visuals,
      updated_at: new Date().toISOString(),
    };
    // Only send board zoom columns once they exist in the DB
    if (!boardZoomMissing) {
      payload.board_zoom_desktop = newSettings.board_zoom_desktop;
      payload.board_zoom_mobile = newSettings.board_zoom_mobile;
    }
    // Same for the chat preview duration column
    if (!chatPreviewMissing) {
      payload.chat_preview_seconds = newSettings.chat_preview_seconds;
    }
    // Same for the character switch flag column
    if (!switchFlagMissing) {
      payload.character_switch_enabled = newSettings.character_switch_enabled;
    }
    const { error } = await supabase
      .from('game_settings')
      .update(payload)
      .eq('id', 1);

    setSaving(false);
    if (!error) {
      setLastSaved(new Date().toLocaleTimeString());
    }
  }, [boardZoomMissing, chatPreviewMissing, switchFlagMissing]);

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

  const handleBoardZoomChange = (key: 'board_zoom_desktop' | 'board_zoom_mobile', value: number) => {
    const clamped = Math.round(value * 4) / 4; // snap to 0.25 steps
    const newSettings = { ...settings, [key]: clamped };
    setSettings(newSettings);
    if (!boardZoomMissing) saveSettings(newSettings);
  };

  const handleChatPreviewChange = (value: number) => {
    const clamped = Math.min(10, Math.max(2, Math.round(value * 2) / 2)); // snap to 0.5s, keep 2–10s
    const newSettings = { ...settings, chat_preview_seconds: clamped };
    setSettings(newSettings);
    if (!chatPreviewMissing) saveSettings(newSettings);
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

        {/* Painéis de administração */}
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            href="/admin/rigs"
            className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 hover:border-cyan-500/50 hover:bg-slate-800/80 transition-colors p-4"
          >
            <div className="w-9 h-9 rounded-lg bg-cyan-500/10 flex items-center justify-center">
              <Swords className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Rigs & Armas</p>
              <p className="text-xs text-slate-400">Hitboxes, perfis e níveis dos itens</p>
            </div>
          </a>
          <a
            href="/admin/craft"
            className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 hover:border-violet-500/50 hover:bg-slate-800/80 transition-colors p-4"
          >
            <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Hammer className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Craft</p>
              <p className="text-xs text-slate-400">Receitas das ferramentas e craft items</p>
            </div>
          </a>
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

          {/* Game Mode (board) Zoom */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <ZoomIn className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <h2 className="text-base font-medium text-white">Game Mode Zoom</h2>
                <p className="text-sm text-slate-400">Camera zoom while seated at a board, per device</p>
              </div>
            </div>

            {boardZoomMissing && (
              <div className="mb-5 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <p className="text-sm text-amber-300 font-medium mb-2">
                  One-time setup: run this in the Supabase SQL editor, then click Re-check.
                </p>
                <pre className="text-[11px] text-amber-200/90 bg-slate-950/70 rounded-md p-3 overflow-x-auto whitespace-pre-wrap font-mono">
                  {BOARD_ZOOM_MIGRATION_SQL}
                </pre>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={loadSettings}
                    className="px-3 py-1.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-medium hover:bg-amber-500/30 transition-colors"
                  >
                    Re-check
                  </button>
                  <p className="text-xs text-amber-200/70">
                    Until then the game uses defaults: desktop 3x, mobile 2.5x.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-6">
              {/* Desktop */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs text-slate-500 uppercase tracking-wide">
                    <Monitor className="w-3.5 h-3.5" /> Desktop
                  </span>
                  <span className="text-lg font-mono font-semibold text-purple-400">
                    {settings.board_zoom_desktop.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="4"
                  step="0.25"
                  disabled={boardZoomMissing}
                  value={settings.board_zoom_desktop}
                  onChange={(e) => handleBoardZoomChange('board_zoom_desktop', parseFloat(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none bg-slate-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-500
                    [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-grab
                    [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5
                    [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-purple-500
                    [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-grab"
                />
                <div className="flex gap-2">
                  {[2, 2.5, 3, 3.5, 4].map((z) => (
                    <button
                      key={z}
                      disabled={boardZoomMissing}
                      onClick={() => handleBoardZoomChange('board_zoom_desktop', z)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        settings.board_zoom_desktop === z
                          ? 'bg-purple-500 text-white'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {z}x
                    </button>
                  ))}
                </div>
              </div>

              {/* Mobile */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs text-slate-500 uppercase tracking-wide">
                    <Smartphone className="w-3.5 h-3.5" /> Mobile
                  </span>
                  <span className="text-lg font-mono font-semibold text-purple-400">
                    {settings.board_zoom_mobile.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="4"
                  step="0.25"
                  disabled={boardZoomMissing}
                  value={settings.board_zoom_mobile}
                  onChange={(e) => handleBoardZoomChange('board_zoom_mobile', parseFloat(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none bg-slate-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-500
                    [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-grab
                    [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5
                    [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-purple-500
                    [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-grab"
                />
                <div className="flex gap-2">
                  {[1.75, 2, 2.25, 2.5, 2.75, 3].map((z) => (
                    <button
                      key={z}
                      disabled={boardZoomMissing}
                      onClick={() => handleBoardZoomChange('board_zoom_mobile', z)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        settings.board_zoom_mobile === z
                          ? 'bg-purple-500 text-white'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {z}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Chat Preview Duration */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-base font-medium text-white">Chat Message Preview</h2>
                <p className="text-sm text-slate-400">How long the new-message balloon stays visible under the chat icon</p>
              </div>
            </div>

            {chatPreviewMissing && (
              <div className="mb-5 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <p className="text-sm text-amber-300 font-medium mb-2">
                  One-time setup: run this in the Supabase SQL editor, then click Re-check.
                </p>
                <pre className="text-[11px] text-amber-200/90 bg-slate-950/70 rounded-md p-3 overflow-x-auto whitespace-pre-wrap font-mono">
                  {CHAT_PREVIEW_MIGRATION_SQL}
                </pre>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={loadSettings}
                    className="px-3 py-1.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-medium hover:bg-amber-500/30 transition-colors"
                  >
                    Re-check
                  </button>
                  <p className="text-xs text-amber-200/70">
                    Until then the game uses the default: 3 seconds.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Duration</span>
                <span className="text-lg font-mono font-semibold text-emerald-400">
                  {settings.chat_preview_seconds.toFixed(1)}s
                </span>
              </div>
              <input
                type="range"
                min="2"
                max="10"
                step="0.5"
                disabled={chatPreviewMissing}
                value={settings.chat_preview_seconds}
                onChange={(e) => handleChatPreviewChange(parseFloat(e.target.value))}
                className="w-full h-2 rounded-full appearance-none bg-slate-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-500
                  [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-grab
                  [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5
                  [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-emerald-500
                  [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-grab"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>2s (Quick)</span>
                <span>3s (Default)</span>
                <span>10s (Long)</span>
              </div>
              <div className="flex gap-2 mt-1">
                {[2, 3, 4, 5, 7, 10].map((s) => (
                  <button
                    key={s}
                    disabled={chatPreviewMissing}
                    onClick={() => handleChatPreviewChange(s)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      settings.chat_preview_seconds === s
                        ? 'bg-emerald-500 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {s}s
                  </button>
                ))}
              </div>
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

          {/* Character Switch Toggle */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-400 text-base font-semibold">
                  ⇄
                </div>
                <div>
                  <h2 className="text-base font-medium text-white">Troca de Personagem</h2>
                  <p className="text-sm text-slate-400">
                    Permite trocar de personagem no mundo em produção — a troca aparece para todos em tempo real
                  </p>
                  {switchFlagMissing && (
                    <p className="text-xs text-amber-400 mt-1">
                      Rode a migração SQL da coluna character_switch_enabled para habilitar.
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => {
                  const next = { ...settings, character_switch_enabled: !settings.character_switch_enabled };
                  setSettings(next);
                  saveSettings(next);
                }}
                disabled={switchFlagMissing}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  settings.character_switch_enabled ? 'bg-violet-500' : 'bg-slate-700'
                } ${switchFlagMissing ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    settings.character_switch_enabled ? 'translate-x-6' : 'translate-x-0'
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
        <div className="mt-8 pt-6 border-t border-slate-800 space-y-3">
          <a
            href="/admin/character-generator"
            className="flex items-center gap-3 px-5 py-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-purple-500/30 hover:bg-slate-800/80 transition-all group"
          >
            <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
              <Wand2 className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-white">Character Generator</h3>
              <p className="text-xs text-slate-400">Test tool — compose modular spritesheets, skin tones and PNG export</p>
            </div>
          </a>
          <a
            href="/admin/rigs"
            className="flex items-center gap-3 px-5 py-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500/30 hover:bg-slate-800/80 transition-all group"
          >
            <div className="w-9 h-9 rounded-lg bg-cyan-500/10 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
              <Crosshair className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-white">Character Rig Controller</h3>
              <p className="text-xs text-slate-400">Rigs v2 — origin, collision body, hurt/hitboxes and damage per animation</p>
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
