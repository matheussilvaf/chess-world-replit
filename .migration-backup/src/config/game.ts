export const GAME_CONFIG = {
  INITIAL_RATING: 500,
  WIN_RATING_GAIN: 8,
  LOSS_RATING_CHANGE: 0,
  DRAW_RATING_CHANGE: 0,
  TROPHIES_PER_WIN: 1,
  WORLD_WIDTH: 2560,
  WORLD_HEIGHT: 9600,
  PLAYER_SPEED: 3,
  PLAYER_SIZE: 24,
  BOARD_INTERACTION_RADIUS: 60,
  HOUSE_INTERACTION_RADIUS: 60,
};

export const REGIONS = [
  { id: 'europe', name: 'Europe', icon: '🏰', color: '#3B82F6' },
  { id: 'south_america', name: 'South America', icon: '🌴', color: '#10B981' },
  { id: 'asia', name: 'Asia', icon: '🏯', color: '#F59E0B' },
] as const;

export type Region = typeof REGIONS[number]['id'];

export const BOARD_THEMES = [
  { id: 'classic', name: 'Classic', light: '#F0D9B5', dark: '#B58863' },
  { id: 'green', name: 'Green', light: '#FFFFDD', dark: '#86A666' },
  { id: 'blue', name: 'Blue', light: '#DEE3E6', dark: '#788A94' },
  { id: 'gray', name: 'Gray', light: '#E8E8E8', dark: '#7D7D7D' },
  { id: 'purple', name: 'Purple', light: '#E8DAF5', dark: '#9B72CF' },
] as const;

export const PIECE_STYLES = [
  { id: 'classic', name: 'Classic' },
  { id: 'minimalist', name: 'Minimalist' },
] as const;
