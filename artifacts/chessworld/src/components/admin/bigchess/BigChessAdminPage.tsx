/**
 * /admin/bigchess — "Controlador do Big Chessboard".
 *
 * UM documento salvo de uma vez (botão Salvar):
 *   Peças    → por tipo (vale para brancas e pretas): HP, renda diária em
 *              Crowns, pontos por hora, regeneração (% a cada intervalo, só se
 *              a peça não apanhou no intervalo) e benefícios (texto).
 *   Capas    → itens com badge `cover` (do /admin/craft): redução de dano (%)
 *              e duração. Equipar o mesmo item de novo soma a duração.
 *   Defesas  → itens com badge `defense-piece`: duração; com `hp-plus` também
 *              % de HP extra; com `counter-attack` também dano, duração do
 *              ataque e raio do contra-ataque.
 *   Regras   → anotações livres ("Regras de Negócio da Big Chessboard").
 *
 * As listas de itens vêm das badges do próprio jogo: aqui o admin só preenche
 * os números de cada item.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Crown, Loader2, Plus, RefreshCw, RotateCcw, Save, Shield, ShieldPlus, Swords, Trash2 } from 'lucide-react';
import {
  BADGE_COUNTER_ATTACK,
  BADGE_COVER,
  BADGE_DEFENSE_PIECE,
  BADGE_HP_PLUS,
  BIGCHESS_BENEFITS_MAX_LEN,
  BIGCHESS_COUNTER_DAMAGE_RANGE,
  BIGCHESS_COUNTER_DURATION_RANGE,
  BIGCHESS_COUNTER_RADIUS_RANGE,
  BIGCHESS_DURATION_RANGE,
  BIGCHESS_HP_PLUS_RANGE,
  BIGCHESS_HP_RANGE,
  BIGCHESS_INCOME_RANGE,
  BIGCHESS_NOTES_MAX_LEN,
  BIGCHESS_PERCENT_RANGE,
  BIGCHESS_PIECES,
  BIGCHESS_PIECE_TYPES,
  BIGCHESS_POINTS_RANGE,
  BIGCHESS_REGEN_INTERVAL_OPTIONS,
  BIGCHESS_TEST_REGEN_INTERVAL_SEC,
  BIGCHESS_TYPE_LABELS,
  DEFAULT_BIGCHESS_CONFIG,
  formatBigChessDuration,
  parseBigChessConfig,
  type BigChessConfig,
  type BigChessPieceType,
} from '../../../shared/bigchess/BigChessShapes';
import { itemHasBadge, itemsWithBadge, type CraftBadgeMap } from '../../../shared/craft/CraftBadges';
import { useDocumentScrollUnlock } from '../../../hooks/useDocumentScrollUnlock';
import { inventoryEntry, inventoryFallbackName, useInventoryVisualCatalog } from '../../../lib/inventory/inventoryVisualCatalog';
import { RigApiError } from '../rig-editor/rigApi';
import { CatalogThumb } from '../craft/CatalogThumb';
import { craftApi } from '../craft/craftApi';
import { Block, NumberField, Section, SqlBanner, SqlBox, buttonClass, inputClass } from '../shared/AdminFields';
import { bigChessApi } from './bigChessApi';

const clone = (config: BigChessConfig): BigChessConfig => JSON.parse(JSON.stringify(config)) as BigChessConfig;

const withBase = (url: string) => `${import.meta.env.BASE_URL}${url.replace(/^\//, '')}`;

type DurationUnit = 's' | 'min' | 'h' | 'd';
const UNIT_SECONDS: Record<DurationUnit, number> = { s: 1, min: 60, h: 3600, d: 86_400 };
const UNIT_LABELS: Record<DurationUnit, string> = { s: 'segundos', min: 'minutos', h: 'horas', d: 'dias' };

function largestExactUnit(seconds: number): DurationUnit {
  for (const unit of ['d', 'h', 'min'] as const) {
    if (seconds % UNIT_SECONDS[unit] === 0) return unit;
  }
  return 's';
}

/** Duração em segundos editada como número + unidade (salva sempre em segundos). */
function DurationField({
  seconds,
  onChange,
  disabled,
  label,
}: {
  seconds: number;
  onChange: (seconds: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const [unit, setUnit] = useState<DurationUnit>(() => largestExactUnit(seconds));
  const factor = UNIT_SECONDS[unit];
  const range = { min: Math.max(1, Math.ceil(BIGCHESS_DURATION_RANGE.min / factor)), max: Math.floor(BIGCHESS_DURATION_RANGE.max / factor) };
  const shown = Math.max(range.min, Math.min(range.max, Math.round(seconds / factor)));
  return (
    <span className="inline-flex items-center gap-1">
      <NumberField value={shown} range={range} onChange={(v) => onChange(v * factor)} disabled={disabled} label={label} className="w-20" />
      <select
        value={unit}
        disabled={disabled}
        aria-label={`${label}: unidade`}
        onChange={(e) => {
          const next = e.target.value as DurationUnit;
          setUnit(next);
          const nextFactor = UNIT_SECONDS[next];
          const converted = Math.max(1, Math.round(seconds / nextFactor)) * nextFactor;
          if (converted !== seconds) onChange(Math.min(BIGCHESS_DURATION_RANGE.max, converted));
        }}
        className={`${inputClass} w-24`}
      >
        {(Object.keys(UNIT_LABELS) as DurationUnit[]).map((u) => (
          <option key={u} value={u}>{UNIT_LABELS[u]}</option>
        ))}
      </select>
      <span className="font-mono text-[10px] text-slate-500">= {formatBigChessDuration(seconds)}</span>
    </span>
  );
}

function Field({ label, children, hint }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-slate-600">{hint}</span>}
    </label>
  );
}

function regenIntervalLabel(seconds: number): string {
  if (seconds === BIGCHESS_TEST_REGEN_INTERVAL_SEC) return '15 segundos (teste)';
  const hours = seconds / 3600;
  return `${hours} hora${hours > 1 ? 's' : ''}`;
}

export function BigChessAdminPage() {
  useDocumentScrollUnlock();
  const catalog = useInventoryVisualCatalog();
  const [config, setConfig] = useState<BigChessConfig>(() => clone(DEFAULT_BIGCHESS_CONFIG));
  const [saved, setSaved] = useState<BigChessConfig>(() => clone(DEFAULT_BIGCHESS_CONFIG));
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [persisted, setPersisted] = useState(true);
  const [tableSql, setTableSql] = useState<string | null>(null);
  const [tablesSql, setTablesSql] = useState<string | null>(null);
  const [badges, setBadges] = useState<CraftBadgeMap>({});

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
      const [res, badgesRes] = await Promise.all([bigChessApi.get(), craftApi.badges.list().catch(() => null)]);
      const parsed = parseBigChessConfig(res.config ?? DEFAULT_BIGCHESS_CONFIG);
      const loadedConfig = parsed.ok ? parsed.config : DEFAULT_BIGCHESS_CONFIG;
      if (!parsed.ok) setError(`Configuração salva no banco está inválida (usando os padrões): ${parsed.errors.join('; ')}`);
      setConfig(clone(loadedConfig));
      setSaved(clone(loadedConfig));
      setPersisted(res.saved !== false && res.config !== null);
      setTableMissing(res.tableMissing);
      setTableSql(res.tableMissing ? (res.tableSql ?? null) : null);
      setTablesSql(res.tablesSql ?? null);
      setBadges(badgesRes?.badges ?? {});
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
  const validation = useMemo(() => parseBigChessConfig(config), [config]);

  const update = (fn: (draft: BigChessConfig) => void) => {
    setConfig((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });
    setSuccess(null);
  };

  const save = async () => {
    const parsed = parseBigChessConfig(config);
    if (!parsed.ok) {
      setError(`Configuração inválida: ${parsed.errors.join('; ')}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await bigChessApi.save(parsed.config);
      setConfig(clone(res.config));
      setSaved(clone(res.config));
      setPersisted(true);
      setTableMissing(false);
      setSuccess('Configuração salva. O servidor aplica em até 30 s (peças já no tabuleiro seguem as regras novas).');
    } catch (cause) {
      applyError(cause);
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------ listas derivadas
  const coverItems = useMemo(() => itemsWithBadge(badges, BADGE_COVER), [badges]);
  const defenseItems = useMemo(() => itemsWithBadge(badges, BADGE_DEFENSE_PIECE), [badges]);
  /** Configurados mas sem a badge (badge removida no /admin/craft): ficam visíveis para o admin limpar. */
  const orphanCovers = useMemo(() => Object.keys(config.covers).filter((id) => !coverItems.includes(id)), [config.covers, coverItems]);
  const orphanDefenses = useMemo(() => Object.keys(config.defenses).filter((id) => !defenseItems.includes(id)), [config.defenses, defenseItems]);

  const nameOf = (id: string) => inventoryEntry(catalog, id)?.name ?? inventoryFallbackName(id);
  const thumbOf = (id: string) => inventoryEntry(catalog, id)?.thumb ?? null;
  const disabled = busy || !loaded;

  const itemHeader = (id: string, tags: string[], orphan: boolean) => {
    const thumb = thumbOf(id);
    return (
      <div className="flex min-w-0 items-center gap-2">
        {thumb && <CatalogThumb thumb={thumb} size={32} />}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs font-medium text-slate-100">{nameOf(id)}</span>
            {tags.map((tag) => (
              <span key={tag} className="rounded border border-cyan-500/40 bg-cyan-500/10 px-1 py-px font-mono text-[9px] uppercase tracking-wide text-cyan-300">
                {tag}
              </span>
            ))}
            {orphan && (
              <span className="rounded border border-rose-500/40 bg-rose-500/10 px-1 py-px font-mono text-[9px] uppercase tracking-wide text-rose-300">
                sem badge
              </span>
            )}
          </div>
          <div className="truncate font-mono text-[10px] text-slate-500">{id}</div>
        </div>
      </div>
    );
  };

  const pieceThumbs = (type: BigChessPieceType) =>
    BIGCHESS_PIECES.filter((p) => p.type === type).map((p) => (
      <img key={p.itemId} src={withBase(encodeURI(p.imageUrl))} alt={p.name} className="h-10 w-10 object-contain drop-shadow" />
    ));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 [background-image:radial-gradient(circle_at_20%_0%,rgba(250,204,21,0.07),transparent_45%),radial-gradient(circle_at_80%_100%,rgba(56,189,248,0.06),transparent_45%)]">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <header className="mb-5 flex flex-wrap items-center gap-3">
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-2">
            <Crown className="h-5 w-5 text-yellow-300" />
          </div>
          <div>
            <h1 className="bg-gradient-to-r from-yellow-300 via-amber-200 to-sky-300 bg-clip-text text-xl font-semibold text-transparent">
              Controlador do Big Chessboard
            </h1>
            <p className="font-mono text-[11px] text-slate-500">peças · renda em Crowns · regeneração · capas e itens de defesa · regras de negócio</p>
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
              className={`${buttonClass} bg-yellow-400 text-slate-950 hover:bg-yellow-300`}
              data-testid="save-bigchess"
            >
              <Save className="h-3.5 w-3.5" /> Salvar{dirty ? ' *' : ''}
            </button>
            <Link to="/admin" className={`${buttonClass} border border-slate-700/60 bg-slate-800/80 hover:bg-slate-700/80`}>
              <ArrowLeft className="h-3.5 w-3.5" /> Administração
            </Link>
          </div>
        </header>

        {error && <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div>}
        {success && <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{success}</div>}
        {!validation.ok && (
          <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            Corrija antes de salvar: {validation.errors.join('; ')}
          </div>
        )}
        {tableMissing && (
          <SqlBanner
            text="As tabelas do Big Chessboard ainda não existem. Rode uma vez no SQL editor do Supabase e clique em Recarregar:"
            sql={tablesSql ?? tableSql}
          />
        )}
        {loaded && !tableMissing && !persisted && (
          <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
            Nada salvo no banco ainda — o jogo está usando os valores padrão mostrados abaixo. Clique em <strong>Salvar</strong> para gravá-los (ou ajuste antes).
          </div>
        )}
        {loaded && !tableMissing && tablesSql && (
          <details className="mb-4 rounded-lg border border-slate-700/60 bg-slate-900/60 p-3 text-xs text-slate-300">
            <summary className="cursor-pointer select-none font-medium text-slate-200">
              SQL das tabelas do Big Chessboard (bigchess_config, bigchess_pieces, player_wallets) — rode uma vez no Supabase
            </summary>
            <SqlBox sql={tablesSql} className="mt-2" />
          </details>
        )}

        <div className="flex flex-col gap-4">
          <Section
            title="Peças"
            subtitle="Cada tipo vale para a peça branca e a preta. A regeneração só acontece se a peça não sofreu ataque durante o intervalo inteiro."
            icon={<div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-2"><Crown className="h-4 w-4 text-yellow-300" /></div>}
          >
            <div className="grid gap-3 lg:grid-cols-2">
              {BIGCHESS_PIECE_TYPES.map((type) => {
                const rules = config.pieces[type];
                return (
                  <div key={type} className="rounded-lg border border-slate-700/50 bg-slate-950/40 p-3" data-testid={`piece-${type}`}>
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex items-center gap-1 rounded-md border border-slate-700/60 bg-slate-900/80 px-1.5 py-1">{pieceThumbs(type)}</div>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-100">{BIGCHESS_TYPE_LABELS[type]}</h3>
                        <p className="font-mono text-[10px] text-slate-500">bigchess-white-{type} · bigchess-black-{type}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <Field label="HP total">
                        <NumberField value={rules.hp} range={BIGCHESS_HP_RANGE} onChange={(v) => update((d) => { d.pieces[type].hp = v; })} disabled={disabled} label={`${BIGCHESS_TYPE_LABELS[type]}: HP`} className="w-24" />
                      </Field>
                      <Field label="Renda diária" hint="Crowns por dia (acumula por segundo)">
                        <NumberField value={rules.incomePerDay} range={BIGCHESS_INCOME_RANGE} step={0.01} onChange={(v) => update((d) => { d.pieces[type].incomePerDay = v; })} disabled={disabled} label={`${BIGCHESS_TYPE_LABELS[type]}: renda diária`} className="w-24" suffix="♛" />
                      </Field>
                      <Field label="Pontos por hora">
                        <NumberField value={rules.pointsPerHour} range={BIGCHESS_POINTS_RANGE} step={0.01} onChange={(v) => update((d) => { d.pieces[type].pointsPerHour = v; })} disabled={disabled} label={`${BIGCHESS_TYPE_LABELS[type]}: pontos por hora`} className="w-24" />
                      </Field>
                      <Field label="Regeneração">
                        <NumberField value={rules.regenPercent} range={BIGCHESS_PERCENT_RANGE} onChange={(v) => update((d) => { d.pieces[type].regenPercent = v; })} disabled={disabled} label={`${BIGCHESS_TYPE_LABELS[type]}: regeneração`} className="w-20" suffix="% do HP" />
                      </Field>
                      <Field label="A cada" hint="15 s é só para testar">
                        <select
                          value={rules.regenIntervalSec}
                          disabled={disabled}
                          aria-label={`${BIGCHESS_TYPE_LABELS[type]}: intervalo de regeneração`}
                          onChange={(e) => update((d) => { d.pieces[type].regenIntervalSec = Number(e.target.value); })}
                          className={`${inputClass} w-full`}
                        >
                          {BIGCHESS_REGEN_INTERVAL_OPTIONS.map((sec) => (
                            <option key={sec} value={sec}>{regenIntervalLabel(sec)}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field label={`Benefícios (${rules.benefits.length}/${BIGCHESS_BENEFITS_MAX_LEN})`}>
                      <textarea
                        value={rules.benefits}
                        maxLength={BIGCHESS_BENEFITS_MAX_LEN}
                        disabled={disabled}
                        rows={2}
                        placeholder="Texto mostrado no card da peça (ex.: +5% de renda para peões vizinhos)."
                        onChange={(e) => update((d) => { d.pieces[type].benefits = e.target.value; })}
                        className={`${inputClass} mt-1 w-full resize-y font-sans`}
                      />
                    </Field>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section
            title="Capas"
            subtitle={`Itens com a badge "${BADGE_COVER}" no /admin/craft. Uma peça segura 1 capa; equipar a mesma capa de novo soma a duração.`}
            icon={<div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-2"><Shield className="h-4 w-4 text-sky-300" /></div>}
          >
            {coverItems.length === 0 && orphanCovers.length === 0 && (
              <p className="py-2 text-[11px] text-slate-500">
                Nenhum item com a badge <code className="font-mono text-slate-400">{BADGE_COVER}</code>. Adicione a badge em um item no /admin/craft e recarregue.
              </p>
            )}
            <div className="flex flex-col gap-2">
              {[...coverItems, ...orphanCovers].map((id) => {
                const rules = config.covers[id];
                const orphan = orphanCovers.includes(id);
                return (
                  <div key={id} className="rounded-lg border border-slate-700/50 bg-slate-950/40 p-3" data-testid={`cover-${id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {itemHeader(id, [BADGE_COVER], orphan)}
                      {rules ? (
                        <button
                          type="button"
                          onClick={() => update((d) => { delete d.covers[id]; })}
                          disabled={disabled}
                          className={`${buttonClass} border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20`}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remover regras
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => update((d) => { d.covers[id] = { damageReductionPercent: 25, durationSec: 3600 }; })}
                          disabled={disabled}
                          className={`${buttonClass} border border-sky-500/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20`}
                        >
                          <Plus className="h-3.5 w-3.5" /> Configurar capa
                        </button>
                      )}
                    </div>
                    {rules && (
                      <div className="mt-3 flex flex-wrap gap-4">
                        <Field label="Redução de dano">
                          <NumberField value={rules.damageReductionPercent} range={BIGCHESS_PERCENT_RANGE} onChange={(v) => update((d) => { d.covers[id].damageReductionPercent = v; })} disabled={disabled} label={`${nameOf(id)}: redução de dano`} suffix="%" />
                        </Field>
                        <Field label="Duração">
                          <DurationField seconds={rules.durationSec} onChange={(v) => update((d) => { d.covers[id].durationSec = v; })} disabled={disabled} label={`${nameOf(id)}: duração`} />
                        </Field>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          <Section
            title="Itens de defesa"
            subtitle={`Itens com a badge "${BADGE_DEFENSE_PIECE}" (2 slots por peça). Com "${BADGE_HP_PLUS}" aumentam o HP máximo; com "${BADGE_COUNTER_ATTACK}" revidam quem ataca a peça.`}
            icon={<div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2"><ShieldPlus className="h-4 w-4 text-emerald-300" /></div>}
          >
            {defenseItems.length === 0 && orphanDefenses.length === 0 && (
              <p className="py-2 text-[11px] text-slate-500">
                Nenhum item com a badge <code className="font-mono text-slate-400">{BADGE_DEFENSE_PIECE}</code>. Adicione a badge em um item no /admin/craft e recarregue.
              </p>
            )}
            <div className="flex flex-col gap-2">
              {[...defenseItems, ...orphanDefenses].map((id) => {
                const rules = config.defenses[id];
                const orphan = orphanDefenses.includes(id);
                const hasHpPlus = itemHasBadge(badges, id, BADGE_HP_PLUS);
                const hasCounter = itemHasBadge(badges, id, BADGE_COUNTER_ATTACK);
                const tags = [BADGE_DEFENSE_PIECE, ...(hasHpPlus ? [BADGE_HP_PLUS] : []), ...(hasCounter ? [BADGE_COUNTER_ATTACK] : [])];
                return (
                  <div key={id} className="rounded-lg border border-slate-700/50 bg-slate-950/40 p-3" data-testid={`defense-${id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {itemHeader(id, tags, orphan)}
                      {rules ? (
                        <button
                          type="button"
                          onClick={() => update((d) => { delete d.defenses[id]; })}
                          disabled={disabled}
                          className={`${buttonClass} border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20`}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remover regras
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            update((d) => {
                              d.defenses[id] = {
                                durationSec: 3600,
                                hpPlusPercent: hasHpPlus ? 10 : 0,
                                counterAttack: hasCounter ? { damage: 5, attackDurationSec: 10, radius: 120 } : null,
                              };
                            })
                          }
                          disabled={disabled}
                          className={`${buttonClass} border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20`}
                        >
                          <Plus className="h-3.5 w-3.5" /> Configurar defesa
                        </button>
                      )}
                    </div>
                    {rules && (
                      <div className="mt-3 flex flex-col gap-3">
                        <div className="flex flex-wrap gap-4">
                          <Field label="Duração">
                            <DurationField seconds={rules.durationSec} onChange={(v) => update((d) => { d.defenses[id].durationSec = v; })} disabled={disabled} label={`${nameOf(id)}: duração`} />
                          </Field>
                          {(hasHpPlus || rules.hpPlusPercent > 0) && (
                            <Field label="HP extra" hint={hasHpPlus ? undefined : 'item sem a badge hp-plus — zere para desativar'}>
                              <NumberField value={rules.hpPlusPercent} range={BIGCHESS_HP_PLUS_RANGE} onChange={(v) => update((d) => { d.defenses[id].hpPlusPercent = v; })} disabled={disabled} label={`${nameOf(id)}: HP extra`} suffix="% do HP" />
                            </Field>
                          )}
                        </div>
                        {(hasCounter || rules.counterAttack) && (
                          <Block title="Contra-ataque" hint="Quando a peça é atacada, revida por este tempo em quem estiver dentro do raio (dano por segundo).">
                            {rules.counterAttack ? (
                              <div className="flex flex-wrap items-end gap-4">
                                <Field label="Damage">
                                  <NumberField value={rules.counterAttack.damage} range={BIGCHESS_COUNTER_DAMAGE_RANGE} onChange={(v) => update((d) => { d.defenses[id].counterAttack!.damage = v; })} disabled={disabled} label={`${nameOf(id)}: dano do contra-ataque`} suffix="por segundo" />
                                </Field>
                                <Field label="Attack duration">
                                  <NumberField value={rules.counterAttack.attackDurationSec} range={BIGCHESS_COUNTER_DURATION_RANGE} onChange={(v) => update((d) => { d.defenses[id].counterAttack!.attackDurationSec = v; })} disabled={disabled} label={`${nameOf(id)}: duração do contra-ataque`} suffix="s" />
                                </Field>
                                <Field label="Radius">
                                  <NumberField value={rules.counterAttack.radius} range={BIGCHESS_COUNTER_RADIUS_RANGE} onChange={(v) => update((d) => { d.defenses[id].counterAttack!.radius = v; })} disabled={disabled} label={`${nameOf(id)}: raio do contra-ataque`} suffix="px" />
                                </Field>
                                <button
                                  type="button"
                                  onClick={() => update((d) => { d.defenses[id].counterAttack = null; })}
                                  disabled={disabled}
                                  className={`${buttonClass} border border-slate-700/60 bg-slate-800/80 hover:bg-slate-700/80`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" /> Sem contra-ataque
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => update((d) => { d.defenses[id].counterAttack = { damage: 5, attackDurationSec: 10, radius: 120 }; })}
                                disabled={disabled}
                                className={`${buttonClass} border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20`}
                              >
                                <Swords className="h-3.5 w-3.5" /> Ativar contra-ataque
                              </button>
                            )}
                          </Block>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          <Section
            title="Regras de Negócio da Big Chessboard"
            subtitle="Anotações livres do sistema (salvas junto com a configuração). Não afetam o jogo."
            icon={<div className="rounded-lg border border-slate-600/60 bg-slate-800/60 p-2"><Swords className="h-4 w-4 text-slate-300" /></div>}
          >
            <textarea
              value={config.notes}
              maxLength={BIGCHESS_NOTES_MAX_LEN}
              disabled={disabled}
              rows={10}
              placeholder="Ex.: peões só podem ser atacados por peças da cor oposta; o rei rende o dobro nos fins de semana…"
              onChange={(e) => update((d) => { d.notes = e.target.value; })}
              className={`${inputClass} w-full resize-y font-sans leading-relaxed`}
              data-testid="bigchess-notes"
            />
            <p className="mt-1 text-right font-mono text-[10px] text-slate-600">{config.notes.length}/{BIGCHESS_NOTES_MAX_LEN}</p>
          </Section>
        </div>
      </div>
    </div>
  );
}
