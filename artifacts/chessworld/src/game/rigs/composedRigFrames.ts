/**
 * Ponte entre as folhas COMPOSTAS do gerador de personagens (defs `pc-<hash>`)
 * e o Character Rig Controller (/admin/rigs) — recupera, para o frame que o
 * sprite está mostrando AGORA, as caixas autoradas no editor:
 *   - hurtboxes: vivem no RIG (animationConfigs, por animação/direção/frame);
 *   - hitboxes: vivem no PERFIL da arma equipada (WeaponHitboxProfile).
 *
 * O elo entre os dois lados é a COLUNA da folha (spec §9: o gerador usa o
 * mesmo mapa de animações do rig):
 *   - frame global composto = linha*SHEET_COLS + coluna → coluna = idx % 23;
 *   - rig.animations[<anim>] lista as colunas na ordem de reprodução, e as
 *     caixas são chaveadas pelo índice LOCAL dentro dessa lista.
 * Casar por coluna torna a busca robusta a diferenças de recorte: um perfil
 * autorado em `attack` (colunas 11-13) funciona mesmo com a folha composta
 * tocando `attack-full` (colunas 10-14).
 *
 * Frame sem entrada = SEM caixa (spec §18) — nunca uma caixa inventada.
 */
import { SHEET_COLS } from '../../lib/character-generator/constants';
import {
  normalizeRigFrameConfig,
  type LocalRectangle,
  type RigConfig,
  type RigDirection,
} from '../../shared/combat/RigShapes';
import {
  getActiveWeaponHitboxRects,
  type WeaponHitboxProfile,
} from '../../shared/combat/WeaponShapes';
import { WEAPON_REF_RE } from '../../shared/characters/PlayerCharacterShapes';

/**
 * Família da arma a partir da ref PERSISTIDA (`gen:weapon/<família>[/<var>]`)
 * — é a família que resolve o perfil de hitbox (variantes compartilham).
 * Ref vazia/nula (mão limpa) ou fora do formato → null: sem família não há
 * perfil, e mão limpa NUNCA herda o perfil default do rig (coisa de arma).
 */
export function weaponFamilyFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const m = WEAPON_REF_RE.exec(ref);
  return m ? m[1] : null;
}

/** Linhas do pack composto (down/left/right/up) → direções do rig (mesmas linhas 0-3). */
export const RIG_DIRECTION_BY_ROW: Record<string, RigDirection> = {
  down: 'south',
  left: 'west',
  right: 'east',
  up: 'north',
};

/** Movimento composto → animação do rig com as MESMAS colunas (contrato do gerador). */
export const COMPOSED_MOVEMENT_TO_RIG_ANIMATION: Record<string, string> = {
  walk: 'walk',
  idle: 'stand',
  attack: 'attack-full',
  shoot: 'knock-and-bow',
  death: 'dead',
};

/** Coluna da folha composta a partir do nome/índice global do frame (linha*23+coluna). */
export function composedFrameColumn(frameName: string | number): number | null {
  const idx = typeof frameName === 'number' ? frameName : parseInt(frameName, 10);
  if (!Number.isFinite(idx) || idx < 0) return null;
  return idx % SHEET_COLS;
}

/** Índice local (chave das caixas) em que `animationId` mostra `column`; null = não mostra. */
export function rigLocalFrameForColumn(
  rig: RigConfig,
  animationId: string,
  column: number,
): number | null {
  const frames = rig.animations[animationId];
  if (!frames) return null;
  const local = frames.indexOf(column);
  return local >= 0 ? local : null;
}

/**
 * Hurtboxes do rig (coordenadas locais à origem do sprite) para o frame atual.
 * Movimento `attack` também procura na animação `attack` (subconjunto do
 * `attack-full`) — cobre caixas autoradas em qualquer um dos dois recortes.
 */
export function rigHurtboxRectsFor(
  rig: RigConfig,
  movement: string,
  direction: RigDirection,
  column: number,
): LocalRectangle[] {
  const candidates = [COMPOSED_MOVEMENT_TO_RIG_ANIMATION[movement] ?? movement];
  if (movement === 'attack') candidates.push('attack');
  for (const anim of candidates) {
    const local = rigLocalFrameForColumn(rig, anim, column);
    if (local === null) continue;
    const frame = rig.animationConfigs[anim]?.directions[direction]?.frames[String(local)];
    if (!frame) continue;
    const hurt = normalizeRigFrameConfig(frame).hurtbox;
    if (hurt.enabled && hurt.rectangles.length > 0) return hurt.rectangles;
  }
  return [];
}

/**
 * Hitboxes do perfil da arma (coordenadas locais) para o frame atual — o
 * índice local é resolvido dentro da animação em que o PERFIL foi autorado.
 */
export function weaponHitboxRectsFor(
  rig: RigConfig,
  profile: WeaponHitboxProfile,
  direction: RigDirection,
  column: number,
): LocalRectangle[] {
  const local = rigLocalFrameForColumn(rig, profile.animationId, column);
  if (local === null) return [];
  return getActiveWeaponHitboxRects(profile, direction, local);
}
