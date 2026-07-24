import { useAuthStore } from '../../stores/authStore';
import { useGameStore } from '../../stores/gameStore';
import { supabase } from '../../lib/supabase';
import { BOARD_THEMES, PIECE_STYLES } from '../../config/game';
import { X, Palette, Check } from 'lucide-react';

export function SettingsModal() {
  const { profile, refreshProfile } = useAuthStore();
  const { showSettings, toggleSettings } = useGameStore();

  if (!showSettings || !profile) return null;

  const handleThemeChange = async (themeId: string) => {
    await supabase.from('profiles').update({
      board_theme: themeId,
      updated_at: new Date().toISOString(),
    }).eq('user_id', profile.user_id);
    refreshProfile();
  };

  const handlePieceStyleChange = async (styleId: string) => {
    await supabase.from('profiles').update({
      piece_style: styleId,
      updated_at: new Date().toISOString(),
    }).eq('user_id', profile.user_id);
    refreshProfile();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Palette className="w-5 h-5 text-amber-400" />
            Settings
          </h3>
          <button onClick={toggleSettings} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Board Theme */}
          <div>
            <h4 className="text-white font-medium mb-3">Board Theme</h4>
            <div className="grid grid-cols-2 gap-2">
              {BOARD_THEMES.map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => handleThemeChange(theme.id)}
                  className={`relative p-3 rounded-lg border transition-all ${
                    profile.board_theme === theme.id
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-slate-700 hover:border-slate-500'
                  }`}
                >
                  <div className="grid grid-cols-4 gap-0.5 w-16 h-16 mx-auto mb-2 rounded overflow-hidden">
                    {Array.from({ length: 16 }).map((_, i) => {
                      const row = Math.floor(i / 4);
                      const col = i % 4;
                      const isLight = (row + col) % 2 === 0;
                      return (
                        <div key={i} style={{ backgroundColor: isLight ? theme.light : theme.dark }} />
                      );
                    })}
                  </div>
                  <span className="text-white text-xs">{theme.name}</span>
                  {profile.board_theme === theme.id && (
                    <div className="absolute top-1 right-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Piece Style */}
          <div>
            <h4 className="text-white font-medium mb-3">Piece Style</h4>
            <div className="grid grid-cols-2 gap-2">
              {PIECE_STYLES.map((style) => (
                <button
                  key={style.id}
                  onClick={() => handlePieceStyleChange(style.id)}
                  className={`p-3 rounded-lg border transition-all ${
                    profile.piece_style === style.id
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-slate-700 hover:border-slate-500'
                  }`}
                >
                  <div className="text-2xl mb-1 text-center">
                    {style.id === 'classic' ? '\u2654\u265A' : '\u2654\u265A'}
                  </div>
                  <span className="text-white text-xs">{style.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
