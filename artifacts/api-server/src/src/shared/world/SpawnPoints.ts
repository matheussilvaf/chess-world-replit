/**
 * Pontos de spawn conhecidos pelo SERVIDOR (que não carrega os .tmj).
 *
 * O servidor é a autoridade da posição: o cliente nunca escolhe x/y ao entrar
 * numa sala — ele só pode indicar um `spawnId` desta lista e o servidor resolve
 * a coordenada. Sem isso, quem entra na Academia/Recepção nascia no spawn do
 * mundo (a ~1400 px de distância) e o guard de movimento rejeitava todos os
 * `move_to` seguintes: para os outros jogadores o personagem ficava congelado
 * no ponto errado do mapa.
 *
 * Coordenadas copiadas dos objetos da camada `spawns` dos mapas em
 * `public/assets/world-v2/*.tmj` (main_world, tournament_reception,
 * tactics-academy). Ao mover um spawn no Tiled, atualize aqui também.
 */

export interface SpawnPoint {
  x: number;
  y: number;
}

/** Sala `world`, região principal: `spawnId` → posição (main_world.tmj). */
export const MAIN_WORLD_SPAWNS: Readonly<Record<string, SpawnPoint>> = {
  main_player_spawn: { x: 1273.42, y: 926.01 },
  tactics_academy_exit: { x: 1283.45, y: 2848.38 },
  tournament_arena_exit: { x: 1280.71, y: 336.47 },
  analysis_school_exit: { x: 735.15, y: 2231.17 },
  game_shop_exit: { x: 1813.41, y: 2247.02 },
  club_district_portal_return: { x: 1277.29, y: 3494.81 },
  main_village_gateway_return: { x: 1427.13, y: 3917.32 },
};

export const MAIN_WORLD_DEFAULT_SPAWN_ID = 'main_player_spawn';

/** Sala `world`, regiões `craft:*` (Mundo de Coleta — único ponto de entrada). */
export const CRAFT_WORLD_SPAWN: SpawnPoint = { x: 3256, y: 2246.67 };

/** Salas internas: um único spawn de entrada por sala. */
export const INTERIOR_ROOM_SPAWNS: Readonly<Record<'arena' | 'academy', SpawnPoint>> = {
  /** tournament_reception.tmj → tournament_reception_entry_spawn */
  arena: { x: 719.78, y: 721.84 },
  /** tactics-academy.tmj → tactics_academy_entry_spawn */
  academy: { x: 719.78, y: 2225.84 },
};

export type SpawnRoomName = 'world' | 'arena' | 'academy';

export function isSpawnRoomName(v: unknown): v is SpawnRoomName {
  return v === 'world' || v === 'arena' || v === 'academy';
}

/**
 * Resolve onde um jogador nasce ao entrar numa sala.
 * - salas internas ignoram `spawnId` (só há um ponto de entrada);
 * - regiões `craft:*` idem;
 * - no mundo principal, `spawnId` desconhecido cai no spawn padrão.
 */
export function resolveJoinSpawn(roomName: SpawnRoomName, region: string, spawnId?: unknown): SpawnPoint {
  if (roomName !== 'world') return INTERIOR_ROOM_SPAWNS[roomName];
  if (region.startsWith('craft:')) return CRAFT_WORLD_SPAWN;
  const id = typeof spawnId === 'string' ? spawnId : MAIN_WORLD_DEFAULT_SPAWN_ID;
  return MAIN_WORLD_SPAWNS[id] ?? MAIN_WORLD_SPAWNS[MAIN_WORLD_DEFAULT_SPAWN_ID];
}
