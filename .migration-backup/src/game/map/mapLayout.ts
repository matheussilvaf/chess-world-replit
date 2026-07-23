// Map dimensions - smaller for better performance
export const MAP_WIDTH = 2000;
export const MAP_HEIGHT = 1500;
export const TILE_SIZE = 16;
export const SPAWN_X = 1000;
export const SPAWN_Y = 750;

export interface ArenaData {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface HouseData {
  id: string;
  name: string;
  price: number;
  x: number;
  y: number;
  variant: 'house1' | 'house2';
}

// Chess arenas - 10 total
export const ARENAS: ArenaData[] = [
  { id: 'arena_1', name: 'Praca do Rei', x: 900, y: 680 },
  { id: 'arena_2', name: 'Arena Central', x: 1100, y: 680 },
  { id: 'arena_3', name: 'Jardim dos Cavalos', x: 1500, y: 350 },
  { id: 'arena_4', name: 'Campo Real', x: 1700, y: 400 },
  { id: 'arena_5', name: 'Trono do Bispo', x: 1500, y: 550 },
  { id: 'arena_6', name: 'Corte dos Peoes', x: 1700, y: 600 },
  { id: 'arena_7', name: 'Arena do Lago', x: 450, y: 1100 },
  { id: 'arena_8', name: 'Pedra Sagrada', x: 300, y: 1300 },
  { id: 'arena_9', name: 'Clareira Oculta', x: 1600, y: 1100 },
  { id: 'arena_10', name: 'Altar Selvagem', x: 1800, y: 1300 },
];

// Houses - 8 total
export const HOUSES: HouseData[] = [
  { id: 'house_1', name: 'Casa Esmeralda', price: 5, x: 300, y: 350, variant: 'house1' },
  { id: 'house_2', name: 'Vila Dourada', price: 10, x: 550, y: 300, variant: 'house2' },
  { id: 'house_3', name: 'Mansao Azul', price: 15, x: 300, y: 550, variant: 'house1' },
  { id: 'house_4', name: 'Palacio Rubi', price: 20, x: 550, y: 520, variant: 'house2' },
  { id: 'house_5', name: 'Fortaleza Real', price: 25, x: 420, y: 430, variant: 'house2' },
  { id: 'house_6', name: 'Cabana do Lago', price: 8, x: 200, y: 1050, variant: 'house1' },
  { id: 'house_7', name: 'Torre da Floresta', price: 12, x: 1850, y: 1050, variant: 'house1' },
  { id: 'house_8', name: 'Castelo do Jardim', price: 18, x: 1600, y: 250, variant: 'house2' },
];

// Slime positions
export const SLIMES: { x: number; y: number }[] = [
  { x: 1700, y: 1150 }, { x: 1850, y: 1250 },
  { x: 1600, y: 1300 }, { x: 450, y: 1250 },
  { x: 350, y: 1350 }, { x: 1300, y: 1000 },
  { x: 150, y: 700 }, { x: 1900, y: 500 },
];
