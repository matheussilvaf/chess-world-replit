/**
 * Liquidação de uma partida terminada: rating Glicko-2 dos dois jogadores
 * (calculado do estado PRÉ-partida de ambos), estatísticas W/L/D, histórico e
 * gambits — tudo server-authoritative, disparado pela sala em
 * `broadcastMatchEnd` (praça e torneio passam pelo mesmo caminho).
 *
 * Idempotência (uma partida nunca conta duas vezes):
 *   1. cache em memória por matchId (mesmo processo);
 *   2. UNIQUE (match_id, player_id) em `chess_rating_history` — o insert do
 *      histórico acontece ANTES de tocar no perfil; violação = já aplicado
 *      (outro processo/replica) e nada mais é escrito;
 *   3. UNIQUE (match_id, player_id) em `gambit_awards` para o prêmio.
 *
 * Antes da migração SQL (colunas/tabelas ausentes) o serviço só loga e devolve
 * `rated: false, reason: 'migration_pending'` — a partida termina normalmente.
 */
import {
  calculateGlicko2Rating,
  inflateRatingDeviation,
  isProvisionalRating,
  ratingPeriodsSince,
} from '../shared/rating/Glicko2.js';
import {
  applyGambitLimits,
  baseGambitsFor,
  decideMatchSettlement,
  gambitDayStart,
  outcomeScore,
  roundRating,
  type ChessRatingUpdateMessage,
  type MatchKind,
  type PlayerMatchOutcome,
  type PlayerRatingRow,
  type RatingGambitsConfig,
  type RatingUpdatePlayer,
} from '../shared/rating/RatingShapes.js';
import { getRatingConfigCached } from './ratingConfigRepository.js';
import {
  changeGambits,
  getGambitDayStats,
  getLegacyRating,
  getRatingProfiles,
  insertGambitAward,
  insertRatingHistory,
  updateRatingProfile,
  type RatingHistoryInsert,
} from './ratingRepository.js';

export interface SettleMatchInput {
  matchId: string;
  kind: MatchKind;
  result: string;
  winnerId: string;
  whitePlayerId: string;
  blackPlayerId: string;
  fen: string;
}

export interface SettleMatchResult {
  /** Mensagem `chess_rating_update` para os jogadores (sempre presente, mesmo sem rating). */
  message: ChessRatingUpdateMessage;
  /** Novo rating exibido por jogador (para espelhar em PlayerState.rating). */
  ratings: Map<string, number>;
  applied: boolean;
}

const MAX_CACHE = 2_000;
const settled = new Map<string, SettleMatchResult>();
let migrationWarned = false;

function remember(matchId: string, result: SettleMatchResult): SettleMatchResult {
  if (settled.size >= MAX_CACHE) {
    const oldest = settled.keys().next().value;
    if (oldest !== undefined) settled.delete(oldest);
  }
  settled.set(matchId, result);
  return result;
}

function unrated(input: SettleMatchInput, reason: string): SettleMatchResult {
  return {
    message: { matchId: input.matchId, kind: input.kind, rated: false, reason, players: [] },
    ratings: new Map(),
    applied: false,
  };
}

interface SideComputation {
  profile: PlayerRatingRow;
  opponent: PlayerRatingRow;
  outcome: PlayerMatchOutcome;
  preRd: number;
  opponentPreRd: number;
  next: { rating: number; ratingDeviation: number; volatility: number; ratingDelta: number };
}

function computeSide(
  profile: PlayerRatingRow,
  opponent: PlayerRatingRow,
  outcome: PlayerMatchOutcome,
  preRd: number,
  opponentPreRd: number,
  config: RatingGambitsConfig,
): SideComputation {
  const next = calculateGlicko2Rating(
    {
      player: { rating: profile.rating, ratingDeviation: preRd, volatility: profile.volatility },
      opponent: { rating: opponent.rating, ratingDeviation: opponentPreRd, volatility: opponent.volatility },
      score: outcomeScore(outcome),
    },
    { tau: config.rating.tau, floor: config.rating.floor, maxRatingDeviation: config.rating.maxRatingDeviation },
  );
  return { profile, opponent, outcome, preRd, opponentPreRd, next };
}

export async function settleMatch(input: SettleMatchInput): Promise<SettleMatchResult> {
  const cached = settled.get(input.matchId);
  if (cached) return cached;

  const decision = decideMatchSettlement(input);
  if (!decision.rated) return remember(input.matchId, unrated(input, decision.reason));

  const config = await getRatingConfigCached();
  const read = await getRatingProfiles([input.whitePlayerId, input.blackPlayerId]);
  if (read.schemaMissing) {
    if (!migrationWarned) {
      console.warn('[rating] colunas chess_rating* ausentes em profiles — rode a migração SQL do admin (/admin/rating-gambits). Partidas não estão sendo avaliadas.');
      migrationWarned = true;
    }
    return remember(input.matchId, unrated(input, 'migration_pending'));
  }
  if (read.error) {
    console.error(`[rating] falha ao ler perfis da partida ${input.matchId}: ${read.error}`);
    return unrated(input, 'persistence_error');
  }
  const white = read.profiles.get(input.whitePlayerId);
  const black = read.profiles.get(input.blackPlayerId);
  if (!white || !black) return remember(input.matchId, unrated(input, 'profile_missing'));

  // Estado PRÉ-partida dos dois (com inflação de inatividade), congelado antes de qualquer cálculo.
  const now = Date.now();
  const rules = config.rating;
  const preRd = (p: PlayerRatingRow) =>
    inflateRatingDeviation(p.ratingDeviation, p.volatility, ratingPeriodsSince(p.lastRatedAt, now, rules.inactivityPeriodDays), rules.maxRatingDeviation);
  const whitePreRd = preRd(white);
  const blackPreRd = preRd(black);
  const sides: SideComputation[] = [
    computeSide(white, black, decision.white, whitePreRd, blackPreRd, config),
    computeSide(black, white, decision.black, blackPreRd, whitePreRd, config),
  ];

  // 1) Histórico primeiro — é a trava de idempotência entre processos.
  const historyRows: RatingHistoryInsert[] = sides.map((s) => ({
    playerId: s.profile.userId,
    matchId: input.matchId,
    opponentId: s.opponent.userId,
    result: s.outcome,
    ratingBefore: roundRating(s.profile.rating),
    ratingAfter: roundRating(s.next.rating),
    ratingDelta: roundRating(s.next.ratingDelta),
    rdBefore: roundRating(s.preRd),
    rdAfter: roundRating(s.next.ratingDeviation),
    volatilityAfter: s.next.volatility,
    opponentRatingBefore: roundRating(s.opponent.rating),
    matchKind: input.kind,
  }));
  const history = await insertRatingHistory(historyRows);
  if (!history.ok) {
    if (history.duplicate) {
      console.warn(`[rating] partida ${input.matchId} já avaliada (histórico existente) — ignorando finalização duplicada`);
      return remember(input.matchId, unrated(input, 'already_settled'));
    }
    if (history.schemaMissing) {
      if (!migrationWarned) {
        console.warn('[rating] tabela chess_rating_history ausente — rode a migração SQL do admin (/admin/rating-gambits).');
        migrationWarned = true;
      }
      return remember(input.matchId, unrated(input, 'migration_pending'));
    }
    console.error(`[rating] falha ao gravar histórico da partida ${input.matchId}: ${history.error}`);
    return unrated(input, 'persistence_error');
  }

  // 2) Perfis (rating novo + W/L/D + espelho inteiro em `rating`).
  const nowIso = new Date(now).toISOString();
  const players: RatingUpdatePlayer[] = [];
  const ratings = new Map<string, number>();
  for (const side of sides) {
    const p = side.profile;
    const ratedGames = p.ratedGamesPlayed + 1;
    const update = {
      rating: side.next.rating,
      ratingDeviation: side.next.ratingDeviation,
      volatility: side.next.volatility,
      ratedGamesPlayed: ratedGames,
      peakRating: Math.max(p.peakRating, side.next.rating),
      lastRatedAt: nowIso,
      wins: p.wins + (side.outcome === 'win' ? 1 : 0),
      losses: p.losses + (side.outcome === 'loss' ? 1 : 0),
      draws: p.draws + (side.outcome === 'draw' ? 1 : 0),
      gamesPlayed: p.gamesPlayed + 1,
    };
    let write = await updateRatingProfile(p.userId, p.ratedGamesPlayed, update);
    if (write.ok && !write.applied) {
      console.warn(`[rating] CAS do perfil ${p.userId} falhou (partida ${input.matchId}); aplicando sem CAS`);
      write = await updateRatingProfile(p.userId, null, update);
    }
    if (!write.ok) console.error(`[rating] falha ao atualizar perfil ${p.userId} (partida ${input.matchId}): ${write.error}`);
    ratings.set(p.userId, Math.round(side.next.rating));

    // 3) Gambits (ledger único por partida/jogador + saldo com CAS).
    const gambits = await awardGambits(input, side, now, config);
    players.push({
      playerId: p.userId,
      username: p.username,
      outcome: side.outcome,
      ratingBefore: roundRating(p.rating),
      ratingAfter: roundRating(side.next.rating),
      ratingDelta: roundRating(side.next.ratingDelta),
      ratingDeviationAfter: roundRating(side.next.ratingDeviation),
      provisional: isProvisionalRating({ ratedGamesPlayed: ratedGames, ratingDeviation: side.next.ratingDeviation }, rules),
      gambitsAwarded: gambits.amount,
      gambitsReason: gambits.reason,
      gambitsTotal: gambits.total,
    });
  }

  console.log(
    `[rating] ${input.kind} ${input.matchId}: ` +
      players.map((pl) => `${pl.username} ${pl.ratingBefore}→${pl.ratingAfter} (${pl.ratingDelta >= 0 ? '+' : ''}${pl.ratingDelta}) +${pl.gambitsAwarded}g`).join(' | '),
  );
  return remember(input.matchId, {
    message: { matchId: input.matchId, kind: input.kind, rated: true, players },
    ratings,
    applied: true,
  });
}

async function awardGambits(
  input: SettleMatchInput,
  side: SideComputation,
  now: number,
  config: RatingGambitsConfig,
): Promise<{ amount: number; reason: RatingUpdatePlayer['gambitsReason']; total: number }> {
  const rules = config.gambits;
  const p = side.profile;
  const base = baseGambitsFor(input.kind, side.outcome, rules);
  const dayStartIso = new Date(gambitDayStart(now, rules.dayOffsetHours)).toISOString();
  const day = await getGambitDayStats(p.userId, side.opponent.userId, dayStartIso);
  if (day.schemaMissing) return { amount: 0, reason: 'zero', total: p.gambits };
  if (day.error) {
    console.error(`[gambits] falha ao ler ledger de ${p.userId}: ${day.error}`);
    return { amount: 0, reason: 'zero', total: p.gambits };
  }
  const { amount, reason } = applyGambitLimits(base, day.stats, rules);
  const ledger = await insertGambitAward({
    playerId: p.userId,
    matchId: input.matchId,
    opponentId: side.opponent.userId,
    amount,
    kind: input.kind,
    reason,
  });
  if (!ledger.ok) {
    if (!ledger.duplicate && !ledger.schemaMissing) console.error(`[gambits] falha ao gravar ledger de ${p.userId}: ${ledger.error}`);
    return { amount: 0, reason: 'zero', total: p.gambits };
  }
  if (amount <= 0) return { amount: 0, reason, total: p.gambits };
  const change = await changeGambits(p.userId, amount);
  if (!change.ok) {
    console.error(`[gambits] falha ao creditar ${amount} gambits a ${p.userId}: ${change.error}`);
    return { amount: 0, reason: 'zero', total: p.gambits };
  }
  return { amount, reason, total: change.balance };
}

/** Rating exibido de um jogador (para o join da sala) — null se não houver perfil. Pré-migração usa o `rating` legado. */
export async function loadDisplayRating(userId: string): Promise<{ rating: number; gambits: number } | null> {
  const read = await getRatingProfiles([userId]);
  if (read.schemaMissing) {
    const legacy = await getLegacyRating(userId);
    return legacy === null ? null : { rating: Math.round(legacy), gambits: 0 };
  }
  const profile = read.profiles.get(userId);
  if (!profile) return null;
  return { rating: Math.round(profile.rating), gambits: profile.gambits };
}
