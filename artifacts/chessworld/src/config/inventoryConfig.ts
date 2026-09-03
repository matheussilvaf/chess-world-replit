/** Shared inventory geometry. Keep this in one place so UI and hotbar agree. */
export const INVENTORY_COLUMNS = 5;
export const DEFAULT_INVENTORY_SLOT_COUNT = 25;

if (
  !Number.isInteger(INVENTORY_COLUMNS) ||
  !Number.isInteger(DEFAULT_INVENTORY_SLOT_COUNT) ||
  INVENTORY_COLUMNS < 1 ||
  DEFAULT_INVENTORY_SLOT_COUNT < INVENTORY_COLUMNS ||
  DEFAULT_INVENTORY_SLOT_COUNT % INVENTORY_COLUMNS !== 0
) {
  throw new Error('A capacidade do inventário deve ser um múltiplo positivo do número de colunas.');
}
