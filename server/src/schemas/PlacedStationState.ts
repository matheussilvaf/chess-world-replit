import { Schema, defineTypes } from '@colyseus/schema';

/**
 * Estação portátil posicionada no mapa (pública para todos; só o dono e os
 * autorizados usam). Ver shared/craft/PlaceableStations para as regras.
 */
export class PlacedStationState extends Schema {
  id = '';
  /** Craft item embutido (ex.: "fornalha-portatil"). */
  itemKey = '';
  /** Estação pública cujo card ela abre (ex.: "fornalha"). */
  stationId = '';
  ownerId = '';
  ownerName = '';
  /** Âncora no mundo = centro da base do corpo (ver placedStationRect). */
  x = 0;
  y = 0;
  /** Crafts restantes (0 = sem durabilidade: não usa, mas recolhe). */
  durability = 0;
  maxDurability = 0;
  placedAt = 0;
  /** Epoch ms (relógio do servidor) em que deixa de ter dono e vira drop. */
  expiresAt = 0;
  /** Ids de jogadores com permissão de USO, separados por vírgula. */
  allowed = '';
}

defineTypes(PlacedStationState, {
  id: 'string',
  itemKey: 'string',
  stationId: 'string',
  ownerId: 'string',
  ownerName: 'string',
  x: 'number',
  y: 'number',
  durability: 'number',
  maxDurability: 'number',
  placedAt: 'number',
  expiresAt: 'number',
  allowed: 'string',
});
