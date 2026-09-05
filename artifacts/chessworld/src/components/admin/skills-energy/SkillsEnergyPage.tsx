/**
 * /admin/skills-energy — "Skills and Character Energy".
 *
 * Uma página, duas seções, UM documento salvo de uma vez (botão Salvar):
 *   Energia → máximos globais, custos por ação, condições (fome/fraco/morte),
 *             velocidade fraco e energia por comida (itens com badge `edible`).
 *   Skills  → fórmula de nível (Base/Taxa/máximo), nome de cada habilidade
 *             (clique no nome para editar) e XP por ação; listas por badge
 *             (`forging`, `smelting`, `food`) e por recurso (mineração/lenhador).
 *
 * As listas por badge vêm do próprio jogo (badges do /admin/craft): o admin
 * só preenche os números.
 */
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Copy, Drumstick, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import {
  BASE_XP_RANGE,
  DEFAULT_COOKING_XP,
  DEFAULT_CRAFT_XP,
  DEFAULT_ENERGY_SKILLS_CONFIG,
  DEFAULT_NODE_XP,
  ENERGY_COST_RANGE,
  ENERGY_RANGE,
  ENERGY_THRESHOLD_ACTIONS,
  ENERGY_THRESHOLD_LABELS,
  ENERGY_TOOL_KINDS,
  ENERGY_TOOL_LABELS,
  FOOD_ENERGY_RANGE,
  MAX_ENERGY_THRESHOLDS,
  MAX_LEVEL_RANGE,
  MINING_RESOURCE_KEYS,
  SKILL_LABELS,
  SKILL_NAME_MAX_LEN,
  STRIKE_EVERY_RANGE,
  WEAK_SPEED_RANGE,
  WOODCUTTING_RESOURCE_KEYS,
  XP_RATE_RANGE,
  XP_VALUE_RANGE,
  parseEnergySkillsConfig,
  skillName,
  xpToNextLevel,
  type EnergySkillsConfig,
  type EnergyThreshold,
  type EnergyThresholdAction,
  type EnergyToolKind,
  type SkillId,
} from '../../../shared/progress/EnergySkillsShapes';
import { BADGE_EDIBLE, BADGE_FOOD, BADGE_FORGING, BADGE_SMELTING, isEdibleItem, itemsWithBadge, type CraftBadgeMap } from '../../../shared/craft/CraftBadges';
import { STATION_IDS, type StationId } from '../../../shared/craft/StationShapes';
import { useDocumentScrollUnlock } from '../../../hooks/useDocumentScrollUnlock';
import { resourceByKey } from '../../../lib/collection/resourceCatalog';
import { inventoryEntry, inventoryFallbackName, useInventoryVisualCatalog } from '../../../lib/inventory/inventoryVisualCatalog';
import { RigApiError } from '../rig-editor/rigApi';
import { CatalogThumb } from '../craft/CatalogThumb';
import { craftApi } from '../craft/craftApi';
import { energySkillsApi } from './energySkillsApi';

const inputClass =
  'rounded-md border border-slate-700/70 bg-slate-950/70 px-2 py-1.5 text-xs font-mono text-slate-200 focus:border-cyan-500/60 focus:outline-none disabled:opacity-40';
const buttonClass =
  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

const STATION_LABELS: Record<StationId, string> = {
  forja: 'Forja',
  'mesa-de-crafting': 'Mesa de crafting',
  fornalha: 'Fornalha',
  'estacao-de-pocoes': 'Estação de poções',
};

const clone = (config: EnergySkillsConfig): EnergySkillsConfig => JSON.parse(JSON.stringify(config)) as EnergySkillsConfig;

/** Campo numérico com digitação livre: só números válidos no range viram valor. */
function NumberField({
  value,
  onChange,
  range,
  step = 1,
  disabled,
  className = 'w-20',
  suffix,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  range: { min: number; max: number };
  step?: number;
  disabled?: boolean;
  className?: string;
  suffix?: string;
  label?: string;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const shown = raw ?? String(value);
  const invalid = raw !== null && (raw.trim() === '' || !Number.isFinite(Number(raw)) || Number(raw) < range.min || Number(raw) > range.max);
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        min={range.min}
        max={range.max}
        step={step}
        value={shown}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          setRaw(next);
          const n = Number(next);
          if (next.trim() !== '' && Number.isFinite(n) && n >= range.min && n <= range.max) onChange(step === 1 ? Math.round(n) : n);
        }}
        onBlur={() => setRaw(null)}
        className={`${inputClass} ${className} text-center ${invalid ? 'border-rose-500/60' : ''}`}
      />
      {suffix && <span className="text-[10px] text-slate-500">{suffix}</span>}
    </span>
  );
}

function Section({ title, subtitle, icon, children }: { title: ReactNode; subtitle?: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-700/60 bg-slate-900/70 p-4">
      <div className="mb-4 flex items-center gap-3">
        {icon}
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-950/40 p-3">
      <h3 className="text-[11px] font-mono uppercase tracking-widest text-slate-400">{title}</h3>
      {hint && <p className="mb-2 mt-0.5 text-[11px] text-slate-500">{hint}</p>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </div>
  );
}

function Row({ label, detail, children }: { label: ReactNode; detail?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-800/60 py-1.5 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-xs text-slate-200">{label}</div>
        {detail && <div className="truncate font-mono text-[10px] text-slate-500">{detail}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

export function SkillsEnergyPage() {
  useDocumentScrollUnlock();
  const catalog = useInventoryVisualCatalog();
  const [config, setConfig] = useState<EnergySkillsConfig>(() => clone(DEFAULT_ENERGY_SKILLS_CONFIG));
  const [saved, setSaved] = useState<EnergySkillsConfig>(() => clone(DEFAULT_ENERGY_SKILLS_CONFIG));
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  /** false = o banco ainda não tem linha: a tela mostra os defaults e "Salvar" grava-os mesmo sem mexer em nada. */
  const [persisted, setPersisted] = useState(true);
  const [tableSql, setTableSql] = useState<string | null>(null);
  const [progressTableSql, setProgressTableSql] = useState<string | null>(null);
  const [badges, setBadges] = useState<CraftBadgeMap>({});
  // Aba inicial pelo hash (#skills) — dá para linkar direto da administração.
  const [tab, setTabState] = useState<'energy' | 'skills'>(() =>
    typeof window !== 'undefined' && window.location.hash === '#skills' ? 'skills' : 'energy',
  );
  const setTab = (next: 'energy' | 'skills') => {
    setTabState(next);
    if (typeof window !== 'undefined') window.history.replaceState(null, '', next === 'skills' ? '#skills' : window.location.pathname);
  };

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
      const [res, badgesRes] = await Promise.all([
        energySkillsApi.get(),
        craftApi.badges.list().catch(() => null),
      ]);
      // `config` pode vir null (servidor antigo sem tabela/linha) ou fora do
      // formato: normaliza pelo parser, que preenche os defaults.
      const parsed = parseEnergySkillsConfig(res.config ?? DEFAULT_ENERGY_SKILLS_CONFIG);
      const loadedConfig = parsed.ok ? parsed.config : DEFAULT_ENERGY_SKILLS_CONFIG;
      if (!parsed.ok) setError(`Configuração salva no banco está inválida (usando os padrões): ${parsed.errors.join('; ')}`);
      setConfig(clone(loadedConfig));
      setSaved(clone(loadedConfig));
      setPersisted(res.saved !== false && res.config !== null);
      setTableMissing(res.tableMissing);
      setTableSql(res.tableMissing ? (res.tableSql ?? null) : null);
      setProgressTableSql(res.progressTableSql ?? null);
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
  const validation = useMemo(() => parseEnergySkillsConfig(config), [config]);

  const update = (fn: (draft: EnergySkillsConfig) => void) => {
    setConfig((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });
    setSuccess(null);
  };

  const save = async () => {
    const parsed = parseEnergySkillsConfig(config);
    if (!parsed.ok) {
      setError(`Configuração inválida: ${parsed.errors.join('; ')}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await energySkillsApi.save(parsed.config);
      setConfig(clone(res.config));
      setSaved(clone(res.config));
      setPersisted(true);
      setTableMissing(false);
      setSuccess('Configuração salva. O servidor aplica na hora (cache de 30 s para o HUD).');
    } catch (cause) {
      applyError(cause);
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------ listas derivadas
  /** Culinária: tudo que tem pelo menos `food` (ingrediente ou prato). */
  const foodItems = useMemo(() => itemsWithBadge(badges, BADGE_FOOD), [badges]);
  /** Comer: só o que tem `edible` (energia por unidade). */
  const edibleItems = useMemo(() => itemsWithBadge(badges, BADGE_EDIBLE), [badges]);
  const forgingItems = useMemo(() => itemsWithBadge(badges, BADGE_FORGING), [badges]);
  const smeltingItems = useMemo(() => itemsWithBadge(badges, BADGE_SMELTING), [badges]);
  const foodTag = (id: string) => (isEdibleItem(badges, id) ? 'comestível' : 'ingrediente');

  const nameOf = (id: string) => inventoryEntry(catalog, id)?.name ?? inventoryFallbackName(id);
  const thumbOf = (id: string) => inventoryEntry(catalog, id)?.thumb ?? null;
  const resourceLabel = (key: string) => resourceByKey.get(key)?.label ?? key;
  const disabled = busy || !loaded;

  const itemRows = (
    ids: string[],
    values: Record<string, number>,
    fallback: number,
    range: { min: number; max: number },
    onChange: (id: string, value: number) => void,
    suffix: string,
    empty: string,
    tagOf?: (id: string) => string | null,
  ) =>
    ids.length === 0 ? (
      <p className="py-2 text-[11px] text-slate-500">{empty}</p>
    ) : (
      ids.map((id) => {
        const thumb = thumbOf(id);
        const tag = tagOf?.(id) ?? null;
        return (
          <Row
            key={id}
            label={
              <span className="flex items-center gap-2">
                {thumb && <CatalogThumb thumb={thumb} size={24} />}
                <span className="truncate">{nameOf(id)}</span>
                {tag && (
                  <span
                    className={`shrink-0 rounded border px-1 py-px text-[9px] font-mono uppercase tracking-wide ${
                      tag === 'comestível' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-slate-600/50 bg-slate-700/30 text-slate-400'
                    }`}
                  >
                    {tag}
                  </span>
                )}
              </span>
            }
            detail={id}
          >
            <NumberField value={values[id] ?? fallback} range={range} onChange={(v) => onChange(id, v)} disabled={disabled} suffix={suffix} label={`${nameOf(id)}: ${suffix}`} />
          </Row>
        );
      })
    );

  const renameSkill = (id: SkillId, name: string) => update((d) => { d.skills.names[id] = name; });
  const skillTitle = (id: SkillId) => (
    <SkillNameEditor id={id} value={skillName(config.skills, id)} disabled={disabled} onCommit={(name) => renameSkill(id, name)} />
  );

  const levelPreview = useMemo(() => {
    const rows: Array<{ level: number; xp: number }> = [];
    for (const level of [1, 2, 5, 10, 20, 50]) {
      if (level >= config.skills.maxLevel) break;
      rows.push({ level, xp: xpToNextLevel(config.skills, level) });
    }
    return rows;
  }, [config.skills]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 [background-image:radial-gradient(circle_at_20%_0%,rgba(251,191,36,0.06),transparent_45%),radial-gradient(circle_at_80%_100%,rgba(16,185,129,0.06),transparent_45%)]">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <header className="mb-5 flex flex-wrap items-center gap-3">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
            <Sparkles className="h-5 w-5 text-amber-300" />
          </div>
          <div>
            <h1 className="bg-gradient-to-r from-amber-300 via-orange-300 to-emerald-300 bg-clip-text text-xl font-semibold text-transparent">
              Skills and Character Energy
            </h1>
            <p className="font-mono text-[11px] text-slate-500">energia do personagem · custos por ação · XP e níveis das habilidades</p>
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
              data-testid="save-energy-skills"
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
            text="A tabela de configuração de energia/habilidades ainda não existe. Rode uma vez no SQL editor do Supabase e clique em Recarregar:"
            sql={tableSql}
          />
        )}
        {loaded && !tableMissing && !persisted && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            Nada salvo no banco ainda — o jogo está usando os valores padrão mostrados abaixo. Clique em <strong>Salvar</strong> para gravá-los (ou ajuste antes).
          </div>
        )}
        {loaded && progressTableSql && (
          <details className="mb-4 rounded-lg border border-slate-700/60 bg-slate-900/60 p-3 text-xs text-slate-300">
            <summary className="cursor-pointer select-none font-medium text-slate-200">
              SQL da tabela de progresso dos jogadores (player_progress) — rode uma vez para energia e XP persistirem
            </summary>
            <SqlBox sql={progressTableSql} className="mt-2" />
          </details>
        )}

        <div className="mb-4 inline-flex rounded-lg border border-slate-700/60 bg-slate-900/70 p-1" role="tablist">
          {(
            [
              { id: 'energy', label: 'Energia', icon: <Drumstick className="h-3.5 w-3.5" /> },
              { id: 'skills', label: 'Skills', icon: <Sparkles className="h-3.5 w-3.5" /> },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`${buttonClass} ${tab === t.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === 'energy' ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Section
              title="Limites globais"
              subtitle="Valem para todos os personagens."
              icon={<div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2"><Drumstick className="h-4 w-4 text-amber-300" /></div>}
            >
              <Block title="Máximos">
                <Row label="Energia máxima" detail="energy.maxEnergy">
                  <NumberField value={config.energy.maxEnergy} range={ENERGY_RANGE} onChange={(v) => update((d) => { d.energy.maxEnergy = v; })} disabled={disabled} label="Energia máxima" />
                </Row>
                <Row label="Vida (HP) máxima" detail="energy.maxHp">
                  <NumberField value={config.energy.maxHp} range={ENERGY_RANGE} onChange={(v) => update((d) => { d.energy.maxHp = v; })} disabled={disabled} label="HP máximo" />
                </Row>
                <Row label="Velocidade ao andar quando fraco" detail="% da velocidade normal">
                  <NumberField value={config.energy.weakSpeedPercent} range={WEAK_SPEED_RANGE} onChange={(v) => update((d) => { d.energy.weakSpeedPercent = v; })} disabled={disabled} suffix="%" label="Velocidade fraco" />
                </Row>
              </Block>

              <div className="mt-3">
                <Block
                  title="Condições de energia"
                  hint="Quando a energia atingir X% (ou menos) → ação. Fraco: anda devagar e não usa picareta/machado/facão/tesoura. Morrer: desmaia como em combate e volta com energia cheia."
                >
                  <div className="space-y-1.5">
                    {config.energy.thresholds.map((threshold, index) => (
                      <div key={index} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-800/80 bg-slate-950/50 px-2 py-1.5">
                        <span className="text-[11px] text-slate-400">Energia atingir</span>
                        <NumberField
                          value={threshold.percent}
                          range={{ min: 0, max: 100 }}
                          onChange={(v) => update((d) => { d.energy.thresholds[index].percent = v; })}
                          disabled={disabled}
                          className="w-16"
                          suffix="%"
                          label={`Condição ${index + 1}: percentual`}
                        />
                        <span className="text-[11px] text-slate-400">→</span>
                        <select
                          value={threshold.action}
                          onChange={(e) => update((d) => { d.energy.thresholds[index].action = e.target.value as EnergyThresholdAction; })}
                          disabled={disabled}
                          className={`${inputClass} w-40`}
                          aria-label={`Condição ${index + 1}: ação`}
                        >
                          {ENERGY_THRESHOLD_ACTIONS.map((action) => (
                            <option key={action} value={action}>{ENERGY_THRESHOLD_LABELS[action]}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => update((d) => { d.energy.thresholds.splice(index, 1); })}
                          disabled={disabled}
                          className="ml-auto rounded-md p-1 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-40"
                          title="Remover condição"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {config.energy.thresholds.length === 0 && (
                      <p className="text-[11px] text-slate-500">Sem condições: a energia só desce, sem efeitos.</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => update((d) => { d.energy.thresholds.push({ percent: 50, action: 'hungry' } satisfies EnergyThreshold); })}
                    disabled={disabled || config.energy.thresholds.length >= MAX_ENERGY_THRESHOLDS}
                    className={`${buttonClass} mt-2 border border-dashed border-slate-600/60 text-slate-300 hover:border-cyan-500/60 hover:text-cyan-200`}
                  >
                    <Plus className="h-3.5 w-3.5" /> Adicionar condição
                  </button>
                </Block>
              </div>
            </Section>

            <Section
              title="Custos de energia"
              subtitle="Quanto cada ação consome. Golpes: X de energia a cada N golpes que acertam."
              icon={<div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-2"><Drumstick className="h-4 w-4 text-orange-300" /></div>}
            >
              <div className="space-y-3">
                <Block title="Golpes com ferramenta" hint="Só golpes que conectam num recurso/animal contam.">
                  {ENERGY_TOOL_KINDS.map((kind: EnergyToolKind) => (
                    <Row key={kind} label={ENERGY_TOOL_LABELS[kind]} detail={`energy.toolStrike.${kind}`}>
                      <NumberField value={config.energy.toolStrike[kind].amount} range={ENERGY_COST_RANGE} onChange={(v) => update((d) => { d.energy.toolStrike[kind].amount = v; })} disabled={disabled} className="w-16" label={`${ENERGY_TOOL_LABELS[kind]}: energia`} />
                      <span className="text-[10px] text-slate-500">a cada</span>
                      <NumberField value={config.energy.toolStrike[kind].every} range={STRIKE_EVERY_RANGE} onChange={(v) => update((d) => { d.energy.toolStrike[kind].every = v; })} disabled={disabled} className="w-16" suffix="golpes" label={`${ENERGY_TOOL_LABELS[kind]}: a cada quantos golpes`} />
                    </Row>
                  ))}
                </Block>
                <Block title="Combate">
                  <Row label="Golpe de arma/mão em criatura ou animal" detail="energy.creatureStrike">
                    <NumberField value={config.energy.creatureStrike.amount} range={ENERGY_COST_RANGE} onChange={(v) => update((d) => { d.energy.creatureStrike.amount = v; })} disabled={disabled} className="w-16" label="Golpe em criatura: energia" />
                    <span className="text-[10px] text-slate-500">a cada</span>
                    <NumberField value={config.energy.creatureStrike.every} range={STRIKE_EVERY_RANGE} onChange={(v) => update((d) => { d.energy.creatureStrike.every = v; })} disabled={disabled} className="w-16" suffix="golpes" label="Golpe em criatura: a cada quantos" />
                  </Row>
                  <Row label="Levar dano (por golpe recebido)" detail="energy.damageTaken">
                    <NumberField value={config.energy.damageTaken} range={ENERGY_COST_RANGE} onChange={(v) => update((d) => { d.energy.damageTaken = v; })} disabled={disabled} className="w-16" label="Levar dano: energia" />
                  </Row>
                </Block>
                <Block title="Criação" hint="Por craft executado (× quantidade). Vale para a estação pública e para a portátil da mesma família.">
                  {STATION_IDS.map((stationId) => (
                    <Row key={stationId} label={STATION_LABELS[stationId]} detail={`energy.craftByStation.${stationId}`}>
                      <NumberField value={config.energy.craftByStation[stationId]} range={ENERGY_COST_RANGE} onChange={(v) => update((d) => { d.energy.craftByStation[stationId] = v; })} disabled={disabled} className="w-16" suffix="por craft" label={`${STATION_LABELS[stationId]}: energia por craft`} />
                    </Row>
                  ))}
                  <Row label="Peça do tabuleiro central" detail="energy.boardPieceCraft · ainda sem gancho no jogo">
                    <NumberField value={config.energy.boardPieceCraft} range={ENERGY_COST_RANGE} onChange={(v) => update((d) => { d.energy.boardPieceCraft = v; })} disabled={disabled} className="w-16" label="Peça do tabuleiro: energia" />
                  </Row>
                  <Row label="Construir estação privada" detail="energy.buildStation · ao criar item de estação portátil">
                    <NumberField value={config.energy.buildStation} range={ENERGY_COST_RANGE} onChange={(v) => update((d) => { d.energy.buildStation = v; })} disabled={disabled} className="w-16" label="Construir estação: energia" />
                  </Row>
                </Block>
              </div>
            </Section>

            <div className="xl:col-span-2">
              <Section
                title="Comidas"
                subtitle="Itens com a badge `edible` (comestíveis, definida em /admin/craft). Itens só com `food` são ingredientes e não podem ser comidos. Comer = arrastar para a hotbar e clicar: cada unidade repõe esta energia; o jogador come só o necessário até encher."
                icon={<div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2"><Drumstick className="h-4 w-4 text-emerald-300" /></div>}
              >
                <Block title="Energia por unidade" hint="0 = alimento ainda sem energia (não dá para comer).">
                  {itemRows(
                    edibleItems,
                    config.energy.foods,
                    0,
                    FOOD_ENERGY_RANGE,
                    (id, v) => update((d) => { d.energy.foods[id] = v; }),
                    'energia',
                    'Nenhum item com a badge `edible` ainda. Adicione `food` + `edible` em /admin/craft.',
                  )}
                </Block>
              </Section>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="xl:col-span-2">
              <Section
                title="Níveis"
                subtitle="Todas as habilidades começam no nível 1. XP necessário para o próximo nível = Base × Taxa ^ (Nível − 1)."
                icon={<div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2"><Sparkles className="h-4 w-4 text-amber-300" /></div>}
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr]">
                  <Block title="Fórmula">
                    <Row label="XP base" detail="skills.baseXp · XP para sair do nível 1">
                      <NumberField value={config.skills.baseXp} range={BASE_XP_RANGE} onChange={(v) => update((d) => { d.skills.baseXp = v; })} disabled={disabled} className="w-24" label="XP base" />
                    </Row>
                    <Row label="Taxa" detail="skills.rate · multiplicador por nível">
                      <NumberField value={config.skills.rate} range={XP_RATE_RANGE} step={0.05} onChange={(v) => update((d) => { d.skills.rate = v; })} disabled={disabled} className="w-24" label="Taxa" />
                    </Row>
                    <Row label="Nível máximo" detail="skills.maxLevel">
                      <NumberField value={config.skills.maxLevel} range={MAX_LEVEL_RANGE} onChange={(v) => update((d) => { d.skills.maxLevel = v; })} disabled={disabled} className="w-24" label="Nível máximo" />
                    </Row>
                  </Block>
                  <Block title="Prévia" hint="XP necessário para subir a partir de cada nível.">
                    <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px]">
                      {levelPreview.map((row) => (
                        <div key={row.level} className="rounded-md border border-slate-800/80 bg-slate-950/50 px-2 py-1">
                          <span className="text-slate-500">Nv {row.level} → {row.level + 1}</span>
                          <div className="text-amber-200">{row.xp.toLocaleString('pt-BR')} XP</div>
                        </div>
                      ))}
                    </div>
                  </Block>
                </div>
              </Section>
            </div>

            <Section title={skillTitle('mining')} subtitle="XP por nó mineral quebrado." icon={<SkillIcon />}>
              <Block title="Por mineral">
                {MINING_RESOURCE_KEYS.map((key) => (
                  <Row key={key} label={resourceLabel(key)} detail={key}>
                    <NumberField value={config.skills.mining[key] ?? DEFAULT_NODE_XP} range={XP_VALUE_RANGE} onChange={(v) => update((d) => { d.skills.mining[key] = v; })} disabled={disabled} suffix="XP" label={`${resourceLabel(key)}: XP`} />
                  </Row>
                ))}
              </Block>
            </Section>

            <Section title={skillTitle('woodcutting')} subtitle="XP por árvore derrubada." icon={<SkillIcon />}>
              <Block title="Por árvore">
                {WOODCUTTING_RESOURCE_KEYS.map((key) => (
                  <Row key={key} label={resourceLabel(key)} detail={key}>
                    <NumberField value={config.skills.woodcutting[key] ?? DEFAULT_NODE_XP} range={XP_VALUE_RANGE} onChange={(v) => update((d) => { d.skills.woodcutting[key] = v; })} disabled={disabled} suffix="XP" label={`${resourceLabel(key)}: XP`} />
                  </Row>
                ))}
              </Block>
            </Section>

            <Section title={skillTitle('fighting')} subtitle="XP ao terminar uma luta." icon={<SkillIcon />}>
              <Block title="Contra jogadores">
                <Row label="Vencer" detail="skills.fighting.pvpWin">
                  <NumberField value={config.skills.fighting.pvpWin} range={XP_VALUE_RANGE} onChange={(v) => update((d) => { d.skills.fighting.pvpWin = v; })} disabled={disabled} suffix="XP" label="PvP vencer" />
                </Row>
                <Row label="Perder" detail="skills.fighting.pvpLoss">
                  <NumberField value={config.skills.fighting.pvpLoss} range={XP_VALUE_RANGE} onChange={(v) => update((d) => { d.skills.fighting.pvpLoss = v; })} disabled={disabled} suffix="XP" label="PvP perder" />
                </Row>
              </Block>
              <div className="mt-3">
                <Block title="Contra monstros" hint="Ainda não há monstros no jogo — os valores ficam prontos para quando houver.">
                  <Row label="Vencer" detail="skills.fighting.pveWin">
                    <NumberField value={config.skills.fighting.pveWin} range={XP_VALUE_RANGE} onChange={(v) => update((d) => { d.skills.fighting.pveWin = v; })} disabled={disabled} suffix="XP" label="PvE vencer" />
                  </Row>
                  <Row label="Perder" detail="skills.fighting.pveLoss">
                    <NumberField value={config.skills.fighting.pveLoss} range={XP_VALUE_RANGE} onChange={(v) => update((d) => { d.skills.fighting.pveLoss = v; })} disabled={disabled} suffix="XP" label="PvE perder" />
                  </Row>
                </Block>
              </div>
            </Section>

            <Section title={skillTitle('hunting')} subtitle="Sem regras por enquanto." icon={<SkillIcon muted />}>
              <p className="text-xs text-slate-500">Habilidade reservada — aparece no personagem no nível 1, sem forma de ganhar XP ainda.</p>
            </Section>

            <Section title={skillTitle('forging')} subtitle="Itens com a badge `forging`: XP ao forjar (× quantidade)." icon={<SkillIcon />}>
              <Block title="Por item">
                {itemRows(forgingItems, config.skills.forging, DEFAULT_CRAFT_XP, XP_VALUE_RANGE, (id, v) => update((d) => { d.skills.forging[id] = v; }), 'XP', 'Nenhum item com a badge `forging`. Adicione em /admin/craft.')}
              </Block>
            </Section>

            <Section title={skillTitle('smelting')} subtitle="Itens com a badge `smelting`: XP ao fundir (× quantidade)." icon={<SkillIcon />}>
              <Block title="Por item">
                {itemRows(smeltingItems, config.skills.smelting, DEFAULT_CRAFT_XP, XP_VALUE_RANGE, (id, v) => update((d) => { d.skills.smelting[id] = v; }), 'XP', 'Nenhum item com a badge `smelting`. Adicione em /admin/craft.')}
              </Block>
            </Section>

            <div className="xl:col-span-2">
              <Section
                title={skillTitle('cooking')}
                subtitle="Todo item com pelo menos a badge `food` — prato ou ingrediente. O XP é por unidade obtida: ao cozinhar (× quantidade, em qualquer estação) ou ao coletar do chão (ex.: carne crua)."
                icon={<SkillIcon />}
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[3fr_2fr]">
                  <Block title="Itens com a badge `food`" hint="`comestível` = também tem `edible` (pode ser comido); `ingrediente` = só `food`.">
                    {itemRows(
                      foodItems,
                      config.skills.cooking.items,
                      DEFAULT_COOKING_XP,
                      XP_VALUE_RANGE,
                      (id, v) => update((d) => { d.skills.cooking.items[id] = v; }),
                      'XP',
                      'Nenhum item com a badge `food` ainda. Adicione em /admin/craft.',
                      foodTag,
                    )}
                  </Block>
                  <Block title="Comer">
                    <Row label="XP a cada vez que come" detail="skills.cooking.eat">
                      <NumberField value={config.skills.cooking.eat} range={XP_VALUE_RANGE} onChange={(v) => update((d) => { d.skills.cooking.eat = v; })} disabled={disabled} suffix="XP" label="Comer: XP" />
                    </Row>
                  </Block>
                </div>
              </Section>
            </div>

            <Section title={skillTitle('alchemy')} subtitle="Itens com a badge `potion` — sem regras por enquanto." icon={<SkillIcon muted />}>
              <p className="text-xs text-slate-500">Reservada: o servidor já reconhece a badge `potion`, mas ainda não concede XP.</p>
            </Section>
            <Section title={skillTitle('trading')} subtitle="Sem regras por enquanto." icon={<SkillIcon muted />}>
              <p className="text-xs text-slate-500">Reservada para o futuro sistema de trocas.</p>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Nome da habilidade editável no lugar: clique vira input; Enter/blur salva no
 * rascunho (entra no documento com o botão Salvar), Esc cancela, vazio volta
 * ao nome anterior.
 */
function SkillNameEditor({ id, value, disabled, onCommit }: { id: SkillId; value: string; disabled: boolean; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const commit = () => {
    if (draft === null) return;
    const name = draft.trim().replace(/\s+/g, ' ').slice(0, SKILL_NAME_MAX_LEN);
    setDraft(null);
    if (name.length > 0 && name !== value) onCommit(name);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(null);
    }
  };
  const isDefault = value === SKILL_LABELS[id];
  return (
    <span className="flex flex-wrap items-center gap-2">
      {editing ? (
        <input
          autoFocus
          value={draft}
          maxLength={SKILL_NAME_MAX_LEN}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          aria-label={`Nome da habilidade ${id}`}
          className={`${inputClass} w-44 py-1 text-sm font-semibold`}
        />
      ) : (
        <button
          type="button"
          onClick={() => setDraft(value)}
          disabled={disabled}
          title="Clique para renomear a habilidade"
          data-testid={`skill-name-${id}`}
          className="group inline-flex items-center gap-1.5 rounded-md border border-transparent px-1 py-0.5 text-left text-sm font-semibold text-slate-100 transition-colors hover:border-slate-700/70 hover:bg-slate-800/70 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span>{value}</span>
          <Pencil className="h-3 w-3 text-slate-500 opacity-60 transition-opacity group-hover:opacity-100" />
        </button>
      )}
      <span className="font-mono text-[10px] text-slate-500">
        {id}
        {!isDefault && <span className="ml-1 text-slate-600">· padrão: {SKILL_LABELS[id]}</span>}
      </span>
    </span>
  );
}

function SkillIcon({ muted = false }: { muted?: boolean }) {
  return (
    <div className={`rounded-lg border p-2 ${muted ? 'border-slate-700/60 bg-slate-800/40' : 'border-amber-500/30 bg-amber-500/10'}`}>
      <Sparkles className={`h-4 w-4 ${muted ? 'text-slate-500' : 'text-amber-300'}`} />
    </div>
  );
}

function SqlBox({ sql, className = '' }: { sql: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <pre className="overflow-x-auto rounded-md border border-amber-500/20 bg-slate-950/70 p-2.5 pr-10 text-[10px] leading-relaxed text-amber-100/90">{sql}</pre>
      <button
        type="button"
        title="Copiar SQL"
        onClick={() => void navigator.clipboard.writeText(sql)}
        className="absolute right-1.5 top-1.5 rounded-md bg-slate-800/90 p-1.5 text-slate-300 hover:bg-slate-700"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function SqlBanner({ text, sql }: { text: string; sql: string | null }) {
  return (
    <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
      <p className="mb-1.5 font-medium">{text}</p>
      {sql && <SqlBox sql={sql} />}
    </div>
  );
}
