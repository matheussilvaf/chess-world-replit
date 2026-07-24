import { create } from 'zustand';
import { supabase } from '../lib/supabase';

// Board (game-mode) zoom defaults. Desktop matches MAP_CONFIG.zoom.board;
// mobile is slightly zoomed out so the board doesn't touch the screen edges.
// The DB columns (board_zoom_desktop / board_zoom_mobile) may not exist yet —
// loading falls back to these defaults until the migration is applied.
export const BOARD_ZOOM_DESKTOP_DEFAULT = 3;
export const BOARD_ZOOM_MOBILE_DEFAULT = 2.5;

interface GameSettingsState {
  defaultZoom: number;
  playerSpeed: number;
  showDebugVisuals: boolean;
  boardZoomDesktop: number;
  boardZoomMobile: number;
  loaded: boolean;
  load: () => Promise<void>;
  subscribe: () => () => void;
}

type SettingsRow = {
  default_zoom?: number | null;
  player_speed?: number | null;
  show_debug_visuals?: boolean | null;
  board_zoom_desktop?: number | null;
  board_zoom_mobile?: number | null;
};

function mapRow(row: SettingsRow) {
  return {
    ...(row.default_zoom != null ? { defaultZoom: Number(row.default_zoom) } : {}),
    ...(row.player_speed != null ? { playerSpeed: Number(row.player_speed) } : {}),
    ...(row.show_debug_visuals != null ? { showDebugVisuals: Boolean(row.show_debug_visuals) } : {}),
    ...(row.board_zoom_desktop != null ? { boardZoomDesktop: Number(row.board_zoom_desktop) } : {}),
    ...(row.board_zoom_mobile != null ? { boardZoomMobile: Number(row.board_zoom_mobile) } : {}),
  };
}

export const useGameSettingsStore = create<GameSettingsState>((set) => ({
  defaultZoom: 2,
  playerSpeed: 3,
  showDebugVisuals: false,
  boardZoomDesktop: BOARD_ZOOM_DESKTOP_DEFAULT,
  boardZoomMobile: BOARD_ZOOM_MOBILE_DEFAULT,
  loaded: false,

  load: async () => {
    // select('*') so missing optional columns don't fail the whole query
    const { data, error } = await supabase
      .from('game_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) console.warn('[gameSettings] load error:', error.message);
    if (data) {
      set({ ...mapRow(data as SettingsRow), loaded: true });
    } else {
      set({ loaded: true });
    }
  },

  subscribe: () => {
    const channel = supabase
      .channel('game_settings_changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'game_settings', filter: 'id=eq.1' },
        (payload) => {
          set(mapRow(payload.new as SettingsRow));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
}));
