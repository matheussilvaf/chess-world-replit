import { supabase } from '../lib/supabase';
import { applyCharacterConfig } from '../game/characters/characterCatalog';

export async function loadCharacterConfigs() {
  const { data, error } = await supabase
    .from('character_configs')
    .select('*');

  if (error || !data) return;

  for (const row of data) {
    applyCharacterConfig(row.character_id, {
      origin_x: row.origin_x,
      origin_y: row.origin_y,
      body_offset_x: row.body_offset_x,
      body_offset_y: row.body_offset_y,
      body_radius: row.body_radius,
    });
  }
}
