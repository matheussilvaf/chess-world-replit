/**
 * Ponte folha composta ↔ Character Rig Controller: as caixas usadas no jogo
 * (hurtbox do rig + hitbox do perfil da arma) têm que sair EXATAMENTE do que
 * foi autorado no editor — casadas por coluna da folha, sem caixa inventada.
 */
import { describe, expect, it } from 'vitest';
import { SHEET_COLS } from '../../lib/character-generator/constants';
import {
  defaultRigConfig,
  emptyRigBoxGroup,
  type LocalRectangle,
  type RigConfig,
} from '../../shared/combat/RigShapes';
import { newWeaponProfileTemplate } from '../../shared/combat/WeaponShapes';
import {
  COMPOSED_MOVEMENT_TO_RIG_ANIMATION,
  RIG_DIRECTION_BY_ROW,
  composedFrameColumn,
  rigHurtboxRectsFor,
  rigLocalFrameForColumn,
  weaponFamilyFromRef,
  weaponHitboxRectsFor,
} from './composedRigFrames';

const rect = (id: string): LocalRectangle => ({ id, x: -8, y: -30, width: 16, height: 28 });

/** Rig padrão + hurtbox autorada em uma animação/direção/frame local. */
function rigWithHurtbox(anim: string, dir: 'south' | 'west' | 'east' | 'north', localFrame: number, r: LocalRectangle): RigConfig {
  const rig = defaultRigConfig();
  rig.animationConfigs[anim] = {
    directions: {
      [dir]: { frames: { [String(localFrame)]: { hurtbox: { enabled: true, rectangles: [r] }, hitbox: emptyRigBoxGroup() } } },
    },
  };
  return rig;
}

describe('composedRigFrames — ponte folha composta ↔ rig controller', () => {
  it('mapeia as linhas do pack (down/left/right/up) para as direções do rig (linhas 0-3)', () => {
    const rig = defaultRigConfig();
    expect(RIG_DIRECTION_BY_ROW.down).toBe('south');
    expect(RIG_DIRECTION_BY_ROW.left).toBe('west');
    expect(RIG_DIRECTION_BY_ROW.right).toBe('east');
    expect(RIG_DIRECTION_BY_ROW.up).toBe('north');
    // Coerência com o rig real: south=0, west=1, east=2, north=3.
    expect(rig.directions).toEqual({ south: 0, west: 1, east: 2, north: 3 });
  });

  it('extrai a coluna do índice global do frame (linha*23 + coluna)', () => {
    expect(composedFrameColumn(22)).toBe(22); // linha 0, última coluna
    expect(composedFrameColumn(SHEET_COLS)).toBe(0); // linha 1, coluna 0
    expect(composedFrameColumn(String(SHEET_COLS + 13))).toBe(13);
    expect(composedFrameColumn('abc')).toBeNull();
    expect(composedFrameColumn(-1)).toBeNull();
  });

  it('resolve o frame local pela coluna dentro da animação do rig', () => {
    const rig = defaultRigConfig();
    expect(rigLocalFrameForColumn(rig, 'attack-full', 12)).toBe(2); // [10,11,12,13,14]
    expect(rigLocalFrameForColumn(rig, 'attack', 12)).toBe(1); // [11,12,13]
    expect(rigLocalFrameForColumn(rig, 'walk', 1)).toBe(1); // [0,1,2,1] → primeira ocorrência
    expect(rigLocalFrameForColumn(rig, 'attack', 10)).toBeNull(); // coluna fora do recorte
    expect(rigLocalFrameForColumn(rig, 'nao-existe', 0)).toBeNull();
  });

  it('perfil autorado em `attack` funciona com a folha composta tocando `attack-full`', () => {
    const rig = defaultRigConfig();
    const profile = newWeaponProfileTemplate('espada-teste', 'Espada de teste', rig.rigId, 'attack');
    profile.directions.south = {
      frames: { '1': { hitbox: { enabled: true, rectangles: [rect('h1')] } } }, // local 1 = coluna 12
    };
    // Coluna 12 (frame do meio do attack-full) → local 1 de `attack` → caixa.
    expect(weaponHitboxRectsFor(rig, profile, 'south', 12)).toEqual([rect('h1')]);
    // Coluna 10 (wind-up) não existe em `attack` → sem hitbox, sem inventar.
    expect(weaponHitboxRectsFor(rig, profile, 'south', 10)).toEqual([]);
    // Direção sem frames autorados → vazio (leste NÃO é espelhado em runtime).
    expect(weaponHitboxRectsFor(rig, profile, 'east', 12)).toEqual([]);
  });

  it('grupo de hitbox desabilitado ou animação desconhecida → sem caixas', () => {
    const rig = defaultRigConfig();
    const off = newWeaponProfileTemplate('p2', 'P2', rig.rigId, 'attack');
    off.directions.south = { frames: { '1': { hitbox: { enabled: false, rectangles: [rect('x')] } } } };
    expect(weaponHitboxRectsFor(rig, off, 'south', 12)).toEqual([]);

    const orphan = newWeaponProfileTemplate('p3', 'P3', rig.rigId, 'anim-removida');
    expect(weaponHitboxRectsFor(rig, orphan, 'south', 12)).toEqual([]);
  });

  it('hurtbox do rig: movimento composto encontra a animação equivalente', () => {
    expect(COMPOSED_MOVEMENT_TO_RIG_ANIMATION.attack).toBe('attack-full');
    const r = rect('hb');
    // Autorada em attack-full → movimento `attack` na coluna 12 encontra.
    expect(rigHurtboxRectsFor(rigWithHurtbox('attack-full', 'south', 2, r), 'attack', 'south', 12)).toEqual([r]);
    // Autorada só em `attack` (recorte antigo) → fallback do movimento attack encontra.
    expect(rigHurtboxRectsFor(rigWithHurtbox('attack', 'south', 1, r), 'attack', 'south', 12)).toEqual([r]);
    // Walk coluna 1 → local 1 de [0,1,2,1].
    expect(rigHurtboxRectsFor(rigWithHurtbox('walk', 'west', 1, r), 'walk', 'west', 1)).toEqual([r]);
    // Pose parada (idle) usa `stand` (coluna 1).
    expect(rigHurtboxRectsFor(rigWithHurtbox('stand', 'north', 0, r), 'idle', 'north', 1)).toEqual([r]);
    // Direção não autorada → vazio.
    expect(rigHurtboxRectsFor(rigWithHurtbox('walk', 'west', 1, r), 'walk', 'east', 1)).toEqual([]);
  });
});

describe('weaponFamilyFromRef', () => {
  it('extrai a família de refs persistidas e rejeita todo o resto', () => {
    expect(weaponFamilyFromRef('gen:weapon/sword1')).toBe('sword1');
    expect(weaponFamilyFromRef('gen:weapon/sword1/c2')).toBe('sword1');
    expect(weaponFamilyFromRef('gen:weapon/iron_sword/default')).toBe('iron_sword');
    expect(weaponFamilyFromRef(null)).toBeNull();
    expect(weaponFamilyFromRef('')).toBeNull();
    expect(weaponFamilyFromRef(undefined)).toBeNull();
    expect(weaponFamilyFromRef('sword1')).toBeNull(); // asset id cru não é ref persistida
    expect(weaponFamilyFromRef('gen:weapon/UPPER')).toBeNull(); // fora do formato
  });
});
