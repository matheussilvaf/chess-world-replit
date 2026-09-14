/**
 * Glicko-2 (Glickman, 2013) — módulo PURO, sem I/O, compartilhado servidor ↔
 * cliente (cliente só para o teste canônico e para exibir "provisório").
 *
 * Escala interna: μ = (r − 1500) / 173.7178, φ = RD / 173.7178. O centro 1500
 * é uma constante da escala (não o rating inicial do jogo) — é o que faz o
 * exemplo canônico do paper bater: 1500/200/0.06 contra 1400 (RD 30, vitória),
 * 1550 (RD 100, derrota) e 1700 (RD 300, derrota) com τ = 0.5 →
 * 1464.06 / 151.52 / 0.05999.
 */

export interface Glicko2Player {
  rating: number;
  ratingDeviation: number;
  volatility: number;
}

/** 1 = vitória do jogador, 0.5 = empate, 0 = derrota. */
export type Glicko2Score = 0 | 0.5 | 1;

export interface Glicko2GameResult {
  opponent: Glicko2Player;
  score: Glicko2Score;
}

export interface Glicko2Options {
  /** Constante do sistema (0.3–1.2). Menor = volatilidade muda menos. */
  tau?: number;
  /** Piso do rating exibido/armazenado (o delta é medido contra o piso aplicado). */
  floor?: number;
  /** RD máximo (a incerteza nunca passa da de um jogador novo). */
  maxRatingDeviation?: number;
  /** Tolerância de convergência do algoritmo de Illinois (ε). */
  convergenceTolerance?: number;
}

export interface Glicko2Outcome {
  rating: number;
  ratingDeviation: number;
  volatility: number;
  /** rating − rating anterior (já com o piso aplicado). */
  ratingDelta: number;
}

export const GLICKO2_SCALE = 173.7178;
export const GLICKO2_CENTER = 1500;
export const GLICKO2_DEFAULT_TAU = 0.5;
export const GLICKO2_DEFAULT_FLOOR = 100;
export const GLICKO2_DEFAULT_MAX_RD = 350;
const DEFAULT_EPSILON = 0.000001;

const toMu = (rating: number) => (rating - GLICKO2_CENTER) / GLICKO2_SCALE;
const toPhi = (rd: number) => rd / GLICKO2_SCALE;
const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

function assertFinite(label: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`glicko2: ${label} inválido (${String(value)})`);
}

/**
 * Atualiza um jogador por UM período de rating com 0..n resultados.
 * Sem resultados = só a inflação de incerteza do período (φ' = √(φ² + σ²)).
 */
export function calculateGlicko2Period(
  player: Glicko2Player,
  results: readonly Glicko2GameResult[],
  options: Glicko2Options = {},
): Glicko2Outcome {
  const tau = options.tau ?? GLICKO2_DEFAULT_TAU;
  const floor = options.floor ?? GLICKO2_DEFAULT_FLOOR;
  const maxRd = options.maxRatingDeviation ?? GLICKO2_DEFAULT_MAX_RD;
  const epsilon = options.convergenceTolerance ?? DEFAULT_EPSILON;
  assertFinite('rating', player.rating);
  assertFinite('ratingDeviation', player.ratingDeviation);
  assertFinite('volatility', player.volatility);
  if (player.ratingDeviation <= 0) throw new Error('glicko2: ratingDeviation deve ser > 0');
  if (player.volatility <= 0) throw new Error('glicko2: volatility deve ser > 0');

  const mu = toMu(player.rating);
  const phi = toPhi(player.ratingDeviation);
  const sigma = player.volatility;

  if (results.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    const rd = Math.min(maxRd, phiStar * GLICKO2_SCALE);
    const rating = Math.max(floor, player.rating);
    return { rating, ratingDeviation: rd, volatility: sigma, ratingDelta: rating - player.rating };
  }

  // Passos 3 e 4: variância estimada (v) e melhora estimada (Δ).
  let vInv = 0;
  let deltaSum = 0;
  for (const { opponent, score } of results) {
    assertFinite('opponent.rating', opponent.rating);
    assertFinite('opponent.ratingDeviation', opponent.ratingDeviation);
    if (score !== 0 && score !== 0.5 && score !== 1) throw new Error(`glicko2: score inválido (${String(score)})`);
    const muJ = toMu(opponent.rating);
    const phiJ = toPhi(opponent.ratingDeviation);
    const gJ = g(phiJ);
    const e = expected(mu, muJ, phiJ);
    vInv += gJ * gJ * e * (1 - e);
    deltaSum += gJ * (score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Passo 5: nova volatilidade (algoritmo de Illinois).
  const a = Math.log(sigma * sigma);
  const phi2 = phi * phi;
  const f = (x: number) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi2 - v - ex);
    const den = 2 * (phi2 + v + ex) * (phi2 + v + ex);
    return num / den - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi2 + v) {
    B = Math.log(delta * delta - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  let guard = 0;
  while (Math.abs(B - A) > epsilon && guard < 1000) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
    guard += 1;
  }
  const sigmaPrime = Math.exp(A / 2);

  // Passos 6 e 7: φ* e novos φ'/μ'.
  const phiStar = Math.sqrt(phi2 + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  // Passo 8: volta à escala Glicko + piso/teto de RD.
  const rawRating = muPrime * GLICKO2_SCALE + GLICKO2_CENTER;
  const rating = Math.max(floor, rawRating);
  const ratingDeviation = Math.min(maxRd, phiPrime * GLICKO2_SCALE);
  return { rating, ratingDeviation, volatility: sigmaPrime, ratingDelta: rating - player.rating };
}

/**
 * Uma partida = um período com um único resultado (é como o jogo aplica:
 * cada partida fecha um período para os dois jogadores, calculada a partir
 * do estado PRÉ-partida de ambos).
 */
export function calculateGlicko2Rating(
  input: { player: Glicko2Player; opponent: Glicko2Player; score: Glicko2Score },
  options: Glicko2Options = {},
): Glicko2Outcome {
  return calculateGlicko2Period(input.player, [{ opponent: input.opponent, score: input.score }], options);
}

/**
 * Inatividade: a cada período sem jogar a incerteza cresce (φ' = √(φ² + σ²)
 * por período), limitada ao RD de um jogador novo. Períodos ≤ 0 = sem mudança.
 */
export function inflateRatingDeviation(
  ratingDeviation: number,
  volatility: number,
  periodsMissed: number,
  maxRatingDeviation: number = GLICKO2_DEFAULT_MAX_RD,
): number {
  if (!Number.isFinite(periodsMissed) || periodsMissed <= 0) return Math.min(maxRatingDeviation, ratingDeviation);
  const phi = toPhi(ratingDeviation);
  const inflated = Math.sqrt(phi * phi + periodsMissed * volatility * volatility) * GLICKO2_SCALE;
  return Math.min(maxRatingDeviation, inflated);
}

/** Quantos períodos inteiros se passaram desde a última partida avaliada. */
export function ratingPeriodsSince(lastRatedAt: string | number | Date | null | undefined, now: number, periodDays: number): number {
  if (lastRatedAt === null || lastRatedAt === undefined || periodDays <= 0) return 0;
  const last = new Date(lastRatedAt).getTime();
  if (!Number.isFinite(last) || last >= now) return 0;
  return Math.floor((now - last) / (periodDays * 86_400_000));
}

/** Rating provisório: poucas partidas avaliadas OU incerteza ainda alta. */
export function isProvisionalRating(
  player: { ratedGamesPlayed: number; ratingDeviation: number },
  thresholds: { provisionalGames: number; provisionalRd: number },
): boolean {
  return player.ratedGamesPlayed < thresholds.provisionalGames || player.ratingDeviation > thresholds.provisionalRd;
}
