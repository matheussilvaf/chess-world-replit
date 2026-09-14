/**
 * /admin/rating-gambits — "Rating (Glicko-2) & Gambits".
 *
 * Um documento salvo de uma vez (botão Salvar):
 *   Rating  → parâmetros Glicko-2 (τ, piso, estado inicial, provisório, inatividade).
 *   Gambits → prêmios por resultado (praça e torneio valem igual), bônus do
 *             campeão de torneio, lances mínimos por motivo de fim, limite por
 *             adversário/dia, teto diário (∞ ou número) e a hora em que o "dia" vira.
 * Mais a migração SQL (colunas em profiles + tabelas) e o reset em massa.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw, RotateCcw, Save, Star, Swords } from 'lucide-react';
import {
  DEFAULT_RATING_GAMBITS_CONFIG,
  MIN_MOVES_REASONS,
  RATING_RANGES,
  parseRatingGambitsConfig,
  type MinMovesAppliesTo,
  type MinMovesReason,
  type RatingGambitsConfig,
} from '../../../shared/rating/RatingShapes';
import { useDocumentScrollUnlock } from '../../../hooks/useDocumentScrollUnlock';
import { RigApiError } from '../rig-editor/rigApi';
import { Block, NumberField, Row, Section, SqlBanner, SqlBox, buttonClass, inputClass } from '../shared/AdminFields';
import { ratingApi } from './ratingApi';

const clone = (config: RatingGambitsConfig): RatingGambitsConfig => JSON.parse(JSON.stringify(config)) as RatingGambitsConfig;

const MIN_MOVES_LABEL: Record<MinMovesReason, { label: string; detail: string; isDraw: boolean }> = {
  resign: { label: 'Desistência', detail: 'inclui abandono da partida', isDraw: false },
  timeout: { label: 'Tempo esgotado', detail: 'derrota no relógio', isDraw: false },
  draw: { label: 'Empate por acordo', detail: 'vale para os dois', isDraw: true },
  repetition: { label: 'Repetição tripla', detail: 'vale para os dois', isDraw: true },
};
const APPLIES_TO_LABEL: Record<MinMovesAppliesTo, string> = { loss: 'Derrota', win: 'Vitória', both: 'Ambos' };

export function RatingGambitsPage() {
  useDocumentScrollUnlock();
  const [config, setConfig] = useState<RatingGambitsConfig>(() => clone(DEFAULT_RATING_GAMBITS_CONFIG));
  const [saved, setSaved] = useState<RatingGambitsConfig>(() => clone(DEFAULT_RATING_GAMBITS_CONFIG));
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [persisted, setPersisted] = useState(true);
  const [tableSql, setTableSql] = useState<string | null>(null);
  const [schemaReady, setSchemaReady] = useState(true);
  const [schemaCoreReady, setSchemaCoreReady] = useState(true);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [migrationSql, setMigrationSql] = useState<string | null>(null);
  const [showMigration, setShowMigration] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const applyError = useCallback((cause: unknown) => {
    if (cause instanceof RigApiError) {
      const details = cause.details && cause.details.length > 0 ? ` — ${cause.details.join('; ')}` : '';
      setError(`${cause.message}${details}`);
      if (cause.tableMissing) {
        setTableMissing(true);
        if (cause.tableSql) setTableSql(cause.tableSql);
      }
      return;
    }
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await ratingApi.get();
      const parsed = parseRatingGambitsConfig(res.config ?? DEFAULT_RATING_GAMBITS_CONFIG);
      const loadedConfig = parsed.ok ? parsed.config : DEFAULT_RATING_GAMBITS_CONFIG;
      if (!parsed.ok) setError(`Configuração salva no banco está inválida (usando os padrões): ${parsed.errors.join('; ')}`);
      setConfig(clone(loadedConfig));
      setSaved(clone(loadedConfig));
      setPersisted(res.saved !== false && res.config !== null);
      setTableMissing(res.tableMissing);
      setTableSql(res.tableMissing ? (res.tableSql ?? null) : null);
      setSchemaReady(res.schemaReady !== false);
      setSchemaCoreReady(res.schemaCoreReady !== undefined ? res.schemaCoreReady : res.schemaReady !== false);
      setSchemaError(res.schemaError ?? null);
      setMigrationSql(res.migrationSql ?? null);
    } catch (cause) {
      applyError(cause);
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }, [applyError]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(saved), [config, saved]);
  const validation = useMemo(() => parseRatingGambitsConfig(config), [config]);

  const update = (fn: (draft: RatingGambitsConfig) => void) => {
    setConfig((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });
    setSuccess(null);
  };

  const save = async () => {
    const parsed = parseRatingGambitsConfig(config);
    if (!parsed.ok) {
      setError(`Configuração inválida: ${parsed.errors.join('; ')}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await ratingApi.save(parsed.config);
      setConfig(clone(res.config));
      setSaved(clone(res.config));
      setPersisted(true);
      setTableMissing(false);
      setSuccess('Configuração salva. O servidor aplica nas próximas partidas (cache de 30 s).');
    } catch (cause) {
      applyError(cause);
    } finally {
      setBusy(false);
    }
  };

  const resetAll = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await ratingApi.resetAll();
      setSuccess(`${res.count} jogador(es) voltaram ao estado inicial (${saved.rating.initialRating} / RD ${saved.rating.initialRatingDeviation} / vol ${saved.rating.initialVolatility}).`);
    } catch (cause) {
      applyError(cause);
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  };

  const disabled = busy || !loaded;
  const r = config.rating;
  const g = config.gambits;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 [background-image:radial-gradient(circle_at_20%_0%,rgba(251,191,36,0.06),transparent_45%),radial-gradient(circle_at_80%_100%,rgba(16,185,129,0.06),transparent_45%)]">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-5 flex flex-wrap items-center gap-3">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
            <Star className="h-5 w-5 text-amber-300" />
          </div>
          <div>
            <h1 className="bg-gradient-to-r from-amber-300 via-orange-300 to-emerald-300 bg-clip-text text-xl font-semibold text-transparent">
              Rating (Glicko-2) &amp; Gambits
            </h1>
            <p className="font-mono text-[11px] text-slate-500">rating server-authoritative · prêmios em gambits por partida · limites diários</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { setConfig(clone(saved)); setSuccess(null); }}
              disabled={disabled || !dirty}
              className={`${buttonClass} border border-slate-700/60 bg-slate-800/80 hover:bg-slate-700/80`}
              title="Descartar alterações não salvas"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Descartar
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={busy}
              className={`${buttonClass} border border-slate-700/60 bg-slate-800/80 hover:bg-slate-700/80`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Recarregar
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={disabled || tableMissing || (!dirty && persisted) || !validation.ok}
              title={!persisted && !dirty ? 'Nada salvo no banco ainda — grava os valores padrão' : undefined}
              className={`${buttonClass} bg-amber-500 text-slate-950 hover:bg-amber-400`}
              data-testid="save-rating-gambits"
            >
              <Save className="h-3.5 w-3.5" /> Salvar{dirty ? ' *' : ''}
            </button>
            <Link to="/admin" className={`${buttonClass} border border-slate-700/60 bg-slate-800/80 hover:bg-slate-700/80`}>
              <ArrowLeft className="h-3.5 w-3.5" /> Administração
            </Link>
          </div>
        </header>

        {!schemaReady && (
          <SqlBanner
            text={
              schemaError?.includes('chessworld_award_gambits')
                ? `Atualização pendente: a função do bônus de campeão de torneio (chessworld_award_gambits) ainda não existe no banco (${schemaError}). Rode o SQL abaixo de novo no editor do Supabase (seguro repetir, não apaga rating de ninguém) — enquanto isso as partidas continuam sendo avaliadas normalmente; só o bônus de campeão não é creditado.`
                : `Migração pendente: as colunas de rating/gambits, as tabelas de histórico/ledger ou a função de liquidação ainda não existem no banco${schemaError ? ` (${schemaError})` : ''}. Rode o SQL abaixo no editor do Supabase (pode rodar de novo sem apagar rating de quem já jogou) — enquanto isso as partidas terminam sem rating e sem gambits.`
            }
            sql={migrationSql}
          />
        )}
        {schemaReady && tableMissing && (
          <SqlBanner text="Tabela chess_rating_config ausente — os padrões estão em uso. Rode o SQL abaixo no editor do Supabase para poder salvar." sql={tableSql ?? migrationSql} />
        )}
        {error && <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</div>}
        {success && <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">{success}</div>}
        {!validation.ok && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            {validation.errors.map((e) => <div key={e}>{e}</div>)}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title="Rating Glicko-2"
            subtitle="Calculado só no servidor, com o estado PRÉ-partida dos dois jogadores. Resignação e tempo = derrota; abortada/amistosa = sem mudança."
            icon={<div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2"><Star className="h-4 w-4 text-amber-300" /></div>}
          >
            <div className="space-y-3">
              <Block title="Estado inicial" hint="Todo jogador novo (e o reset em massa) começa aqui.">
                <Row label="Rating inicial">
                  <NumberField value={r.initialRating} onChange={(v) => update((d) => { d.rating.initialRating = v; })} range={RATING_RANGES.initialRating} disabled={disabled} />
                </Row>
                <Row label="Desvio inicial (RD)">
                  <NumberField value={r.initialRatingDeviation} onChange={(v) => update((d) => { d.rating.initialRatingDeviation = v; })} range={RATING_RANGES.initialRatingDeviation} disabled={disabled} />
                </Row>
                <Row label="Volatilidade inicial (σ)">
                  <NumberField value={r.initialVolatility} onChange={(v) => update((d) => { d.rating.initialVolatility = v; })} range={RATING_RANGES.initialVolatility} step={0.005} className="w-24" disabled={disabled} />
                </Row>
              </Block>
              <Block title="Sistema" hint="τ limita quanto a volatilidade pode mudar por partida. O piso vale para o rating; não há teto.">
                <Row label="τ (tau)">
                  <NumberField value={r.tau} onChange={(v) => update((d) => { d.rating.tau = v; })} range={RATING_RANGES.tau} step={0.05} className="w-24" disabled={disabled} />
                </Row>
                <Row label="Piso do rating">
                  <NumberField value={r.floor} onChange={(v) => update((d) => { d.rating.floor = v; })} range={RATING_RANGES.floor} disabled={disabled} />
                </Row>
                <Row label="RD máximo" detail="teto do desvio (inatividade nunca passa disso)">
                  <NumberField value={r.maxRatingDeviation} onChange={(v) => update((d) => { d.rating.maxRatingDeviation = v; })} range={RATING_RANGES.maxRatingDeviation} disabled={disabled} />
                </Row>
              </Block>
              <Block title="Provisório" hint="Rating provisório enquanto partidas avaliadas < N OU RD > limite (o HUD mostra “?”).">
                <Row label="Partidas avaliadas mínimas">
                  <NumberField value={r.provisionalGames} onChange={(v) => update((d) => { d.rating.provisionalGames = v; })} range={RATING_RANGES.provisionalGames} disabled={disabled} />
                </Row>
                <Row label="RD limite">
                  <NumberField value={r.provisionalRd} onChange={(v) => update((d) => { d.rating.provisionalRd = v; })} range={RATING_RANGES.provisionalRd} disabled={disabled} />
                </Row>
              </Block>
              <Block title="Inatividade" hint="A cada período sem jogar, o RD sobe (Glicko-2 passo 6) até o RD máximo — aplicado na próxima partida avaliada.">
                <Row label="Período" detail="dias">
                  <NumberField value={r.inactivityPeriodDays} onChange={(v) => update((d) => { d.rating.inactivityPeriodDays = v; })} range={RATING_RANGES.inactivityPeriodDays} step={0.5} className="w-24" suffix="dias" disabled={disabled} />
                </Row>
              </Block>
            </div>
          </Section>

          <Section
            title="Gambits"
            subtitle="Moeda ganha nas partidas e gasta no craft (custo por receita em /admin/craft). Só partidas avaliadas dão gambits."
            icon={<div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2"><Swords className="h-4 w-4 text-emerald-300" /></div>}
          >
            <div className="space-y-3">
              <Block title="Prêmios por resultado" hint="Partida de torneio vale o mesmo que partida da praça. O campeão ganha o bônus por cima, uma vez por torneio.">
                <Row label="Vitória" detail="praça ou torneio">
                  <NumberField value={g.win} onChange={(v) => update((d) => { d.gambits.win = v; })} range={RATING_RANGES.gambitAmount} disabled={disabled} />
                </Row>
                <Row label="Empate" detail="praça ou torneio">
                  <NumberField value={g.draw} onChange={(v) => update((d) => { d.gambits.draw = v; })} range={RATING_RANGES.gambitAmount} disabled={disabled} />
                </Row>
                <Row label="Derrota" detail="praça ou torneio">
                  <NumberField value={g.loss} onChange={(v) => update((d) => { d.gambits.loss = v; })} range={RATING_RANGES.gambitAmount} disabled={disabled} />
                </Row>
                <Row label="Campeão de torneio" detail="bônus do 1º colocado ao fim do torneio (0 = sem bônus)">
                  <NumberField value={g.tournamentChampion} onChange={(v) => update((d) => { d.gambits.tournamentChampion = v; })} range={RATING_RANGES.gambitAmount} disabled={disabled} />
                </Row>
              </Block>
              <Block title="Lances mínimos para valer gambits" hint="Lance completo = jogada das brancas + das pretas. Abaixo do mínimo, quem a regra alcança não ganha gambits (o rating não muda). Xeque-mate, afogamento e material insuficiente nunca têm mínimo. 0 = sem mínimo.">
                {MIN_MOVES_REASONS.map((reason) => {
                  const meta = MIN_MOVES_LABEL[reason];
                  const rule = g.minMoves[reason];
                  return (
                    <Row key={reason} label={meta.label} detail={meta.detail}>
                      <NumberField
                        value={rule.minMoves}
                        onChange={(v) => update((d) => { d.gambits.minMoves[reason].minMoves = v; })}
                        range={RATING_RANGES.minMoves}
                        suffix="lances"
                        disabled={disabled}
                      />
                      <select
                        value={meta.isDraw ? 'both' : rule.appliesTo}
                        onChange={(e) => update((d) => { d.gambits.minMoves[reason].appliesTo = e.target.value as MinMovesAppliesTo; })}
                        disabled={disabled || meta.isDraw}
                        title={meta.isDraw ? 'Empate não tem vencedor: vale para os dois jogadores' : 'A quem a regra se aplica'}
                        className={inputClass}
                        data-testid={`min-moves-applies-${reason}`}
                      >
                        {(Object.keys(APPLIES_TO_LABEL) as MinMovesAppliesTo[]).map((option) => (
                          <option key={option} value={option}>{APPLIES_TO_LABEL[option]}</option>
                        ))}
                      </select>
                    </Row>
                  );
                })}
              </Block>
              <Block title="Limites diários" hint="Contra o mesmo adversário só as N primeiras partidas do dia rendem gambits (0 = nunca). O teto diário limita o total do jogador no dia.">
                <Row label="Cada adversário conta quantas vezes por dia?">
                  <NumberField value={g.opponentDailyLimit} onChange={(v) => update((d) => { d.gambits.opponentDailyLimit = v; })} range={RATING_RANGES.opponentDailyLimit} disabled={disabled} />
                </Row>
                <Row label="Máximo por dia">
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                    <input
                      type="checkbox"
                      checked={g.dailyCap === null}
                      onChange={(e) => update((d) => { d.gambits.dailyCap = e.target.checked ? null : 50; })}
                      disabled={disabled}
                      className="accent-emerald-500"
                      data-testid="daily-cap-infinite"
                    />
                    infinito
                  </label>
                  {g.dailyCap !== null && (
                    <NumberField value={g.dailyCap} onChange={(v) => update((d) => { d.gambits.dailyCap = v; })} range={RATING_RANGES.dailyCap} disabled={disabled} />
                  )}
                </Row>
                <Row label="O dia vira às" detail="deslocamento em horas em relação ao UTC (−3 = meia-noite de Brasília)">
                  <NumberField value={g.dayOffsetHours} onChange={(v) => update((d) => { d.gambits.dayOffsetHours = v; })} range={RATING_RANGES.dayOffsetHours} suffix="h UTC" disabled={disabled} />
                </Row>
              </Block>
            </div>
          </Section>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Section
            title="Reset em massa"
            subtitle="Zera rating, RD, volatilidade, partidas avaliadas e pico de TODOS os jogadores para o estado inicial salvo. Histórico de partidas fica."
            icon={<div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2"><AlertTriangle className="h-4 w-4 text-rose-300" /></div>}
          >
            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                disabled={disabled || !schemaCoreReady}
                className={`${buttonClass} border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20`}
                data-testid="reset-all-ratings"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Resetar todos os jogadores…
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-rose-200">Tem certeza? Isso não pode ser desfeito.</span>
                <button type="button" onClick={() => void resetAll()} disabled={busy} className={`${buttonClass} bg-rose-500 text-white hover:bg-rose-400`} data-testid="confirm-reset-all">
                  Sim, resetar
                </button>
                <button type="button" onClick={() => setConfirmReset(false)} disabled={busy} className={`${buttonClass} border border-slate-700/60 bg-slate-800/80`}>
                  Cancelar
                </button>
              </div>
            )}
          </Section>

          <Section
            title="Migração SQL"
            subtitle="Idempotente: colunas em profiles, chess_rating_history, gambit_awards, chess_rating_config e o reset inicial."
            icon={<div className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-2"><Swords className="h-4 w-4 text-slate-400" /></div>}
          >
            <div className="flex items-center gap-2 text-xs">
              <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${schemaReady ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                {schemaReady ? 'schema pronto' : 'migração pendente'}
              </span>
              <button type="button" onClick={() => setShowMigration((v) => !v)} className={`${inputClass} cursor-pointer`}>
                {showMigration ? 'Ocultar SQL' : 'Mostrar SQL'}
              </button>
            </div>
            {showMigration && migrationSql && <SqlBox sql={migrationSql} className="mt-3" />}
          </Section>
        </div>
      </div>
    </div>
  );
}
