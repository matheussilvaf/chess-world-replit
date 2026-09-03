/**
 * Estações de criação (Forja, Mesa de Crafting, Fornalha, Estação de Poções)
 * — shapes/validadores compartilhados (spec: /admin/stations).
 *
 * Uma ESTAÇÃO é o painel que abre no jogo quando o jogador encosta na
 * bancada correspondente. O admin (/admin/stations) configura:
 *   - as ABAS de cada estação (criadas dinamicamente; NENHUMA por padrão);
 *   - o rótulo do botão de criação POR ABA (padrão "Criar");
 *   - o LAYOUT dos itens: linhas (string[][] de ids canônicos do craft — ver
 *     CraftShapes) montadas por arrastar-e-soltar. Cada linha vira um scroll
 *     horizontal no jogo; o jogador vê até 3 linhas e rola verticalmente.
 *
 * A QUAL estação um item pertence mora em `craft_station_members`
 * (item_id → station_id), escolhido no select do card do item em /admin/craft.
 * O layout (rows) referencia esses itens; referência pendurada (item que
 * trocou de estação ou perdeu o vínculo) é TOLERADA no banco e FILTRADA na
 * renderização — o próximo save do layout se auto-cura. Sem transação no
 * PostgREST, essa é a mesma política do delete de craft items.
 *
 * As 4 estações padrão existem SEMPRE: o GET mescla os defaults de código com
 * as linhas do banco (linha ausente = default puro; o primeiro PUT persiste).
 * Criar/excluir estações NÃO é suportado — só as 4 fixas.
 *
 * Mirrored byte-identical in:
 *   - artifacts/chessworld/src/shared/craft/StationShapes.ts   (client)
 *   - server/src/shared/craft/StationShapes.ts                 (Colyseus server)
 *   - artifacts/api-server/src/src/shared/craft/StationShapes.ts
 * Keep it free of Phaser/DOM/Node dependencies.
 */
import { classifyCraftEntityId, type CraftValidation } from './CraftShapes.js';

/** Ids fixos das 4 estações (ordem oficial de exibição). */
export const STATION_IDS = [
  'forja',
  'mesa-de-crafting',
  'fornalha',
  'estacao-de-pocoes',
] as const;
export type StationId = (typeof STATION_IDS)[number];

const STATION_ID_SET: ReadonlySet<string> = new Set(STATION_IDS);
export function isStationId(id: unknown): id is StationId {
  return typeof id === 'string' && STATION_ID_SET.has(id);
}

/** Ícones suportados (o cliente mapeia a chave para o componente lucide). */
export const STATION_ICON_KEYS = ['hammer', 'tools', 'flame', 'flask'] as const;
export type StationIconKey = (typeof STATION_ICON_KEYS)[number];

export const MAX_STATION_NAME_LEN = 48;
export const MAX_STATION_TABS = 12;
export const MAX_TAB_NAME_LEN = 24;
export const MAX_BUTTON_LABEL_LEN = 24;
export const MAX_LAYOUT_ROWS = 30;
export const MAX_ROW_ITEMS = 40;
export const DEFAULT_BUTTON_LABEL = 'Criar';
export const TAB_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const STATION_COLOR_RE = /^#[0-9a-f]{6}$/i;

export interface StationTabConfig {
  /** Slug estável (gerado do nome na criação; nunca muda depois). */
  id: string;
  /** Nome exibido na aba. */
  name: string;
  /** Rótulo do botão de criação DESTA aba ("Criar", "Fundir", "Forjar"…). */
  buttonLabel: string;
  /**
   * Linhas de itens: cada linha é uma lista ordenada de ids canônicos do
   * craft (ref gen:, chave de recurso ou slug de craft item). Linhas vazias
   * nunca são persistidas.
   */
  rows: string[][];
}

export interface StationConfig {
  stationId: StationId | string;
  name: string;
  icon: StationIconKey;
  /** Cor tema do cabeçalho/realces (hex #rrggbb). */
  color: string;
  /** Ordem de exibição entre estações (0..99). */
  sortIndex: number;
  /** Abas criadas no admin — nenhuma por padrão. */
  tabs: StationTabConfig[];
}

/** Defaults de código das 4 estações (tabs vazias — o admin cria as suas). */
export function defaultStationConfigs(): Record<string, StationConfig> {
  const defaults: StationConfig[] = [
    { stationId: 'forja', name: 'Forja', icon: 'hammer', color: '#b03330', sortIndex: 0, tabs: [] },
    {
      stationId: 'mesa-de-crafting',
      name: 'Mesa de Crafting',
      icon: 'tools',
      color: '#8f4526',
      sortIndex: 1,
      tabs: [],
    },
    { stationId: 'fornalha', name: 'Fornalha', icon: 'flame', color: '#d98324', sortIndex: 2, tabs: [] },
    {
      stationId: 'estacao-de-pocoes',
      name: 'Estação de Poções',
      icon: 'flask',
      color: '#6c5ed6',
      sortIndex: 3,
      tabs: [],
    },
  ];
  return Object.fromEntries(defaults.map((s) => [s.stationId, s]));
}

/**
 * Mescla linhas do banco sobre os defaults e devolve a lista na ordem oficial
 * (sortIndex, empate por id). Linha desconhecida no banco é ignorada aqui —
 * o repositório já a reporta em invalidIds.
 */
export function mergeStationsWithDefaults(
  records: Readonly<Record<string, StationConfig>>,
): StationConfig[] {
  const merged = defaultStationConfigs();
  for (const [id, config] of Object.entries(records)) {
    if (STATION_ID_SET.has(id)) merged[id] = config;
  }
  return Object.values(merged).sort(
    (a, b) => a.sortIndex - b.sortIndex || String(a.stationId).localeCompare(String(b.stationId)),
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Deriva um id de aba estável a partir do nome ("Vestes" → "vestes"),
 * desviando de ids já usados com sufixo numérico ("vestes-2").
 */
export function tabIdFromName(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'aba';
  if (!taken.has(base) && TAB_ID_RE.test(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate) && TAB_ID_RE.test(candidate)) return candidate;
  }
  return `aba-${Date.now() % 100000}`;
}

/** Valida um StationConfig completo (abas + layout). */
export function validateStationConfig(value: unknown): CraftValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['config: objeto esperado'] };

  if (!isStationId(value.stationId)) {
    errors.push(`stationId: uma das estações fixas (${STATION_IDS.join(', ')})`);
  }
  const name = value.name;
  if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > MAX_STATION_NAME_LEN) {
    errors.push(`name: obrigatório, 1–${MAX_STATION_NAME_LEN} caracteres`);
  }
  if (
    typeof value.icon !== 'string' ||
    !(STATION_ICON_KEYS as readonly string[]).includes(value.icon)
  ) {
    errors.push(`icon: uma das chaves ${STATION_ICON_KEYS.join(', ')}`);
  }
  if (typeof value.color !== 'string' || !STATION_COLOR_RE.test(value.color)) {
    errors.push('color: hex #rrggbb');
  }
  if (!isInt(value.sortIndex) || value.sortIndex < 0 || value.sortIndex > 99) {
    errors.push('sortIndex: inteiro 0–99');
  }

  const tabs = value.tabs;
  if (!Array.isArray(tabs) || tabs.length > MAX_STATION_TABS) {
    errors.push(`tabs: lista de 0–${MAX_STATION_TABS} abas`);
    return { ok: false, errors };
  }
  const tabIds = new Set<string>();
  const placedItems = new Set<string>();
  for (const [t, tab] of tabs.entries()) {
    if (!isRecord(tab)) {
      errors.push(`tabs[${t}]: objeto esperado`);
      continue;
    }
    const id = tab.id;
    if (typeof id !== 'string' || !TAB_ID_RE.test(id)) {
      errors.push(`tabs[${t}].id: slug minúsculo de até 32 caracteres`);
    } else if (tabIds.has(id)) {
      errors.push(`tabs[${t}].id: repetido ("${id}")`);
    } else {
      tabIds.add(id);
    }
    const tabName = tab.name;
    if (
      typeof tabName !== 'string' ||
      tabName.trim().length === 0 ||
      tabName.trim().length > MAX_TAB_NAME_LEN
    ) {
      errors.push(`tabs[${t}].name: obrigatório, 1–${MAX_TAB_NAME_LEN} caracteres`);
    }
    const label = tab.buttonLabel;
    if (
      typeof label !== 'string' ||
      label.trim().length === 0 ||
      label.trim().length > MAX_BUTTON_LABEL_LEN
    ) {
      errors.push(`tabs[${t}].buttonLabel: obrigatório, 1–${MAX_BUTTON_LABEL_LEN} caracteres`);
    }
    const rows = tab.rows;
    if (!Array.isArray(rows) || rows.length > MAX_LAYOUT_ROWS) {
      errors.push(`tabs[${t}].rows: lista de 0–${MAX_LAYOUT_ROWS} linhas`);
      continue;
    }
    for (const [r, row] of rows.entries()) {
      if (!Array.isArray(row) || row.length === 0 || row.length > MAX_ROW_ITEMS) {
        errors.push(`tabs[${t}].rows[${r}]: linha com 1–${MAX_ROW_ITEMS} itens`);
        continue;
      }
      for (const [c, itemId] of row.entries()) {
        if (typeof itemId !== 'string' || classifyCraftEntityId(itemId) === null) {
          errors.push(`tabs[${t}].rows[${r}][${c}]: id de item inválido`);
          continue;
        }
        if (placedItems.has(itemId)) {
          errors.push(`tabs[${t}].rows[${r}][${c}]: item posicionado duas vezes ("${itemId}")`);
        }
        placedItems.add(itemId);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Valida um vínculo item→estação (select do card em /admin/craft).
 * Retorna a mensagem de erro ou null quando válido; stationId null = remover.
 */
export function validateStationMemberAssignment(
  itemId: unknown,
  stationId: unknown,
): string | null {
  if (typeof itemId !== 'string' || classifyCraftEntityId(itemId) === null) {
    return 'itemId: id de item inválido (ref gen:, chave de recurso ou slug de craft item)';
  }
  if (stationId === null) return null;
  if (!isStationId(stationId)) {
    return `stationId: null ou uma das estações fixas (${STATION_IDS.join(', ')})`;
  }
  return null;
}
