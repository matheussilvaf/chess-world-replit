/**
 * Liquidação de uma partida terminada: rating Glicko-2 dos dois jogadores
 * (calculado do estado PRÉ-partida de ambos), estatísticas W/L/D, histórico e
 * gambits — tudo server-authoritative, disparado pela sala em
 * `broadcastMatchEnd` (praça e torneio passam pelo mesmo caminho).
 *
 * Escrita: UMA chamada à função SQL `chessworld_settle_match` (transação com
 * lock nos dois perfis) que grava histórico + ledger + perfil dos dois — nunca
 * fica histórico sem perfil, nem prêmio no ledger sem saldo.
 *
 * Idempotência (uma partida nunca conta duas vezes):
 *   1. promessa em voo + cache de resultado por matchId (mesmo processo);
 *   2. dentro da transação: histórico já existente para o matchId (ou UNIQUE
 *      (match_id, player_id) violado) → 'already_settled', nada é escrito.
 *
 * Concorrência entre partidas diferentes do mesmo jogador: o Node calcula a
 * partir de um snapshot (perfis + ledger do dia) e a função confere que o
 * snapshot ainda vale (CAS em chess_rated_games_played e nos contadores do
 * dia); 'conflict' → relê e recalcula (até MAX_ATTEMPTS = 3 vezes).
 *
 * Antes da migração SQL (colunas/tabelas/função ausentes) o serviço só loga e
 * devolve `rated: false, reason: 'migration_pending'` — a partida termina normalmente.
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
  getGambitDayStats,
  getLegacyRating,
  getRatingProfiles,
  settleMatchAtomic,
  type SettlePlayerWrite,
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
const MAX_ATTEMPTS = 3;
const settled = new Map<string, SettleMatchResult>();
const inFlight = new Map<string, Promise<SettleMatchResult>>();
let migrationWarned = false;

function warnMigrationOnce(detail: string): void {
  if (migrationWarned) return;
  migrationWarned = true;
  console.warn(`[rating] ${detail} — rode a migração SQL do admin (/admin/rating-gambits). Partidas não estão sendo avaliadas.`);
}

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

export function settleMatch(input: SettleMatchInput): Promise<SettleMatchResult> {
  const cached = settled.get(input.matchId);
  if (cached) return Promise.resolve(cached);
  const running = inFlight.get(input.matchId);
  if (running) return running;
  const task = settleMatchOnce(input).finally(() => inFlight.delete(input.matchId));
  inFlight.set(input.matchId, task);
  return task;
}

async function settleMatchOnce(input: SettleMatchInput): Promise<SettleMatchResult> {
  const decision = decideMatchSettlement(input);
  if (!decision.rated) return remember(input.matchId, unrated(input, decision.reason));

  const config = await getRatingConfigCached();
  const rules = config.rating;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const read = await getRatingProfiles([input.whitePlayerId, input.blackPlayerId]);
    if (read.schemaMissing) {
      warnMigrationOnce('colunas chess_rating* ausentes em profiles');
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
    const preRd = (p: PlayerRatingRow) =>
      inflateRatingDeviation(p.ratingDeviation, p.volatility, ratingPeriodsSince(p.lastRatedAt, now, rules.inactivityPeriodDays), rules.maxRatingDeviation);
    const whitePreRd = preRd(white);
    const blackPreRd = preRd(black);
    const sides: SideComputation[] = [
      computeSide(white, black, decision.white, whitePreRd, blackPreRd, config),
      computeSide(black, white, decision.black, blackPreRd, whitePreRd, config),
    ];

    // Gambits: prêmio base + limites do dia, calculados do ledger lido agora
    // (a função SQL confere que o ledger não mudou antes de gravar).
    const dayStartIso = new Date(gambitDayStart(now, config.gambits.dayOffsetHours)).toISOString();
    const writes: SettlePlayerWrite[] = [];
    for (const side of sides) {
      const day = await getGambitDayStats(side.profile.userId, side.opponent.userId, dayStartIso);
      if (day.schemaMissing) {
        warnMigrationOnce('tabela gambit_awards ausente');
        return remember(input.matchId, unrated(input, 'migration_pending'));
      }
      if (day.error) {
        console.error(`[gambits] falha ao ler ledger de ${side.profile.userId}: ${day.error}`);
        return unrated(input, 'persistence_error');
      }
      const base = baseGambitsFor(input.kind, side.outcome, config.gambits);
      const { amount, reason } = applyGambitLimits(base, day.stats, config.gambits);
      writes.push({
        playerId: side.profile.userId,
        opponentId: side.opponent.userId,
        result: side.outcome,
        expectedRatedGames: side.profile.ratedGamesPlayed,
        ratingBefore: roundRating(side.profile.rating),
        ratingAfter: roundRating(side.next.rating),
        ratingDelta: roundRating(side.next.ratingDelta),
        rdBefore: roundRating(side.preRd),
        rdAfter: roundRating(side.next.ratingDeviation),
        volatilityAfter: side.next.volatility,
        opponentRatingBefore: roundRating(side.opponent.rating),
        gambitsAmount: amount,
        gambitsReason: reason,
        dayStartIso,
        expectedOpponentGamesToday: day.stats.gamesAgainstOpponentToday,
        expectedEarnedToday: day.stats.gambitsEarnedToday,
      });
    }

    const settledAtIso = new Date(now).toISOString();
    const outcome = await settleMatchAtomic(input.matchId, input.kind, settledAtIso, [writes[0], writes[1]]);
    if (outcome.schemaMissing) {
      warnMigrationOnce('função chessworld_settle_match / tabelas de rating ausentes');
      return remember(input.matchId, unrated(input, 'migration_pending'));
    }
    if (outcome.status === 'conflict') {
      console.warn(`[rating] partida ${input.matchId}: perfil/ledger mudou durante o cálculo (tentativa ${attempt}/${MAX_ATTEMPTS}) — recalculando`);
      continue;
    }
    if (outcome.status === 'already_settled') {
      console.warn(`[rating] partida ${input.matchId} já avaliada — ignorando finalização duplicada`);
      return remember(input.matchId, unrated(input, 'already_settled'));
    }
    if (outcome.status === 'profile_missing') return remember(input.matchId, unrated(input, 'profile_missing'));
    if (!outcome.ok) {
      console.error(`[rating] falha ao liquidar partida ${input.matchId}: ${outcome.error}`);
      return unrated(input, 'persistence_error');
    }

    const ratings = new Map<string, number>();
    const players: RatingUpdatePlayer[] = sides.map((side, index) => {
      const write = writes[index];
      const ratedGames = side.profile.ratedGamesPlayed + 1;
      ratings.set(side.profile.userId, Math.round(side.next.rating));
      return {
        playerId: side.profile.userId,
        username: side.profile.username,
        outcome: side.outcome,
        ratingBefore: write.ratingBefore,
        ratingAfter: write.ratingAfter,
        ratingDelta: write.ratingDelta,
        ratingDeviationAfter: write.rdAfter,
        provisional: isProvisionalRating({ ratedGamesPlayed: ratedGames, ratingDeviation: side.next.ratingDeviation }, rules),
        gambitsAwarded: write.gambitsAmount,
        gambitsReason: write.gambitsReason,
        gambitsTotal: outcome.gambits.get(side.profile.userId) ?? side.profile.gambits + write.gambitsAmount,
      };
    });
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
  console.error(`[rating] partida ${input.matchId}: conflito persistente após ${MAX_ATTEMPTS} tentativas — não avaliada`);
  return unrated(input, 'persistence_error');
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
