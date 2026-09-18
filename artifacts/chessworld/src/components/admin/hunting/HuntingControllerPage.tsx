import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Move, Plus, Save, Target, Trash2 } from 'lucide-react';
import {
  DEFAULT_CONTRACT_INITIAL_PERCENT,
  DEFAULT_CONTRACT_REFILL_BATCH,
  DEFAULT_SPEED_BY_LEVEL,
  DEFAULT_WALK_SPEED_BY_LEVEL,
  HP_REGEN_LABELS,
  HP_REGEN_OPTIONS,
  HUNTING_LEVEL_PROFILES,
  HUNTING_LEVEL_LABELS,
  HUNTING_LEVELS,
  HUNTING_LIMITS,
  LEVEL_PROFILE_FIELDS,
  MONSTER_TREE_ANIMAL_KEY,
  RESIDENT_REACTIONS,
  RESIDENT_REACTION_LABELS,
  configuredAnimalCount,
  contractSpawnBatch,
  defaultHuntingConfig,
  defaultLevelProfiles,
  defaultVariantConfig,
  parseHuntingConfig,
  type AnimalVariantConfig,
  type HpRegenSeconds,
  type HuntingCategory,
  type HuntingConfig,
  type HuntingContractConfig,
  type HuntingLevel,
  type HuntingManifest,
  type HuntingManifestAnimal,
} from '../../../shared/hunting/HuntingShapes';
import { CRAFTING_WORLD_MAP } from '../../../shared/hunting/craftingWorldMapData';
import { useDocumentScrollUnlock } from '../../../hooks/useDocumentScrollUnlock';
import { huntingApi } from '../../../lib/hunting/huntingApi';
import { RigApiError } from '../rig-editor/rigApi';
import { NumberField, SqlBox, inputClass } from '../shared/AdminFields';
import { AnimalRigPanel } from './AnimalRigPanel';

type Tab = 'hunts' | 'residents' | 'contracts' | 'ai' | 'general';
const clone = (value: HuntingConfig): HuntingConfig => JSON.parse(JSON.stringify(value)) as HuntingConfig;
const button = 'inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-40';
const range = (min: number, max: number) => ({ min, max });

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-300">
    <input type="checkbox" className="accent-cyan-500" checked={checked} onChange={(event) => onChange(event.target.checked)} /> {label}
  </label>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1"><span className="block text-[10px] uppercase tracking-wide text-slate-500">{label}</span>{children}</label>;
}

function VariantEditor({ variantId, variant, manifest, category, update }: {
  variantId: string;
  variant: AnimalVariantConfig;
  manifest: HuntingManifestAnimal['variants'][number];
  category: HuntingCategory;
  update: (apply: (next: AnimalVariantConfig) => void) => void;
}) {
  const thumbScale = Math.min(2, 72 / Math.max(manifest.frameWidth, manifest.frameHeight));
  return <div className="rounded-lg border border-slate-700/60 bg-slate-900/70 p-3">
    <div className="mb-3 flex items-center gap-3">
      <div className="shrink-0 rounded border border-slate-700 bg-slate-950" style={{
        width: manifest.frameWidth * thumbScale, height: manifest.frameHeight * thumbScale,
        backgroundImage: `url("${manifest.url}")`,
        backgroundSize: `${manifest.width * thumbScale}px ${manifest.height * thumbScale}px`,
        backgroundPosition: '0 0', imageRendering: 'pixelated',
      }} />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-200">{manifest.file}</p>
        <p className="truncate font-mono text-[10px] text-slate-600">{variantId}</p>
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="Nome"><input className={`${inputClass} w-full`} value={variant.name} maxLength={HUNTING_LIMITS.nameLength} onChange={(event) => update((next) => { next.name = event.target.value; })} /></Field>
      <Field label="HP"><NumberField value={variant.hp} range={HUNTING_LIMITS.hp} className="w-full" onChange={(value) => update((next) => { next.hp = value; })} /></Field>
      <Field label="Dano"><NumberField value={variant.damage} range={HUNTING_LIMITS.damage} className="w-full" onChange={(value) => update((next) => { next.damage = value; })} /></Field>
      <Field label="XP"><div className="flex items-center gap-2"><NumberField value={variant.xp} range={HUNTING_LIMITS.xp} disabled={!variant.xpEnabled} onChange={(value) => update((next) => { next.xp = value; })} /><Toggle checked={variant.xpEnabled} label="dá XP" onChange={(value) => update((next) => { next.xpEnabled = value; })} /></div></Field>
      <Field label="Nível"><select className={`${inputClass} w-full`} value={variant.level} onChange={(event) => update((next) => { next.level = event.target.value as AnimalVariantConfig['level']; })}>
        {HUNTING_LEVELS.map((level) => <option key={level} value={level}>{HUNTING_LEVEL_LABELS[level]}</option>)}
      </select></Field>
      <Field label="Quantidade no mapa">
        <div className="flex items-center gap-2">
          {variant.spawnMode === 'fixed'
            ? <NumberField value={variant.spawnCount} range={HUNTING_LIMITS.spawnCount} onChange={(value) => update((next) => { next.spawnCount = value; })} />
            : <>
              <NumberField label="mín" value={variant.spawnMin} range={HUNTING_LIMITS.spawnCount} onChange={(value) => update((next) => { next.spawnMin = value; })} />
              <span className="text-[10px] text-slate-500">mín</span>
              <NumberField label="máx" value={variant.spawnMax} range={HUNTING_LIMITS.spawnCount} onChange={(value) => update((next) => { next.spawnMax = value; })} />
              <span className="text-[10px] text-slate-500">máx</span>
            </>}
          <Toggle checked={variant.spawnMode === 'random'} label="random" onChange={(value) => update((next) => { next.spawnMode = value ? 'random' : 'fixed'; })} />
        </div>
        <p className="mt-1 text-[10px] text-slate-500">{variant.spawnMode === 'fixed'
          ? 'Anchors são só pontos de spawn: pode passar do total de anchors (animais repetem anchor).'
          : variant.spawnMax < variant.spawnMin
            ? `Faixa invertida: vale de ${variant.spawnMax} a ${variant.spawnMin} (ajustada ao salvar).`
            : 'O sistema sorteia uma quantidade entre mín e máx quando o mundo abre.'}</p>
      </Field>
      <Field label="Distância de combat break"><NumberField value={variant.combatBreakDistance} range={HUNTING_LIMITS.combatBreak} suffix="px" onChange={(value) => update((next) => { next.combatBreakDistance = value; })} /></Field>
      <Field label="Regeneração de HP"><select className={`${inputClass} w-full`} value={variant.hpRegenSeconds} onChange={(event) => update((next) => { next.hpRegenSeconds = Number(event.target.value) as HpRegenSeconds; })}>
        {HP_REGEN_OPTIONS.map((seconds) => <option key={seconds} value={seconds}>{HP_REGEN_LABELS[seconds]}</option>)}
      </select></Field>
      <Field label="Ataque à distância">
        <Toggle checked={variant.canShoot} label="também atira" onChange={(value) => update((next) => { next.canShoot = value; })} />
        <p className="mt-1 text-[10px] text-slate-500">mantém a mordida (hitbox) e, quando o alvo está fora do alcance dela, dispara um projétil com o mesmo dano; alcance, velocidade e cadência vêm do nível (aba Comportamento)</p>
      </Field>
    </div>
    <div className="mt-3">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Velocidade por nível (px/s)</p>
      <table className="text-xs">
        <thead><tr>
          <th className="pr-2 text-left font-normal text-slate-500"></th>
          {HUNTING_LEVELS.map((level) => <th key={level} className={`px-1 pb-1 text-center text-[10px] font-medium ${variant.level === level ? 'text-cyan-300' : 'text-slate-400'}`}>{HUNTING_LEVEL_LABELS[level]}{variant.level === level ? ' ●' : ''}</th>)}
        </tr></thead>
        <tbody>
          <tr>
            <td className="pr-2 text-[11px] text-slate-300">Correndo</td>
            {HUNTING_LEVELS.map((level) => <td key={level} className={`p-0.5 ${variant.level === level ? 'rounded bg-cyan-950/30' : ''}`}>
              <NumberField value={variant.speedByLevel[level] ?? DEFAULT_SPEED_BY_LEVEL[level]} range={HUNTING_LIMITS.speed} className="w-16" onChange={(value) => update((next) => { next.speedByLevel[level] = value; })} />
            </td>)}
          </tr>
          <tr>
            <td className="pr-2 text-[11px] text-slate-300">Andando</td>
            {HUNTING_LEVELS.map((level) => <td key={level} className={`p-0.5 ${variant.level === level ? 'rounded bg-cyan-950/30' : ''}`}>
              <NumberField value={variant.walkSpeedByLevel?.[level] ?? DEFAULT_WALK_SPEED_BY_LEVEL[level]} range={HUNTING_LIMITS.speed} className="w-16" onChange={(value) => update((next) => { if (!next.walkSpeedByLevel) next.walkSpeedByLevel = { ...DEFAULT_WALK_SPEED_BY_LEVEL }; next.walkSpeedByLevel[level] = value; })} />
            </td>)}
          </tr>
        </tbody>
      </table>
      {(variant.walkSpeedByLevel?.[variant.level] ?? DEFAULT_WALK_SPEED_BY_LEVEL[variant.level]) >= (variant.speedByLevel[variant.level] ?? DEFAULT_SPEED_BY_LEVEL[variant.level])
        && <p className="mt-1 text-[10px] text-amber-300">No nível marcado este animal anda tão rápido quanto corre (ou mais).</p>}
      <p className="mt-1 text-[10px] text-slate-500">vale a coluna do nível marcado (●). <b>Correndo</b>: perseguição, fuga e esquiva — velocidade média da corrida, que é uma sequência de saltos (agachado → impulso → voo); o deslocamento e a duração de cada salto valem para todos os animais e são definidos na <Link to="/dev/caca" className="text-cyan-300 underline">bancada do salto</Link> — animais mais rápidos saltam com mais frequência, não mais longe. <b>Andando</b>: passeio, volta ao ponto e aproximação de um alvo parado dentro da distância de corrida (aba Comportamento). A caminhada roda a 8 fps</p>
    </div>
    {category === 'residents' && <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <Field label="Tipo de reação"><div className="flex">{RESIDENT_REACTIONS.map((reaction) => <button type="button" key={reaction} onClick={() => update((next) => { next.reaction = reaction; })}
        className={`border px-2 py-1.5 text-[10px] first:rounded-l last:rounded-r ${variant.reaction === reaction ? 'border-cyan-500 bg-cyan-950 text-cyan-200' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>{RESIDENT_REACTION_LABELS[reaction]}</button>)}</div></Field>
      <Field label="Raio"><NumberField value={variant.radius} range={HUNTING_LIMITS.radius} suffix="px" disabled={variant.reaction !== 'radius'} onChange={(value) => update((next) => { next.radius = value; })} /></Field>
      <Field label="Cooldown de respawn"><NumberField value={variant.respawnCooldownSeconds} range={HUNTING_LIMITS.respawn} suffix="s" onChange={(value) => update((next) => { next.respawnCooldownSeconds = value; })} /></Field>
    </div>}
  </div>;
}

function AnimalCard({ animal, config, updateVariant }: { animal: HuntingManifestAnimal; config: HuntingConfig; updateVariant: (id: string, apply: (next: AnimalVariantConfig) => void) => void }) {
  return <section className="rounded-xl border border-slate-700/70 bg-slate-900/50 p-4">
    <h2 className="mb-1 text-lg font-semibold capitalize text-white">{animal.animal}</h2>
    {animal.animalKey === MONSTER_TREE_ANIMAL_KEY && <p className="mb-3 text-xs text-amber-300">Spawna nos anchors monster_tree e fica parado até ser atacado</p>}
    <div className="grid gap-3 2xl:grid-cols-2">{animal.variants.map((manifest) => <VariantEditor key={manifest.variantId} variantId={manifest.variantId}
      manifest={manifest} category={animal.category} variant={config.variants[manifest.variantId]}
      update={(apply) => updateVariant(manifest.variantId, apply)} />)}</div>
    <AnimalRigPanel animal={animal} />
  </section>;
}

function Contracts({ config, manifest, update }: { config: HuntingConfig; manifest: HuntingManifest; update: (apply: (next: HuntingConfig) => void) => void }) {
  const variants = manifest.animals.flatMap((animal) => animal.variants.map((variant) => ({ ...variant, animal, name: config.variants[variant.variantId]?.name ?? variant.file })));
  const add = () => update((next) => {
    const first = variants[0];
    if (!first) return;
    const slug = first.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'contrato';
    next.contracts.push({
      id: `${slug}-${Math.random().toString(36).slice(2, 8)}`, variantId: first.variantId, quantity: 1, timeLimitMinutes: 30, xpReward: 100, crownsReward: 10, cooldownHours: 24,
      initialPercent: DEFAULT_CONTRACT_INITIAL_PERCENT, refillBatch: DEFAULT_CONTRACT_REFILL_BATCH, enabled: true,
    });
  });
  const edit = (index: number, apply: (contract: HuntingContractConfig) => void) => update((next) => apply(next.contracts[index]));
  return <div className="space-y-3">
    <button type="button" className={`${button} border-cyan-700 text-cyan-200`} onClick={add}><Plus className="h-4 w-4" /> Novo contrato</button>
    {config.contracts.map((contract, index) => <div key={contract.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <div className="mb-3 flex items-center justify-between"><div><span className="text-sm font-semibold text-white">Caçar</span><span className="ml-2 font-mono text-[10px] text-slate-500">{contract.id}</span></div>
        <button type="button" className="text-rose-400" onClick={() => update((next) => { next.contracts.splice(index, 1); })}><Trash2 className="h-4 w-4" /></button></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Animal"><select className={`${inputClass} w-full`} value={contract.variantId} onChange={(event) => edit(index, (next) => { next.variantId = event.target.value; })}>
          {(['hunts', 'residents'] as const).map((category) => <optgroup key={category} label={category === 'hunts' ? 'Caças' : 'Residentes'}>
            {variants.filter((item) => item.animal.category === category).map((item) => <option key={item.variantId} value={item.variantId}>{item.name} — {item.file}</option>)}
          </optgroup>)}
        </select></Field>
        <Field label="Quantidade"><NumberField value={contract.quantity} range={HUNTING_LIMITS.quantity} onChange={(value) => edit(index, (next) => { next.quantity = value; })} /></Field>
        <Field label="Tempo limite"><NumberField value={contract.timeLimitMinutes} range={HUNTING_LIMITS.timeLimit} suffix="min" onChange={(value) => edit(index, (next) => { next.timeLimitMinutes = value; })} /></Field>
        <Field label="XP (skill Caça)"><NumberField value={contract.xpReward} range={HUNTING_LIMITS.xp} onChange={(value) => edit(index, (next) => { next.xpReward = value; })} /></Field>
        <Field label="Crowns"><NumberField value={contract.crownsReward} range={HUNTING_LIMITS.crowns} onChange={(value) => edit(index, (next) => { next.crownsReward = value; })} /></Field>
        <Field label="Reabre após concluir"><NumberField value={contract.cooldownHours} range={HUNTING_LIMITS.cooldownHours} step={0.5} suffix="horas" onChange={(value) => edit(index, (next) => { next.cooldownHours = value; })} /><p className="mt-1 text-[10px] text-slate-500">conta a partir do resgate da recompensa; falhar (prazo, abandono ou morte) não bloqueia — o jogador aceita de novo</p></Field>
        <Field label="Nascem ao aceitar"><NumberField value={contract.initialPercent} range={HUNTING_LIMITS.initialPercent} suffix="%" onChange={(value) => edit(index, (next) => { next.initialPercent = value; })} /></Field>
        <Field label="Reposição (de N em N)"><NumberField value={contract.refillBatch} range={HUNTING_LIMITS.refillBatch} onChange={(value) => edit(index, (next) => { next.refillBatch = value; })} /></Field>
        <Field label="Visibilidade"><Toggle checked={contract.enabled} label="Aparece no jogo" onChange={(value) => edit(index, (next) => { next.enabled = value; })} /></Field>
      </div>
      <p className="mt-2 text-[10px] text-slate-500">
        Ao aceitar nascem {contractSpawnBatch(contract, { quantity: contract.quantity, killed: 0 })} de {contract.quantity}; quando todos os vivos morrem, nascem mais {Math.min(contract.refillBatch, Math.max(0, contract.quantity - 1))} em outros pontos do mapa, até fechar a cota. Animais abatidos somem do jogo.
      </p>
    </div>)}
  </div>;
}

function AiProfiles({ config, update }: { config: HuntingConfig; update: (apply: (next: HuntingConfig) => void) => void }) {
  const profiles = config.levelProfiles ?? defaultLevelProfiles();
  const edit = (level: HuntingLevel, key: (typeof LEVEL_PROFILE_FIELDS)[number]['key'], value: number) => update((next) => {
    const all = next.levelProfiles ?? defaultLevelProfiles();
    all[level] = { ...(all[level] ?? HUNTING_LEVEL_PROFILES[level]), [key]: value };
    next.levelProfiles = all;
  });
  const restore = (level: HuntingLevel) => update((next) => {
    const all = next.levelProfiles ?? defaultLevelProfiles();
    all[level] = { ...HUNTING_LEVEL_PROFILES[level] };
    next.levelProfiles = all;
  });
  return <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
    <p className="mb-4 text-xs text-slate-400">Ajusta como cada nível de dificuldade persegue, ataca, esquiva e recua. A velocidade continua por animal (Velocidade por nível).</p>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-xs">
        <thead><tr className="border-b border-slate-700">
          <th className="p-2 text-left font-medium text-slate-400">Parâmetro</th>
          {HUNTING_LEVELS.map((level) => <th key={level} className="p-2 text-center font-medium text-slate-300">{HUNTING_LEVEL_LABELS[level]}</th>)}
        </tr></thead>
        <tbody>{LEVEL_PROFILE_FIELDS.map((field) => <tr key={field.key} className="border-b border-slate-800/70 last:border-0">
          <td className="p-2"><span className="text-slate-200">{field.label}</span>{field.unit && <span className="ml-1 text-slate-500">({field.unit})</span>}<p className="mt-0.5 text-[10px] text-slate-500">{field.hint}</p></td>
          {HUNTING_LEVELS.map((level) => <td key={level} className="p-2 text-center">
            <NumberField value={profiles[level]?.[field.key] ?? HUNTING_LEVEL_PROFILES[level][field.key]} range={{ min: field.min, max: field.max }} step={field.step} className="w-24" suffix={field.unit} onChange={(value) => edit(level, field.key, value)} />
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-500">Restaurar padrões:</span>
      {HUNTING_LEVELS.map((level) => <button key={level} type="button" className={button} onClick={() => restore(level)}>{HUNTING_LEVEL_LABELS[level]}</button>)}
      <button type="button" className={button} onClick={() => update((next) => { next.levelProfiles = defaultLevelProfiles(); })}>Restaurar todos</button>
    </div>
  </section>;
}

export default function HuntingControllerPage() {
  useDocumentScrollUnlock();
  const [manifest, setManifest] = useState<HuntingManifest | null>(null);
  const [config, setConfig] = useState<HuntingConfig>(() => defaultHuntingConfig());
  const [snapshot, setSnapshot] = useState('');
  const [persisted, setPersisted] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [tableSql, setTableSql] = useState('');
  const [playerTableSql, setPlayerTableSql] = useState('');
  const [tab, setTab] = useState<Tab>('hunts');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const manifestResult = await huntingApi.manifest();
      const defaults = defaultHuntingConfig();
      for (const animal of manifestResult.animals) for (const variant of animal.variants) {
        defaults.variants[variant.variantId] = defaultVariantConfig(variant.file.replace(/\.png$/i, ''));
      }
      setManifest(manifestResult); setConfig(clone(defaults)); setSnapshot(JSON.stringify(defaults));
      const response = await huntingApi.get();
      const loaded = parseHuntingConfig(response.config ?? defaults);
      for (const animal of manifestResult.animals) for (const variant of animal.variants) {
        loaded.variants[variant.variantId] ??= defaultVariantConfig(variant.file.replace(/\.png$/i, ''));
      }
      setConfig(clone(loaded)); setSnapshot(JSON.stringify(loaded));
      setPersisted(response.saved !== false); setTableMissing(response.tableMissing);
      setTableSql(response.tableSql ?? ''); setPlayerTableSql(response.playerTableSql ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      if (cause instanceof RigApiError && cause.tableMissing) { setTableMissing(true); setTableSql(cause.tableSql ?? ''); }
    } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const dirty = !persisted || JSON.stringify(config) !== snapshot;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const update = (apply: (next: HuntingConfig) => void) => {
    setConfig((current) => { const next = clone(current); apply(next); return next; });
    setSuccess(null);
  };
  const updateVariant = (id: string, apply: (next: AnimalVariantConfig) => void) => update((next) => apply(next.variants[id]));
  const save = async () => {
    setBusy(true); setError(null); setSuccess(null);
    try {
      // the leap (motion) is edited only in /dev/caca; the server keeps the stored one on a full save
      const response = await huntingApi.save(config);
      const next = parseHuntingConfig(response.config);
      setConfig(clone(next)); setSnapshot(JSON.stringify(next)); setPersisted(true); setTableMissing(false); setSuccess('Configuração salva.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  };

  const huntsUsed = configuredAnimalCount(config.variants, 'hunts');
  const residentsUsed = configuredAnimalCount(config.variants, 'residents');
  const huntsRandom = Object.entries(config.variants).some(([id, variant]) => id.startsWith('hunts/') && variant.spawnMode === 'random');
  const residentsRandom = Object.entries(config.variants).some(([id, variant]) => id.startsWith('residents/') && !id.startsWith(`${MONSTER_TREE_ANIMAL_KEY}/`) && variant.spawnMode === 'random');
  const treeUsed = Object.entries(config.variants).filter(([id]) => id.startsWith(`${MONSTER_TREE_ANIMAL_KEY}/`))
    .reduce((sum, [, variant]) => sum + (variant.spawnMode === 'random' ? variant.spawnMax : variant.spawnCount), 0);
  const budgets = [
    { text: `Anchor points de caça: ${CRAFTING_WORLD_MAP.huntAnchors.length} pontos de spawn · ${huntsUsed} animais configurados${huntsRandom ? ' (random conta o máx)' : ''}`, detail: huntsUsed > CRAFTING_WORLD_MAP.huntAnchors.length ? 'Excedentes nascem em anchors aleatórios (podem repetir).' : '', negative: false },
    { text: `Anchor points residentes: ${CRAFTING_WORLD_MAP.residentAnchors.length} pontos de spawn · ${residentsUsed} animais configurados${residentsRandom ? ' (random conta o máx)' : ''}`, detail: residentsUsed > CRAFTING_WORLD_MAP.residentAnchors.length ? 'Excedentes nascem em anchors aleatórios (podem repetir).' : '', negative: false },
    { text: `Árvores-monstro: ${treeUsed}/${CRAFTING_WORLD_MAP.monsterTreeAnchors.length}`, detail: '', negative: treeUsed > CRAFTING_WORLD_MAP.monsterTreeAnchors.length },
  ];
  const animals = manifest?.animals.filter((animal) => animal.category === tab) ?? [];

  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-200">
    <div className="mx-auto max-w-[1500px]">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3"><Link to="/admin" className={button}><ArrowLeft className="h-4 w-4" /></Link><div>
          <h1 className="text-2xl font-bold text-white">Hunting Controller</h1><p className="text-xs text-slate-500">Animais, contratos e rigs do mundo de caça</p>
        </div></div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/dev/caca" className={`${button} border-cyan-800 bg-cyan-950/60 text-cyan-200`} title="Configura o deslocamento e a duração do salto da corrida (padrão do jogo)"><Move className="h-4 w-4" /> Bancada do salto</Link>
          <button type="button" disabled={busy || !dirty} onClick={() => void save()} className={`${button} border-emerald-700 bg-emerald-950 text-emerald-200`}><Save className="h-4 w-4" /> Salvar configuração</button>
        </div>
      </header>
      <div className="mb-5 grid gap-2 md:grid-cols-3">{budgets.map((budget) => <div key={budget.text} className={`rounded-lg border p-3 text-xs ${budget.negative ? 'border-rose-600 bg-rose-950/40 text-rose-300' : 'border-slate-800 bg-slate-900 text-slate-300'}`}>{budget.text}{budget.detail && <p className="mt-1 text-slate-400">{budget.detail}</p>}</div>)}</div>
      {tableMissing && <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200"><p className="mb-2 font-semibold">Tabelas ausentes. Execute os SQLs no Supabase.</p>{tableSql && <SqlBox sql={tableSql} />}{playerTableSql && <SqlBox className="mt-2" sql={playerTableSql} />}</div>}
      {!persisted && <p className="mb-4 rounded border border-cyan-800 bg-cyan-950/30 p-3 text-xs text-cyan-200">Ainda não há configuração salva; os padrões estão sendo exibidos.</p>}
      {error && <p className="mb-4 rounded border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-300">{error}</p>}
      {success && <p className="mb-4 rounded border border-emerald-800 bg-emerald-950/40 p-3 text-xs text-emerald-300">{success}</p>}
      <nav className="mb-5 flex flex-wrap gap-2">{([
        ['hunts', 'Caças (hunts)'], ['residents', 'Residentes'], ['contracts', 'Contratos'], ['ai', 'Comportamento (IA)'], ['general', 'Geral'],
      ] as [Tab, string][]).map(([id, label]) => <button type="button" key={id} className={`${button} ${tab === id ? 'border-cyan-500 bg-cyan-950 text-cyan-200' : ''}`} onClick={() => setTab(id)}>{label}</button>)}</nav>
      {busy && !manifest ? <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
        : (tab === 'hunts' || tab === 'residents') ? <div className="space-y-4">{animals.map((animal) => <AnimalCard key={animal.animalKey} animal={animal} config={config} updateVariant={updateVariant} />)}</div>
          : tab === 'contracts' && manifest ? <Contracts config={config} manifest={manifest} update={update} />
            : tab === 'ai' ? <AiProfiles config={config} update={update} />
              : <section className="max-w-2xl rounded-xl border border-slate-700 bg-slate-900/60 p-4"><h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white"><Target className="h-5 w-5 text-cyan-400" /> Geral</h2>
              <div className="space-y-3">
                <Field label="Dano com as mãos"><NumberField value={config.general.handDamage} range={range(0, HUNTING_LIMITS.damage.max)} onChange={(value) => update((next) => { next.general.handDamage = value; })} /></Field>
                <Field label="Respawn das caças"><NumberField value={config.general.huntsRespawnSeconds} range={HUNTING_LIMITS.respawn} suffix="s" onChange={(value) => update((next) => { next.general.huntsRespawnSeconds = value; })} /></Field>
                <Field label="Raio de interação do NPC"><NumberField value={config.general.npcInteractRadius} range={range(32, 2000)} suffix="px" onChange={(value) => update((next) => { next.general.npcInteractRadius = value; })} /></Field>
                <Field label="Sistema"><Toggle checked={config.general.enabled} label="Caça habilitada" onChange={(value) => update((next) => { next.general.enabled = value; })} /></Field>
              </div>
              </section>}
    </div>
  </main>;
}