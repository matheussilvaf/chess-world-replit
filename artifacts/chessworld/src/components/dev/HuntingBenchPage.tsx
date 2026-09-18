import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimalPlayback } from '../../game/hunting/animalPlayback';
import { huntingApi } from '../../lib/hunting/huntingApi';
import { RigApiError } from '../admin/rig-editor/rigApi';
import {
  ANIMAL_ANIMATION_COLUMNS,
  ANIMAL_ANIMATION_FPS,
  ANIMAL_DIRECTIONS,
  DEFAULT_SPEED_BY_LEVEL,
  DEFAULT_WALK_SPEED_BY_LEVEL,
  HUNTING_LEVELS,
  HUNTING_LEVEL_LABELS,
  animalDirectionFromVector,
  type AnimalAnimation,
  type HuntingConfig,
  type HuntingLevel,
  type HuntingManifest,
} from '../../shared/hunting/HuntingShapes';
import {
  DEFAULT_MOTION,
  LEAP_MIN_AIR_MS,
  MOTION_LIMITS,
  parseMotionConfig,
  runDistanceBetween,
  runFrameAt,
  runLeapFor,
  runPhaseAt,
  type HuntingMotionConfig,
  type RunLeap,
} from '../../shared/hunting/HuntingMotion';
import { INTERPOLATION_DELAY_MS } from '../../game/network/interpolation';

const WIDTH = 920;
const HEIGHT = 560;
const WORLD_BOTTOM = 430;
const FRAME_SEQUENCE = [0, 1, 2, 1];
const PHASE_GROUND = 0, PHASE_TAKEOFF = 1, PHASE_FLIGHT = 2;

interface Snapshot { x: number; y: number; t: number }
interface TrailDot { x: number; y: number; phase: number }
/** One completed leap: take-off point A → landing point B. */
interface LeapMark { ax: number; ay: number; bx: number; by: number; ms: number }
/** Trail colours per leap phase: gather (crouched) · take-off · flight; grey = walking/idle. */
const PHASE_COLORS = ['#f59e0b', '#22d3ee', '#94a3b8'];
interface FilmFrame { frame: number; column: number; row: number; x: number }
interface Readout { anim: AnimalAnimation; frame: number; instant: number; average: number }
type MotionField = keyof HuntingMotionConfig;
const MOTION_FIELDS: { key: MotionField; label: string; hint: string; step: number; suffix: string }[] = [
  { key: 'leapPx', label: 'Deslocamento do salto', hint: 'Quanto o animal avança do ponto A (impulso) ao ponto B (aterrissagem) em um salto', step: 5, suffix: 'px' },
  { key: 'leapMs', label: 'Duração do salto', hint: 'Tempo que esse deslocamento leva — impulso + voo. Menor = mais brusco', step: 10, suffix: 'ms' },
  { key: 'groundMinMs', label: 'Pausa mínima agachado', hint: 'Menor tempo agachado entre dois saltos (animais rápidos)', step: 10, suffix: 'ms' },
  { key: 'groundMaxMs', label: 'Pausa máxima agachado', hint: 'Acima disso o animal lento encurta o salto em vez de esperar mais', step: 50, suffix: 'ms' },
  { key: 'groundSpeed', label: 'Velocidade agachado', hint: 'Fração da velocidade enquanto está agachado (0 = parado)', step: 0.05, suffix: '×' },
];
/** Why the leap shown differs from the configured one, and what to change to get the configured one back. */
function fitLabel(leap: RunLeap, motion: HuntingMotionConfig, speed: number): string {
  const airMs = Math.max(LEAP_MIN_AIR_MS, motion.leapMs);
  // speeds at which the configured leap fits exactly with the maximum / minimum pause
  const slowest = motion.leapPx * 1000 / (airMs + (1 - motion.groundSpeed) * motion.groundMaxMs);
  const fastest = motion.leapPx * 1000 / (airMs + (1 - motion.groundSpeed) * motion.groundMinMs);
  switch (leap.fit) {
    case 'quicker': return `${speed} px/s é mais que ${fastest.toFixed(0)} px/s: a pausa já é a mínima, então o salto de ${motion.leapPx} px ficou mais rápido (${leap.airMs.toFixed(0)} ms)`;
    case 'longer-fast': return `${speed} px/s é rápido demais até com a pausa mínima: o salto ficou mais longo (${leap.leapPx.toFixed(0)} px) para manter a velocidade`;
    case 'shorter-slow': {
      const wanted = (motion.leapPx * 1000 / speed - airMs) / (1 - motion.groundSpeed);
      return `a ${speed} px/s o salto de ${motion.leapPx} px pediria uma pausa de ${wanted.toFixed(0)} ms — acima da pausa máxima (${motion.groundMaxMs} ms), então o salto encurtou para ${leap.leapPx.toFixed(0)} px. Para ${motion.leapPx} px com pausa ≤ ${motion.groundMaxMs} ms é preciso ≥ ${slowest.toFixed(0)} px/s (velocidade do nível, no admin) ou uma pausa máxima maior`;
    }
    default: return '';
  }
}

function numberValue(setter: (value: number) => void) {
  return (event: React.ChangeEvent<HTMLInputElement>) => setter(Number(event.target.value));
}
const sameMotion = (a: HuntingMotionConfig, b: HuntingMotionConfig) => MOTION_FIELDS.every(({ key }) => a[key] === b[key]);

/** Times (ms since the run started) inside (fromMs, toMs] at which the leap phase changes, with the phase entered. */
function phaseChangesBetween(fromMs: number, toMs: number, leap: RunLeap): { at: number; phase: number }[] {
  const out: { at: number; phase: number }[] = [];
  const { phases, periodMs } = leap;
  let t = fromMs;
  for (let guard = 0; guard < 64 && t < toMs - 1e-9; guard++) {
    const local = ((t % periodMs) + periodMs) % periodMs;
    let end = 0, next = -1;
    for (let i = 0; i < phases.length; i++) {
      end += phases[i].ms;
      if (end > local + 1e-9) { next = (i + 1) % phases.length; break; }
    }
    if (next < 0) break;
    const at = t + (end - local);
    if (at > toMs + 1e-9) break;
    while (phases[next].ms <= 0) next = (next + 1) % phases.length; // zero-length gather: skipped
    out.push({ at, phase: next });
    t = at;
  }
  return out;
}

export function HuntingBenchPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [manifest, setManifest] = useState<HuntingManifest | null>(null);
  const [config, setConfig] = useState<HuntingConfig | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [variantId, setVariantId] = useState('');
  const [level, setLevel] = useState<HuntingLevel>('moderate');
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [speed, setSpeed] = useState(DEFAULT_SPEED_BY_LEVEL.moderate);
  const [walkSpeed, setWalkSpeed] = useState(DEFAULT_WALK_SPEED_BY_LEVEL.moderate);
  const [runDistance, setRunDistance] = useState(140);
  const [draft, setDraft] = useState<HuntingMotionConfig>({ ...DEFAULT_MOTION });
  const [saved, setSaved] = useState<HuntingMotionConfig>({ ...DEFAULT_MOTION });
  const [saving, setSaving] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [readout, setReadout] = useState<Readout>({ anim: 'run', frame: 0, instant: 0, average: 0 });
  const motion = useMemo(() => parseMotionConfig(draft), [draft]);
  const controlsRef = useRef({ speed, walkSpeed, runDistance, motion });
  controlsRef.current = { speed, walkSpeed, runDistance, motion };

  useEffect(() => {
    huntingApi.manifest().then((result) => {
      setManifest(result);
      const hunts = result.animals.filter((animal) => animal.category === 'hunts');
      const preferred = hunts.find((animal) => animal.animal.toLowerCase().includes('wolf')) ?? hunts[0];
      setVariantId(preferred?.variants[0]?.variantId ?? result.animals[0]?.variants[0]?.variantId ?? '');
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha ao carregar animais.'));
    huntingApi.publicConfig().then((result) => {
      setConfig(result);
      setDraft({ ...result.motion });
      setSaved({ ...result.motion });
    }).catch((cause) => setNotice(`Sem acesso à configuração salva (${cause instanceof Error ? cause.message : 'rede'}); exibindo o salto de fábrica.`));
  }, []);

  const variants = useMemo(() => manifest?.animals.flatMap((animal) =>
    animal.variants.map((variant) => ({ ...variant, animal: animal.animal, category: animal.category }))) ?? [], [manifest]);
  const variant = variants.find((item) => item.variantId === variantId);
  const levelSpeed = useCallback((id: string, lvl: HuntingLevel) => config?.variants[id]?.speedByLevel?.[lvl] ?? DEFAULT_SPEED_BY_LEVEL[lvl], [config]);
  const levelWalkSpeed = useCallback((id: string, lvl: HuntingLevel) => config?.variants[id]?.walkSpeedByLevel?.[lvl] ?? DEFAULT_WALK_SPEED_BY_LEVEL[lvl], [config]);
  const configuredLevel = variantId ? config?.variants[variantId]?.level : undefined;

  useEffect(() => {
    if (!variant) return;
    const next = new Image();
    next.onload = () => setImage(next);
    next.onerror = () => setError('Não foi possível carregar a folha do animal.');
    next.src = variant.url;
    setImage(null);
  }, [variant]);
  // the speed follows the level of the selected animal (admin: velocidade por nível); the field stays editable
  useEffect(() => {
    if (!variantId) return;
    if (configuredLevel) setLevel(configuredLevel);
    setSpeed(levelSpeed(variantId, configuredLevel ?? 'moderate'));
    setWalkSpeed(levelWalkSpeed(variantId, configuredLevel ?? 'moderate'));
  }, [variantId, configuredLevel, levelSpeed, levelWalkSpeed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || !variant) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    let server = { x: 120, y: 220, targetX: 700, targetY: 220, anim: 'run' as AnimalAnimation, dir: 2, runElapsed: 0, frame: 0 };
    let snapshots: Snapshot[] = [{ x: server.x, y: server.y, t: performance.now() }];
    let trail: TrailDot[] = [];
    let marks: LeapMark[] = [];
    let takeOff: { x: number; y: number; at: number } | null = null;
    let film: FilmFrame[] = [];
    let speedSamples: Array<{ t: number; distance: number }> = [];
    let totalDistance = 0;
    let instant = 0;
    let lastServer = performance.now();
    let lastFilm = 0;
    let latest = { anim: server.anim, dir: server.dir, frame: 0, x: server.x, y: server.y };
    const playback = new AnimalPlayback(INTERPOLATION_DELAY_MS);
    playback.push(server.anim, server.dir, server.frame, lastServer);

    const serverTimer = window.setInterval(() => {
      const now = performance.now();
      const dtMs = Math.min(150, now - lastServer);
      lastServer = now;
      const dx = server.targetX - server.x;
      const dy = server.targetY - server.y;
      const distance = Math.hypot(dx, dy);
      const controls = controlsRef.current;
      let step = 0;
      let phase = -1;
      if (distance < 4) {
        server.anim = 'idle';
        server.runElapsed = 0;
        takeOff = null;
      } else {
        const nextAnim: AnimalAnimation = distance > controls.runDistance ? 'run' : 'walk';
        // like the real server: the leap clock restarts whenever the run starts
        if (nextAnim === 'run' && server.anim !== 'run') { server.runElapsed = 0; takeOff = null; }
        server.anim = nextAnim;
        const ux = dx / distance, uy = dy / distance;
        if (nextAnim === 'run') {
          // like the real server: move by the phase distance, then publish the phase of the NEXT interval — the
          // client shows a snapshot's pose while interpolating from that snapshot towards the following one.
          // The bench additionally splits the tick at phase changes to mark take-off (A) and landing (B) exactly.
          const leap = runLeapFor(controls.speed, controls.motion);
          phase = runPhaseAt(server.runElapsed, leap);
          const from = server.runElapsed, to = server.runElapsed + dtMs;
          let cursor = from;
          for (const change of [...phaseChangesBetween(from, to, leap), { at: to, phase: -1 }]) {
            const part = Math.min(distance - step, runDistanceBetween(cursor, change.at, controls.speed, leap));
            server.x += ux * part; server.y += uy * part; step += part;
            cursor = change.at;
            if (change.phase === PHASE_GROUND || (change.phase === PHASE_TAKEOFF && takeOff)) {
              if (takeOff) marks.push({ ax: takeOff.x, ay: takeOff.y, bx: server.x, by: server.y, ms: change.at - takeOff.at });
              if (marks.length > 4) marks.shift();
              takeOff = null;
            }
            if (change.phase === PHASE_TAKEOFF) takeOff = { x: server.x, y: server.y, at: change.at };
          }
          server.runElapsed = to;
          server.frame = runFrameAt(server.runElapsed, leap);
        } else {
          step = Math.min(distance, controls.walkSpeed * dtMs / 1000);
          server.x += ux * step; server.y += uy * step;
          takeOff = null;
        }
        server.dir = ANIMAL_DIRECTIONS.indexOf(animalDirectionFromVector(dx, dy));
      }
      instant = dtMs > 0 ? step * 1000 / dtMs : 0;
      totalDistance += step;
      speedSamples.push({ t: now, distance: totalDistance });
      speedSamples = speedSamples.filter((sample) => sample.t >= now - 1100);
      trail.push({ x: server.x, y: server.y, phase });
      if (trail.length > 180) trail.shift();
      playback.push(server.anim, server.dir, server.frame, now);
    }, 50);

    const snapshotTimer = window.setInterval(() => {
      snapshots.push({ x: server.x, y: server.y, t: performance.now() });
      if (snapshots.length > 20) snapshots.shift();
    }, 33);

    const drawSprite = (column: number, row: number, x: number, y: number, scale = 2) => {
      ctx.drawImage(image, column * variant.frameWidth, row * variant.frameHeight, variant.frameWidth, variant.frameHeight,
        x - variant.frameWidth * scale / 2, y - variant.frameHeight * scale * 0.8,
        variant.frameWidth * scale, variant.frameHeight * scale);
    };
    let animationFrame = 0;
    const render = (now: number) => {
      const renderTime = now - INTERPOLATION_DELAY_MS;
      let a = snapshots[0], b = snapshots.at(-1)!;
      for (let i = 0; i < snapshots.length - 1; i++) {
        if (snapshots[i].t <= renderTime && snapshots[i + 1].t >= renderTime) {
          a = snapshots[i]; b = snapshots[i + 1]; break;
        }
      }
      const ratio = b.t > a.t ? Math.max(0, Math.min(1, (renderTime - a.t) / (b.t - a.t))) : 1;
      const x = a.x + (b.x - a.x) * ratio;
      const y = a.y + (b.y - a.y) * ratio;
      const state = playback.update(now);
      const localFrame = state.frame ?? FRAME_SEQUENCE[Math.floor(now / (1000 / ANIMAL_ANIMATION_FPS[state.anim])) % FRAME_SEQUENCE.length];
      const column = ANIMAL_ANIMATION_COLUMNS[state.anim][localFrame];
      const row = Math.max(0, state.dir);
      latest = { anim: state.anim, dir: state.dir, frame: localFrame, x, y };
      if (now - lastFilm >= 100) {
        film.push({ frame: localFrame, column, row, x });
        if (film.length > 12) film.shift();
        lastFilm = now;
      }

      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, WORLD_BOTTOM); ctx.lineTo(WIDTH, WORLD_BOTTOM); ctx.stroke();
      for (const dot of trail) {
        ctx.fillStyle = PHASE_COLORS[dot.phase] ?? '#64748b';
        ctx.beginPath(); ctx.arc(dot.x, dot.y, 2.5, 0, Math.PI * 2); ctx.fill();
      }
      // A → B of the last leaps, with the measured displacement
      ctx.font = '11px monospace';
      marks.forEach((mark, index) => {
        const alpha = 0.35 + 0.65 * (index + 1) / marks.length;
        ctx.strokeStyle = `rgba(34, 211, 238, ${alpha})`; ctx.fillStyle = `rgba(165, 243, 252, ${alpha})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(mark.ax, mark.ay + 14); ctx.lineTo(mark.ax, mark.ay + 22); ctx.lineTo(mark.bx, mark.by + 22); ctx.lineTo(mark.bx, mark.by + 14); ctx.stroke();
        const px = Math.hypot(mark.bx - mark.ax, mark.by - mark.ay);
        ctx.fillText(`A→B ${px.toFixed(0)} px · ${mark.ms.toFixed(0)} ms`, (mark.ax + mark.bx) / 2 - 48, mark.ay + 36);
      });
      ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(server.targetX, server.targetY, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(server.targetX - 14, server.targetY); ctx.lineTo(server.targetX + 14, server.targetY);
      ctx.moveTo(server.targetX, server.targetY - 14); ctx.lineTo(server.targetX, server.targetY + 14); ctx.stroke();
      drawSprite(column, row, x, y);
      ctx.fillStyle = '#cbd5e1'; ctx.font = '12px monospace';
      ctx.fillText('Filme: amostras a cada 100 ms (deslocamento x)', 16, 454);
      film.forEach((sample, index) => {
        const boxX = 16 + index * 74;
        drawSprite(sample.column, sample.row, boxX + 25, 510, 0.72);
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`q${sample.frame} ${Math.round(sample.x - film[0].x)}px`, boxX, 548);
      });
      animationFrame = requestAnimationFrame(render);
    };
    animationFrame = requestAnimationFrame(render);

    const readoutTimer = window.setInterval(() => {
      const first = speedSamples[0], last = speedSamples.at(-1);
      const average = first && last && last.t > first.t ? (last.distance - first.distance) * 1000 / (last.t - first.t) : 0;
      setReadout({ anim: latest.anim, frame: latest.frame, instant, average });
    }, 100);
    const click = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      server.targetX = (event.clientX - rect.left) * WIDTH / rect.width;
      server.targetY = Math.min(WORLD_BOTTOM - 20, Math.max(30, (event.clientY - rect.top) * HEIGHT / rect.height));
    };
    canvas.addEventListener('click', click);
    return () => {
      clearInterval(serverTimer); clearInterval(snapshotTimer); clearInterval(readoutTimer);
      cancelAnimationFrame(animationFrame); canvas.removeEventListener('click', click);
    };
  }, [image, resetKey, variant]);

  const save = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await huntingApi.saveMotion(motion);
      setSaved({ ...response.config.motion });
      setDraft({ ...response.config.motion });
      setConfig(response.config);
      setNotice('Salvo como padrão do jogo. Os servidores aplicam em até 30 s (animais já correndo trocam de salto na hora).');
    } catch (cause) {
      const status = cause instanceof RigApiError ? cause.status : 0;
      setError(status === 401 || status === 403
        ? 'Sem permissão: entre no site com a conta admin (mesma aba do navegador) e tente de novo.'
        : cause instanceof Error ? cause.message : String(cause));
    } finally { setSaving(false); }
  };

  const leap = runLeapFor(speed, motion);
  const dirty = !sameMotion(motion, saved);
  const factory = sameMotion(motion, DEFAULT_MOTION);
  const inputClass = 'mt-1 w-full rounded border border-slate-600 bg-slate-800 p-2 text-sm text-white';
  const button = 'rounded px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <main className="min-h-screen bg-slate-950 px-5 py-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-400">Bancada · Caça</p>
            <h1 className="text-2xl font-bold">Salto da corrida</h1>
            <p className="max-w-3xl text-sm text-slate-400">
              O salto salvo aqui é o padrão do jogo: todo animal correndo se desloca do ponto A ao ponto B com este deslocamento e esta
              duração, sincronizado com a animação (agachado → impulso → voo). A velocidade de cada nível (admin) continua sendo a média:
              animais mais rápidos saltam com mais frequência, não mais longe. Clique na área para mudar o alvo.
            </p>
          </div>
          <Link to="/admin/hunting" className="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700">← Hunting Controller</Link>
        </header>

        <section className="rounded-xl border border-cyan-900/60 bg-slate-900 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-cyan-200">Salto — padrão do jogo {dirty && <span className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-200">alterado, não salvo</span>}</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`${button} border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`} disabled={!dirty || saving} onClick={() => setDraft({ ...saved })}>Descartar alterações</button>
              <button type="button" className={`${button} border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`} disabled={factory || saving} onClick={() => setDraft({ ...DEFAULT_MOTION })}>Salto de fábrica</button>
              <button type="button" className={`${button} bg-emerald-700 text-white hover:bg-emerald-600`} disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar como padrão do jogo'}</button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            {MOTION_FIELDS.map((field) => <label key={field.key} className="text-xs text-slate-400" title={field.hint}>{field.label} ({field.suffix})
              <input className={inputClass} type="number" min={MOTION_LIMITS[field.key].min} max={MOTION_LIMITS[field.key].max} step={field.step}
                value={draft[field.key]} onChange={numberValue((value) => setDraft((current) => ({ ...current, [field.key]: value })))} />
              <span className="mt-1 block text-[10px] leading-tight text-slate-500">{field.hint}</span>
            </label>)}
          </div>
          <p className="mt-3 text-xs text-slate-300">
            Com <b className="text-white">{speed} px/s</b>: <span style={{ color: PHASE_COLORS[PHASE_GROUND] }}>agachado {leap.groundMs.toFixed(0)} ms</span> →
            {' '}<span style={{ color: PHASE_COLORS[PHASE_TAKEOFF] }}>impulso</span> + <span style={{ color: PHASE_COLORS[PHASE_FLIGHT] }}>voo</span> = <b className="text-white">{leap.leapPx.toFixed(0)} px em {leap.airMs.toFixed(0)} ms</b> ({leap.airSpeed.toFixed(0)} px/s no ar)
            {' '}· {(1000 / leap.periodMs).toFixed(2)} saltos/s · média {speed} px/s
            {leap.fit !== 'exact' && <span className="mt-1 block rounded bg-amber-500/20 px-2 py-1 text-[11px] leading-snug text-amber-200">{fitLabel(leap, motion, speed)}</span>}
          </p>
          {config && <p className="mt-1 text-[11px] text-slate-500">
            Por nível, com o salto acima: {HUNTING_LEVELS.map((lvl) => {
              const v = levelSpeed(variantId, lvl), l = runLeapFor(v, motion);
              return <span key={lvl} className="mr-3">{HUNTING_LEVEL_LABELS[lvl]} {v} px/s → {l.leapPx.toFixed(0)} px, pausa {l.groundMs.toFixed(0)} ms</span>;
            })}
          </p>}
        </section>

        <section className="grid gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4 md:grid-cols-7">
          <label className="text-xs text-slate-400 md:col-span-2">Animal (só visualização)
            <select className={inputClass} value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              {variants.map((item) => <option key={item.variantId} value={item.variantId}>{item.animal} · {item.file}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">Nível (velocidade do admin)
            <select className={inputClass} value={level} onChange={(e) => { const lvl = e.target.value as HuntingLevel; setLevel(lvl); setSpeed(levelSpeed(variantId, lvl)); setWalkSpeed(levelWalkSpeed(variantId, lvl)); }}>
              {HUNTING_LEVELS.map((lvl) => <option key={lvl} value={lvl}>{HUNTING_LEVEL_LABELS[lvl]} · corre {levelSpeed(variantId, lvl)} · anda {levelWalkSpeed(variantId, lvl)} px/s{configuredLevel === lvl ? ' (atual)' : ''}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">Correndo (px/s, média)
            <input className={inputClass} type="number" min="1" value={speed} onChange={numberValue(setSpeed)} />
          </label>
          <label className="text-xs text-slate-400">Andando (px/s)
            <input className={inputClass} type="number" min="1" value={walkSpeed} onChange={numberValue(setWalkSpeed)} />
          </label>
          <label className="text-xs text-slate-400">Corre a partir de (px)
            <input className={inputClass} type="number" min="0" value={runDistance} onChange={numberValue(setRunDistance)} />
          </label>
          <div className="flex flex-col justify-end">
            <button type="button" className={`${button} bg-cyan-700 text-white hover:bg-cyan-600`} onClick={() => setResetKey((key) => key + 1)}>Reiniciar cena</button>
          </div>
        </section>
        {error && <p className="rounded border border-red-800 bg-red-950 p-3 text-sm text-red-200">{error}</p>}
        {notice && <p className="rounded border border-cyan-800 bg-cyan-950/40 p-3 text-sm text-cyan-100">{notice}</p>}
        <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
          <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="block h-auto w-full cursor-crosshair [image-rendering:pixelated]" />
        </div>
        <section className="grid grid-cols-2 gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm md:grid-cols-5">
          <p><span className="text-slate-500">Animação</span><br /><b>{readout.anim}</b></p>
          <p><span className="text-slate-500">Quadro</span><br /><b>{readout.frame}</b></p>
          <p><span className="text-slate-500">Velocidade instantânea</span><br /><b>{readout.instant.toFixed(1)} px/s</b></p>
          <p><span className="text-slate-500">Média (1 s)</span><br /><b>{readout.average.toFixed(1)} px/s</b></p>
          <p><span className="text-slate-500">Pontos</span><br /><span style={{ color: PHASE_COLORS[0] }}>agachado</span> · <span style={{ color: PHASE_COLORS[1] }}>impulso</span> · <span style={{ color: PHASE_COLORS[2] }}>voo</span></p>
        </section>
      </div>
    </main>
  );
}
