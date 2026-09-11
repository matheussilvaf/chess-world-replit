import { Schema, defineTypes } from '@colyseus/schema';

/**
 * Peça do Big Chess Board posicionada (chave do MapSchema = casa, ex. "e1").
 * Espelho de `BigChessPieceView` (shared/bigchess) — números acumulados são
 * republicados a cada tick da sala; o cliente extrapola a partir de `syncedAt`.
 */
export class BigChessPieceState extends Schema {
  square = '';
  /** Craft item embutido (ex.: "bigchess-white-rook"). */
  itemKey = '';
  ownerId = '';
  ownerName = '';
  hp = 0;
  maxHp = 0;
  placedAt = 0;
  /** Próximo tick de regeneração (0 = HP cheio ou regeneração desligada). */
  nextRegenAt = 0;
  incomeAccrued = 0;
  incomeCollected = 0;
  incomePerDay = 0;
  points = 0;
  pointsPerHour = 0;
  /** Capa ativa ('' = nenhuma) e vencimento. */
  coverItemKey = '';
  coverExpiresAt = 0;
  /** Itens de defesa ativos (JSON: [[itemKey, expiresAt], …]; '' = nenhum). */
  defenses = '';
  /** Rajada de contra-ataque ativa até este instante (0 = inativa). */
  counterUntil = 0;
  syncedAt = 0;
}

defineTypes(BigChessPieceState, {
  square: 'string',
  itemKey: 'string',
  ownerId: 'string',
  ownerName: 'string',
  hp: 'number',
  maxHp: 'number',
  placedAt: 'number',
  nextRegenAt: 'number',
  incomeAccrued: 'number',
  incomeCollected: 'number',
  incomePerDay: 'number',
  points: 'number',
  pointsPerHour: 'number',
  coverItemKey: 'string',
  coverExpiresAt: 'number',
  defenses: 'string',
  counterUntil: 'number',
  syncedAt: 'number',
});
