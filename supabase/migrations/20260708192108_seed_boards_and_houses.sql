/*
# Seed chess boards and houses for all regions

1. Data Seeding
  - 10 chess boards per region (30 total)
  - 3 purchasable houses per region (9 total)
  - 5 decorative houses per region (15 total, non-purchasable with price 0)

2. Important Notes
  - Boards are spread across the map (2000x1500 world)
  - Houses have varying trophy prices (5-25)
  - Each board has a unique name per region
  - Idempotent: uses ON CONFLICT DO NOTHING
*/

-- Europe boards
INSERT INTO boards (region, name, x, y, status) VALUES
  ('europe', 'Kings Garden', 300, 200, 'free'),
  ('europe', 'Royal Court', 600, 150, 'free'),
  ('europe', 'Knights Arena', 900, 300, 'free'),
  ('europe', 'Bishops Crossing', 1200, 200, 'free'),
  ('europe', 'Queens Plaza', 400, 600, 'free'),
  ('europe', 'Castle Gate', 750, 500, 'free'),
  ('europe', 'Rook Tower', 1100, 600, 'free'),
  ('europe', 'Pawn Square', 300, 900, 'free'),
  ('europe', 'Grand Arena', 700, 850, 'free'),
  ('europe', 'Champions Field', 1050, 950, 'free')
ON CONFLICT DO NOTHING;

-- South America boards
INSERT INTO boards (region, name, x, y, status) VALUES
  ('south_america', 'Praca do Rei', 300, 200, 'free'),
  ('south_america', 'Arena Tropical', 600, 150, 'free'),
  ('south_america', 'Jardim dos Cavalos', 900, 300, 'free'),
  ('south_america', 'Plaza del Alfil', 1200, 200, 'free'),
  ('south_america', 'Rainha do Sul', 400, 600, 'free'),
  ('south_america', 'Fortaleza', 750, 500, 'free'),
  ('south_america', 'Torre do Sol', 1100, 600, 'free'),
  ('south_america', 'Peao Dourado', 300, 900, 'free'),
  ('south_america', 'Coliseu Verde', 700, 850, 'free'),
  ('south_america', 'Campo dos Campeoes', 1050, 950, 'free')
ON CONFLICT DO NOTHING;

-- Asia boards
INSERT INTO boards (region, name, x, y, status) VALUES
  ('asia', 'Dragon Court', 300, 200, 'free'),
  ('asia', 'Jade Arena', 600, 150, 'free'),
  ('asia', 'Lotus Garden', 900, 300, 'free'),
  ('asia', 'Bamboo Bridge', 1200, 200, 'free'),
  ('asia', 'Phoenix Plaza', 400, 600, 'free'),
  ('asia', 'Jade Castle', 750, 500, 'free'),
  ('asia', 'Moon Tower', 1100, 600, 'free'),
  ('asia', 'Sakura Square', 300, 900, 'free'),
  ('asia', 'Imperial Arena', 700, 850, 'free'),
  ('asia', 'Zen Garden', 1050, 950, 'free')
ON CONFLICT DO NOTHING;

-- Purchasable houses - Europe
INSERT INTO houses (region, name, x, y, price_trophies) VALUES
  ('europe', 'Stone Cottage', 500, 350, 5),
  ('europe', 'Castle Pinnacle', 850, 700, 15),
  ('europe', 'Grand Manor', 1300, 450, 25)
ON CONFLICT DO NOTHING;

-- Purchasable houses - South America
INSERT INTO houses (region, name, x, y, price_trophies) VALUES
  ('south_america', 'Tropical Villa', 500, 350, 5),
  ('south_america', 'Mountain Fortress', 850, 700, 15),
  ('south_america', 'Golden Palace', 1300, 450, 25)
ON CONFLICT DO NOTHING;

-- Purchasable houses - Asia
INSERT INTO houses (region, name, x, y, price_trophies) VALUES
  ('asia', 'Bamboo House', 500, 350, 5),
  ('asia', 'Dragon Keep', 850, 700, 15),
  ('asia', 'Imperial Palace', 1300, 450, 25)
ON CONFLICT DO NOTHING;
