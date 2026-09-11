import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BIGCHESS_BOARD,
  BIGCHESS_PIECES,
  BIGCHESS_SQUARES,
  DEFAULT_BIGCHESS_CONFIG,
  advanceBigChessPiece,
  applyBigChessDamage,
  bigChessCollectableCrowns,
  bigChessMaxHp,
  bigChessPieceFor,
  bigChessPieceItemKey,
  bigChessPieceView,
  bigChessSquareAt,
  bigChessSquareCenter,
  bigChessSquareFromTmjName,
  bigChessSquareRect,
  bigChessSquaresForItem,
  bigChessStartingPieceAt,
  cloneBigChessPieceRecord,
  equipBigChessItem,
  formatBigChessDuration,
  gateBigChessConfigByBadges,
  isBigChessPieceItemKey,
  isBigChessSquare,
  newBigChessPieceRecord,
  parseBigChessConfig,
  parseBigChessSlots,
  restoreBigChessPieceRecord,
  serializeBigChessSlots,
  type BigChessConfig,
} from './BigChessShapes';
import { BADGE_COUNTER_ATTACK, BADGE_COVER, BADGE_DEFENSE_PIECE, BADGE_HP_PLUS } from '../craft/CraftBadges';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function configWith(overrides: Partial<BigChessConfig>): BigChessConfig {
  return { ...DEFAULT_BIGCHESS_CONFIG, ...overrides };
}

function whiteRook(config: BigChessConfig = DEFAULT_BIGCHESS_CONFIG, now = 1_000_000) {
  return newBigChessPieceRecord(
    { region: 'craft:main', square: 'a1', itemKey: bigChessPieceItemKey('white', 'rook'), ownerId: 'u1', ownerName: 'Ana' },
    config,
    now,
  );
}

describe('peças do Big Chess Board — definições', () => {
  it('há 12 peças (6 tipos × 2 cores) com ids e imagens únicos', () => {
    expect(BIGCHESS_PIECES).toHaveLength(12);
    expect(new Set(BIGCHESS_PIECES.map((p) => p.itemId)).size).toBe(12);
    expect(new Set(BIGCHESS_PIECES.map((p) => p.imageUrl)).size).toBe(12);
    for (const def of BIGCHESS_PIECES) {
      expect(isBigChessPieceItemKey(def.itemId)).toBe(true);
      expect(bigChessPieceFor(def.itemId)).toEqual(def);
      expect(def.imageUrl).toMatch(/^\/assets\/CraftingWorld\/resources\/bischessboard-pieces\/(white|black)_[a-z]+\.png$/);
    }
    expect(isBigChessPieceItemKey('bigchess-red-rook')).toBe(false);
    expect(isBigChessPieceItemKey('gen:weapon/sword/wood')).toBe(false);
    expect(bigChessPieceFor(null)).toBeNull();
  });
});

describe('tabuleiro — casas', () => {
  it('64 casas, a1 embaixo à esquerda (brancas) e a8 em cima', () => {
    expect(BIGCHESS_SQUARES).toHaveLength(64);
    expect(isBigChessSquare('e4')).toBe(true);
    expect(isBigChessSquare('i1')).toBe(false);
    expect(isBigChessSquare('e9')).toBe(false);
    const a1 = bigChessSquareRect('a1');
    const a8 = bigChessSquareRect('a8');
    const h1 = bigChessSquareRect('h1');
    expect(a1.x).toBe(BIGCHESS_BOARD.x);
    expect(a8.y).toBe(BIGCHESS_BOARD.y);
    expect(a1.y).toBeGreaterThan(a8.y);
    expect(h1.x).toBeGreaterThan(a1.x);
  });

  it('centro de cada casa mapeia de volta para a mesma casa', () => {
    for (const square of BIGCHESS_SQUARES) {
      const c = bigChessSquareCenter(square);
      expect(bigChessSquareAt(c.x, c.y)).toBe(square);
    }
    expect(bigChessSquareAt(BIGCHESS_BOARD.x - 1, BIGCHESS_BOARD.y)).toBeNull();
    expect(bigChessSquareAt(BIGCHESS_BOARD.x + 8 * BIGCHESS_BOARD.square + 1, BIGCHESS_BOARD.y)).toBeNull();
  });

  it('nomes do TMJ "a_1" viram casas canônicas', () => {
    expect(bigChessSquareFromTmjName('a_1')).toBe('a1');
    expect(bigChessSquareFromTmjName(' h_8 ')).toBe('h8');
    expect(bigChessSquareFromTmjName('a1')).toBeNull();
    expect(bigChessSquareFromTmjName('z_1')).toBeNull();
    expect(bigChessSquareFromTmjName(3)).toBeNull();
  });

  it('a grade bate com os retângulos desenhados no crafting-world.tmj (tolerância 3 px)', () => {
    const tmjPath = resolve(__dirname, '../../../public/assets/CraftingWorld/map/crafting-world.tmj');
    const map = JSON.parse(readFileSync(tmjPath, 'utf8')) as { layers: unknown[] };
    type Layer = { name?: string; type?: string; layers?: Layer[]; objects?: { name: string; x: number; y: number; width: number; height: number }[] };
    const find = (layers: Layer[]): Layer | null => {
      for (const layer of layers) {
        if (layer.name === 'big_chess_table') return layer;
        if (layer.type === 'group' && layer.layers) {
          const nested = find(layer.layers);
          if (nested) return nested;
        }
      }
      return null;
    };
    const layer = find(map.layers as Layer[]);
    expect(layer?.objects).toHaveLength(64);
    const seen = new Set<string>();
    for (const obj of layer!.objects!) {
      const square = bigChessSquareFromTmjName(obj.name);
      expect(square, obj.name).not.toBeNull();
      seen.add(square!);
      const rect = bigChessSquareRect(square!);
      expect(Math.abs(obj.x - rect.x), `${square} x`).toBeLessThan(3);
      expect(Math.abs(obj.y - rect.y), `${square} y`).toBeLessThan(3);
      expect(Math.abs(obj.width - rect.width), `${square} w`).toBeLessThan(3);
      expect(Math.abs(obj.height - rect.height), `${square} h`).toBeLessThan(3);
    }
    expect(seen.size).toBe(64);
  });

  it('posição inicial: brancas nas fileiras 1–2, pretas nas 7–8, meio vazio', () => {
    expect(bigChessStartingPieceAt('a1')).toEqual({ color: 'white', type: 'rook' });
    expect(bigChessStartingPieceAt('e1')).toEqual({ color: 'white', type: 'king' });
    expect(bigChessStartingPieceAt('d8')).toEqual({ color: 'black', type: 'queen' });
    expect(bigChessStartingPieceAt('b7')).toEqual({ color: 'black', type: 'pawn' });
    expect(bigChessStartingPieceAt('e4')).toBeNull();
    expect(bigChessSquaresForItem(bigChessPieceItemKey('white', 'rook'))).toEqual(['a1', 'h1']);
    expect(bigChessSquaresForItem(bigChessPieceItemKey('black', 'pawn'))).toHaveLength(8);
    expect(bigChessSquaresForItem(bigChessPieceItemKey('black', 'king'))).toEqual(['e8']);
    expect(bigChessSquaresForItem('x')).toEqual([]);
  });
});

describe('config — parse', () => {
  it('aceita os defaults e rejeita valores fora da faixa', () => {
    const ok = parseBigChessConfig(JSON.parse(JSON.stringify(DEFAULT_BIGCHESS_CONFIG)));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.config).toEqual(DEFAULT_BIGCHESS_CONFIG);

    const bad = parseBigChessConfig({ ...DEFAULT_BIGCHESS_CONFIG, pieces: { ...DEFAULT_BIGCHESS_CONFIG.pieces, pawn: { ...DEFAULT_BIGCHESS_CONFIG.pieces.pawn, hp: 0 } } });
    expect(bad.ok).toBe(false);
    expect(parseBigChessConfig(null).ok).toBe(false);
  });

  it('capas e defesas são chaveadas por id de item válido', () => {
    const parsed = parseBigChessConfig({
      ...DEFAULT_BIGCHESS_CONFIG,
      covers: { 'iron-shield': { damageReductionPercent: 40, durationSec: 3600 } },
      defenses: { 'spike-trap': { durationSec: 600, hpPlusPercent: 0, counterAttack: { damage: 5, attackDurationSec: 10, radius: 120 } } },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config.covers['iron-shield'].damageReductionPercent).toBe(40);
      expect(parsed.config.defenses['spike-trap'].counterAttack?.radius).toBe(120);
    }
    const badKey = parseBigChessConfig({ ...DEFAULT_BIGCHESS_CONFIG, covers: { 'Not Valid Key!': { damageReductionPercent: 1, durationSec: 1 } } });
    expect(badKey.ok).toBe(false);
  });
});

describe('config — efeitos filtrados pelas badges', () => {
  const config = configWith({
    covers: { cape: { damageReductionPercent: 50, durationSec: 60 }, fake: { damageReductionPercent: 90, durationSec: 60 } },
    defenses: {
      spikes: { durationSec: 120, hpPlusPercent: 30, counterAttack: { damage: 7, attackDurationSec: 10, radius: 100 } },
      armor: { durationSec: 120, hpPlusPercent: 100, counterAttack: { damage: 9, attackDurationSec: 10, radius: 100 } },
      junk: { durationSec: 120, hpPlusPercent: 100, counterAttack: null },
    },
  });
  const badges: Record<string, string[]> = {
    cape: [BADGE_COVER],
    spikes: [BADGE_DEFENSE_PIECE, BADGE_COUNTER_ATTACK],
    armor: [BADGE_DEFENSE_PIECE, BADGE_HP_PLUS],
  };
  const hasBadge = (itemKey: string, badge: string) => badges[itemKey]?.includes(badge) ?? false;

  it('remove capas/defesas sem a badge e zera efeitos sem hp-plus / counter-attack', () => {
    const gated = gateBigChessConfigByBadges(config, hasBadge);
    expect(Object.keys(gated.covers)).toEqual(['cape']);
    expect(Object.keys(gated.defenses).sort()).toEqual(['armor', 'spikes']);
    expect(gated.defenses.spikes).toEqual({ durationSec: 120, hpPlusPercent: 0, counterAttack: { damage: 7, attackDurationSec: 10, radius: 100 } });
    expect(gated.defenses.armor).toEqual({ durationSec: 120, hpPlusPercent: 100, counterAttack: null });
    // Peças e anotações passam intactas; a config original não é mutada.
    expect(gated.pieces).toBe(config.pieces);
    expect(config.defenses.spikes.hpPlusPercent).toBe(30);
  });
});

describe('registro — snapshot e restauração', () => {
  it('clone é profundo e restore devolve o MESMO objeto ao estado anterior', () => {
    const now = 10_000;
    const config = configWith({ covers: { cape: { damageReductionPercent: 50, durationSec: 60 } } });
    const record = whiteRook(config, now);
    const before = cloneBigChessPieceRecord(record);
    expect(equipBigChessItem(record, config, 'cape', 'cover', now).ok).toBe(true);
    applyBigChessDamage(record, config, 100, now + 1);
    expect(before.cover).toBeNull();
    expect(record.cover).not.toBeNull();
    restoreBigChessPieceRecord(record, before);
    expect(record).toEqual(before);
    expect(record.cover).toBeNull();
    expect(record.hp).toBe(before.hp);
    // A restauração não compartilha arrays com o snapshot.
    record.defenses.push({ itemKey: 'x', expiresAt: now });
    expect(before.defenses).toHaveLength(0);
  });
});

describe('peça no mundo — avanço do tempo', () => {
  it('renda e pontos acumulam proporcionalmente ao tempo', () => {
    const now = 1_000_000;
    const record = whiteRook(DEFAULT_BIGCHESS_CONFIG, now);
    const rules = DEFAULT_BIGCHESS_CONFIG.pieces.rook;
    const result = advanceBigChessPiece(record, DEFAULT_BIGCHESS_CONFIG, now + DAY);
    expect(result.changed).toBe(true);
    expect(record.incomeAccrued).toBeCloseTo(rules.incomePerDay, 6);
    expect(record.points).toBeCloseTo(rules.pointsPerHour * 24, 6);
    expect(bigChessCollectableCrowns(record)).toBe(rules.incomePerDay);
    // Meio dia a mais: a fração fica guardada, coletável só o inteiro.
    advanceBigChessPiece(record, DEFAULT_BIGCHESS_CONFIG, now + DAY + DAY / 2 + 1);
    expect(bigChessCollectableCrowns(record)).toBe(Math.floor(rules.incomePerDay * 1.5));
  });

  it('regenera em intervalos inteiros sem dano e a âncora reseta ao apanhar', () => {
    const now = 1_000_000;
    const record = whiteRook(DEFAULT_BIGCHESS_CONFIG, now);
    const max = bigChessMaxHp(record, DEFAULT_BIGCHESS_CONFIG, now);
    applyBigChessDamage(record, DEFAULT_BIGCHESS_CONFIG, max / 2, now);
    expect(record.hp).toBe(max / 2);
    expect(record.regenAnchor).toBe(now);
    // 59 min: nada; 1 h: +10 %; 2 h 30: +20 % no total.
    advanceBigChessPiece(record, DEFAULT_BIGCHESS_CONFIG, now + 59 * 60_000);
    expect(record.hp).toBe(max / 2);
    advanceBigChessPiece(record, DEFAULT_BIGCHESS_CONFIG, now + HOUR);
    expect(record.hp).toBeCloseTo(max / 2 + max * 0.1, 6);
    advanceBigChessPiece(record, DEFAULT_BIGCHESS_CONFIG, now + 2.5 * HOUR);
    expect(record.hp).toBeCloseTo(max / 2 + max * 0.2, 6);
    // Dano no meio do intervalo zera a contagem.
    applyBigChessDamage(record, DEFAULT_BIGCHESS_CONFIG, 1, now + 2.5 * HOUR);
    advanceBigChessPiece(record, DEFAULT_BIGCHESS_CONFIG, now + 3.4 * HOUR);
    expect(record.hp).toBeCloseTo(max / 2 + max * 0.2 - 1, 6);
    // Nunca passa do máximo.
    advanceBigChessPiece(record, DEFAULT_BIGCHESS_CONFIG, now + 100 * HOUR);
    expect(record.hp).toBe(max);
    expect(bigChessPieceView(record, DEFAULT_BIGCHESS_CONFIG, now + 100 * HOUR).nextRegenAt).toBe(0);
  });

  it('intervalo de teste (15 s) regenera rápido', () => {
    const config = configWith({ pieces: { ...DEFAULT_BIGCHESS_CONFIG.pieces, rook: { ...DEFAULT_BIGCHESS_CONFIG.pieces.rook, regenIntervalSec: 15, regenPercent: 50 } } });
    const now = 5_000;
    const record = whiteRook(config, now);
    applyBigChessDamage(record, config, 150, now);
    advanceBigChessPiece(record, config, now + 15_000);
    expect(record.hp).toBe(300);
  });
});

describe('peça no mundo — dano, capa e contra-ataque', () => {
  const config = configWith({
    covers: { cape: { damageReductionPercent: 50, durationSec: 60 } },
    defenses: {
      spikes: { durationSec: 120, hpPlusPercent: 0, counterAttack: { damage: 7, attackDurationSec: 10, radius: 100 } },
      armor: { durationSec: 120, hpPlusPercent: 100, counterAttack: null },
    },
  });

  it('capa reduz o dano enquanto vale; item repetido soma duração', () => {
    const now = 10_000;
    const record = whiteRook(config, now);
    const first = equipBigChessItem(record, config, 'cape', 'cover', now);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.expiresAt).toBe(now + 60_000);
    const again = equipBigChessItem(record, config, 'cape', 'cover', now + 1_000);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.expiresAt).toBe(now + 120_000);
    const hit = applyBigChessDamage(record, config, 100, now + 2_000);
    expect(hit.damage).toBe(50);
    expect(record.hp).toBe(250);
    // Capa vencida: dano cheio.
    advanceBigChessPiece(record, config, now + 121_000);
    expect(record.cover).toBeNull();
    const full = applyBigChessDamage(record, config, 100, now + 121_000);
    expect(full.damage).toBe(100);
  });

  it('slots de defesa: 2 no máximo, item diferente com slot cheio é recusado', () => {
    const now = 10_000;
    const record = whiteRook(config, now);
    expect(equipBigChessItem(record, config, 'spikes', 'defense', now).ok).toBe(true);
    expect(equipBigChessItem(record, config, 'armor', 'defense', now).ok).toBe(true);
    const third = equipBigChessItem(record, config, 'cape', 'defense', now);
    expect(third.ok).toBe(false);
    expect(equipBigChessItem(record, config, 'spikes', 'defense', now).ok).toBe(true); // repetido soma
    expect(record.defenses).toHaveLength(2);
    expect(record.defenses.find((d) => d.itemKey === 'spikes')?.expiresAt).toBe(now + 240_000);
    // Capa não entra como defesa nem vice-versa.
    expect(equipBigChessItem(record, config, 'spikes', 'cover', now).ok).toBe(false);
  });

  it('hp-plus aumenta o máximo e o HP atual; ao vencer o HP volta ao teto', () => {
    const now = 10_000;
    const record = whiteRook(config, now);
    const equip = equipBigChessItem(record, config, 'armor', 'defense', now);
    expect(equip.ok).toBe(true);
    expect(bigChessMaxHp(record, config, now)).toBe(600);
    expect(record.hp).toBe(600);
    advanceBigChessPiece(record, config, now + 121_000);
    expect(record.defenses).toHaveLength(0);
    expect(record.hp).toBe(300);
  });

  it('golpe dispara contra-ataque uma vez por rajada e destruição zera a peça', () => {
    const now = 10_000;
    const record = whiteRook(config, now);
    equipBigChessItem(record, config, 'spikes', 'defense', now);
    const hit = applyBigChessDamage(record, config, 10, now);
    expect(hit.counter?.itemKey).toBe('spikes');
    expect(record.counterUntil).toBe(now + 10_000);
    const second = applyBigChessDamage(record, config, 10, now + 1_000);
    expect(second.counter).toBeNull();
    advanceBigChessPiece(record, config, now + 11_000);
    expect(record.counterUntil).toBe(0);
    const kill = applyBigChessDamage(record, config, 10_000, now + 11_000);
    expect(kill.destroyed).toBe(true);
    expect(record.hp).toBe(0);
  });
});

describe('visão e serialização', () => {
  it('view expõe só defesas vigentes, taxas e syncedAt', () => {
    const config = configWith({ covers: { cape: { damageReductionPercent: 10, durationSec: 5 } } });
    const now = 10_000;
    const record = whiteRook(config, now);
    equipBigChessItem(record, config, 'cape', 'cover', now);
    const live = bigChessPieceView(record, config, now + 1_000);
    expect(live.cover?.itemKey).toBe('cape');
    expect(live.incomePerDay).toBe(DEFAULT_BIGCHESS_CONFIG.pieces.rook.incomePerDay);
    expect(live.syncedAt).toBe(now + 1_000);
    const later = bigChessPieceView(record, config, now + 6_000);
    expect(later.cover).toBeNull();
  });

  it('slots vão e voltam de JSON, lixo vira lista vazia', () => {
    const slots = [{ itemKey: 'a', expiresAt: 5 }, { itemKey: 'b', expiresAt: 9 }];
    expect(parseBigChessSlots(serializeBigChessSlots(slots))).toEqual(slots);
    expect(serializeBigChessSlots([])).toBe('');
    expect(parseBigChessSlots('')).toEqual([]);
    expect(parseBigChessSlots('{bad')).toEqual([]);
    expect(parseBigChessSlots(42)).toEqual([]);
  });

  it('formata durações de forma legível', () => {
    expect(formatBigChessDuration(15)).toBe('15s');
    expect(formatBigChessDuration(90)).toBe('1m 30s');
    expect(formatBigChessDuration(3_600)).toBe('1h 00m');
    expect(formatBigChessDuration(90_000)).toBe('1d 01h');
    expect(formatBigChessDuration(-5)).toBe('0s');
  });
});
