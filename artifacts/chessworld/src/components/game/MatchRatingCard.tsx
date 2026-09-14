import { useEffect } from 'react';
import { Star, Swords, X } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useRatingStore } from '../../stores/ratingStore';
import type { RatingUpdatePlayer } from '../../shared/rating/RatingShapes';

const AUTO_DISMISS_MS = 15_000;

const UNRATED_REASONS: Record<string, string> = {
  aborted: 'Partida abortada (menos de 2 lances) — rating e gambits não mudam.',
  double_forfeit: 'Os dois jogadores abandonaram — sem rating e sem gambits.',
  anonymous: 'Partida amistosa (jogador sem conta) — rating não muda.',
  unknown_result: 'Resultado não avaliado — rating não muda.',
  migration_pending: 'Rating temporariamente indisponível no servidor.',
  already_settled: 'Esta partida já tinha sido avaliada.',
  persistence_error: 'Não foi possível gravar o rating desta partida.',
  profile_missing: 'Perfil não encontrado — rating não muda.',
};

const OUTCOME_LABEL: Record<RatingUpdatePlayer['outcome'], string> = { win: 'Vitória', draw: 'Empate', loss: 'Derrota' };

function formatDelta(delta: number): string {
  const rounded = Math.round(delta);
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

/** Card pós-partida: rating antes → depois (Δ) dos dois jogadores + gambits ganhos. */
export function MatchRatingCard() {
  const update = useRatingStore((s) => s.update);
  const receivedAt = useRatingStore((s) => s.receivedAt);
  const dismiss = useRatingStore((s) => s.dismiss);
  const myId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!update) return;
    const remaining = Math.max(1_000, AUTO_DISMISS_MS - (Date.now() - receivedAt));
    const timer = setTimeout(dismiss, remaining);
    return () => clearTimeout(timer);
  }, [update, receivedAt, dismiss]);

  if (!update) return null;
  // Eu primeiro, adversário depois.
  const players = [...update.players].sort((a, b) => (a.playerId === myId ? -1 : b.playerId === myId ? 1 : 0));

  return (
    <div
      className="fixed left-1/2 top-24 z-[230] w-[min(22rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-2xl border border-amber-500/40 bg-slate-950/95 p-4 text-slate-100 shadow-2xl backdrop-blur-sm"
      data-testid="match-rating-card"
      role="status"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
          <Star className="h-4 w-4" />
          {update.rated ? 'Rating atualizado' : 'Partida sem rating'}
          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            {update.kind === 'tournament' ? 'Torneio' : 'Praça'}
          </span>
        </div>
        <button type="button" onClick={dismiss} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!update.rated && (
        <p className="text-xs text-slate-300">{UNRATED_REASONS[update.reason ?? ''] ?? 'Rating não alterado.'}</p>
      )}

      {update.rated && (
        <ul className="space-y-2">
          {players.map((p) => {
            const mine = p.playerId === myId;
            const positive = p.ratingDelta >= 0;
            return (
              <li
                key={p.playerId}
                className={`rounded-xl border px-3 py-2 ${mine ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-800 bg-slate-900/60'}`}
                data-testid={`rating-row-${mine ? 'me' : 'opponent'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {p.username}{mine ? ' (você)' : ''}
                    </div>
                    <div className="text-[11px] text-slate-400">{OUTCOME_LABEL[p.outcome]}{p.provisional ? ' · rating provisório' : ''}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm">
                      <span className="text-slate-400">{Math.round(p.ratingBefore)}</span>
                      <span className="mx-1 text-slate-500">→</span>
                      <span className="font-bold text-white">{Math.round(p.ratingAfter)}</span>
                    </div>
                    <div className={`font-mono text-xs font-bold ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatDelta(p.ratingDelta)}
                    </div>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-1 text-[11px] text-emerald-300">
                  <Swords className="h-3 w-3" />
                  {p.gambitsAwarded > 0
                    ? `+${p.gambitsAwarded} gambit${p.gambitsAwarded === 1 ? '' : 's'} (total ${p.gambitsTotal})`
                    : p.gambitsReason === 'opponent_limit'
                      ? 'Sem gambits: limite diário contra este adversário'
                      : p.gambitsReason === 'daily_cap'
                        ? 'Sem gambits: teto diário atingido'
                        : p.gambitsReason === 'min_moves'
                          ? 'Sem gambits: partida curta demais (mínimo de lances)'
                          : 'Sem gambits nesta partida'}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
