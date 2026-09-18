import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimalPlayback } from '../../game/hunting/animalPlayback';
import { huntingApi } from '../../lib/hunting/huntingApi';
import {
  ANIMAL_ANIMATION_COLUMNS,
  ANIMAL_ANIMATION_FPS,
  ANIMAL_APPROACH_SPEED_FACTOR,
  ANIMAL_DIRECTIONS,
  ANIMAL_SHEET_COLUMNS,
  ANIMAL_SHEET_ROWS,
  animalDirectionFromVector,
  type AnimalAnimation,
  type HuntingManifest,
  type HuntingManifestVariant,
} from '../../shared/hunting/HuntingShapes';
import {
  DEFAULT_RUN_FPS,
  RUN_GROUND_FRAMES,
  RUN_GROUND_SPEED,
  RUN_MAX_FPS,
  RUN_MIN_FPS,
  effectiveRunFps,
  runDistanceBetween,
  runFrameAt,
  runLeapFrames,
  runLeapMs,
  runLeapProfile,
  runPhaseAt,
  runStrideFor,
} from '../../shared/hunting/HuntingMotion';
import { INTERPOLATION_DELAY_MS } from '../../game/network/interpolation';

const WIDTH = 920;
const HEIGHT = 560;
const WORLD_BOTTOM = 430;
const FRAME_SEQUENCE = [0, 1, 2, 1];

interface Snapshot { x: number; y: number; t: number }
interface TrailDot { x: number; y: number; phase: number }
/** Trail colours per leap phase: gather (crouched) · take-off · flight; grey = walking/idle. */
const PHASE_COLORS = ['#f59e0b', '#22d3ee', '#94a3b8'];
interface FilmFrame { frame: number; column: number; row: number; x: number }
interface Readout { anim: AnimalAnimation; frame: number; instant: number; average: number }

function numberValue(setter: (value: number) => void) {
  return (event: React.ChangeEvent<HTMLInputElement>) => setter(Number(event.target.value));
}

export function HuntingBenchPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [manifest, setManifest] = useState<HuntingManifest | null>(null);
  const [error, setError] = useState('');
  const [variantId, setVariantId] = useState('');
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [speed, setSpeed] = useState(120);
  const [fps, setFps] = useState(DEFAULT_RUN_FPS);
  const [runDistance, setRunDistance] = useState(140);
  const [groundFrames, setGroundFrames] = useState(RUN_GROUND_FRAMES);
  const [groundSpeed, setGroundSpeed] = useState(RUN_GROUND_SPEED);
  const [legacy, setLegacy] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [readout, setReadout] = useState<Readout>({ anim: 'run', frame: 0, instant: 0, average: 0 });
  const controlsRef = useRef({ speed, fps, runDistance, groundFrames, groundSpeed, legacy });
  controlsRef.current = { speed, fps, runDistance, groundFrames, groundSpeed, legacy };

  useEffect(() => {
    huntingApi.manifest().then((result) => {
      setManifest(result);
      const hunts = result.animals.filter((animal) => animal.category === 'hunts');
      const preferred = hunts.find((animal) => animal.animal.toLowerCase().includes('wolf')) ?? hunts[0];
      setVariantId(preferred?.variants[0]?.variantId ?? result.animals[0]?.variants[0]?.variantId ?? '');
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha ao carregar animais.'));
  }, []);

  const variants = useMemo(() => manifest?.animals.flatMap((animal) =>
    animal.variants.map((variant) => ({ ...variant, animal: animal.animal, category: animal.category }))) ?? [], [manifest]);
  const variant = variants.find((item) => item.variantId === variantId);

  useEffect(() => {
    if (!variant) return;
    const next = new Image();
    next.onload = () => setImage(next);
    next.onerror = () => setError('Não foi possível carregar a folha do animal.');
    next.src = variant.url;
    setImage(null);
  }, [variant]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || !variant) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    let server = { x: 120, y: 220, targetX: 620, targetY: 220, anim: 'run' as AnimalAnimation, dir: 2, runElapsed: 0, frame: 0 };
    let snapshots: Snapshot[] = [{ x: server.x, y: server.y, t: performance.now() }];
    let trail: TrailDot[] = [];
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
      const config = controlsRef.current;
      const leap = runLeapProfile(config.groundFrames, config.groundSpeed);
      let step = 0;
      let phase = -1;
      if (distance < 4) {
        server.anim = 'idle';
        server.runElapsed = 0;
      } else {
        const nextAnim: AnimalAnimation = distance > config.runDistance ? 'run' : 'walk';
        // like the real server: the leap clock restarts whenever the run starts
        if (nextAnim === 'run' && server.anim !== 'run') server.runElapsed = 0;
        server.anim = nextAnim;
        const baseSpeed = nextAnim === 'run' ? config.speed : config.speed * ANIMAL_APPROACH_SPEED_FACTOR;
        if (nextAnim === 'run') {
          // like the real server: move by the phase distance, then publish the phase of the NEXT interval — the
          // client shows a snapshot's pose while interpolating from that snapshot towards the following one
          phase = runPhaseAt(server.runElapsed, config.fps, leap);
          step = config.legacy ? baseSpeed * dtMs / 1000 : runDistanceBetween(server.runElapsed, server.runElapsed + dtMs, config.speed, config.fps, leap);
          server.runElapsed += dtMs;
          server.frame = config.legacy
            ? Math.floor(server.runElapsed / (1000 / effectiveRunFps(config.fps))) % 3
            : runFrameAt(server.runElapsed, config.fps, leap);
        } else {
          step = baseSpeed * dtMs / 1000;
        }
        step = Math.min(distance, step);
        server.x += dx / distance * step;
        server.y += dy / distance * step;
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
      ctx.strokeStyle = '#334155';
      ctx.beginPath(); ctx.moveTo(0, WORLD_BOTTOM); ctx.lineTo(WIDTH, WORLD_BOTTOM); ctx.stroke();
      for (const dot of trail) {
        ctx.fillStyle = PHASE_COLORS[dot.phase] ?? '#64748b';
        ctx.beginPath(); ctx.arc(dot.x, dot.y, 2.5, 0, Math.PI * 2); ctx.fill();
      }
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

  const leap = runLeapProfile(groundFrames, groundSpeed);
  const effectiveStride = runStrideFor(speed, fps, leap);
  const airSpeed = leap[1].speed;
  return (
    <main className="min-h-screen bg-slate-950 px-5 py-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-4">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-400">Bancada DEV · Caça</p>
          <h1 className="text-2xl font-bold">Corrida em saltos</h1>
          <p className="text-sm text-slate-400">Clique na área para mudar o alvo. Os pontos mostram cada tique do servidor.</p>
        </header>
        <section className="grid gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4 md:grid-cols-8">
          <label className="text-xs text-slate-400 md:col-span-2">Animal
            <select className="mt-1 w-full rounded border border-slate-600 bg-slate-800 p-2 text-sm text-white" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              {variants.map((item) => <option key={item.variantId} value={item.variantId}>{item.animal} · {item.file}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">Velocidade (px/s)
            <input className="mt-1 w-full rounded border border-slate-600 bg-slate-800 p-2 text-white" type="number" min="1" value={speed} onChange={numberValue(setSpeed)} />
          </label>
          <label className="text-xs text-slate-400">Ritmo da corrida (fps)
            <input className="mt-1 w-full rounded border border-slate-600 bg-slate-800 p-2 text-white" type="number" min={RUN_MIN_FPS} max={RUN_MAX_FPS} value={fps} onChange={numberValue(setFps)} />
          </label>
          <label className="text-xs text-slate-400">Corre a partir de (px)
            <input className="mt-1 w-full rounded border border-slate-600 bg-slate-800 p-2 text-white" type="number" min="0" value={runDistance} onChange={numberValue(setRunDistance)} />
          </label>
          <label className="text-xs text-slate-400">Agachado (quadros)
            <input className="mt-1 w-full rounded border border-slate-600 bg-slate-800 p-2 text-white" type="number" min="0.25" max="4" step="0.25" value={groundFrames} onChange={numberValue(setGroundFrames)} />
          </label>
          <label className="text-xs text-slate-400">Velocidade agachado (×)
            <input className="mt-1 w-full rounded border border-slate-600 bg-slate-800 p-2 text-white" type="number" min="0" max="1" step="0.05" value={groundSpeed} onChange={numberValue(setGroundSpeed)} />
          </label>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={legacy} onChange={(e) => setLegacy(e.target.checked)} /> movimento antigo (constante, quadros pelo relógio)</label>
            <button className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold hover:bg-cyan-600" onClick={() => setResetKey((key) => key + 1)}>Reiniciar</button>
          </div>
          <p className="text-xs text-slate-400 md:col-span-8">Salto: <b className="text-white">{effectiveStride.toFixed(1)} px</b> a cada {runLeapFrames(leap).toFixed(2)} quadros ({runLeapMs(fps, leap).toFixed(0)} ms) · animação a <b className="text-white">{effectiveRunFps(fps).toFixed(0)} fps</b> (caminhada: {ANIMAL_ANIMATION_FPS.walk} fps) · <span style={{ color: PHASE_COLORS[0] }}>q1 agachado {groundSpeed.toFixed(2)}×</span> → <span style={{ color: PHASE_COLORS[1] }}>q2 impulso {airSpeed.toFixed(2)}×</span> → <span style={{ color: PHASE_COLORS[2] }}>q0 esticado {airSpeed.toFixed(2)}×</span> · o jogo usa {RUN_GROUND_FRAMES} quadros a {RUN_GROUND_SPEED}×</p>
        </section>
        {error && <p className="rounded border border-red-800 bg-red-950 p-3 text-sm text-red-200">{error}</p>}
        <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
          <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="block h-auto w-full cursor-crosshair [image-rendering:pixelated]" />
        </div>
        <section className="grid grid-cols-2 gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm md:grid-cols-5">
          <p><span className="text-slate-500">Animação</span><br /><b>{readout.anim}</b></p>
          <p><span className="text-slate-500">Quadro</span><br /><b>{readout.frame}</b></p>
          <p><span className="text-slate-500">Velocidade instantânea</span><br /><b>{readout.instant.toFixed(1)} px/s</b></p>
          <p><span className="text-slate-500">Média (1 s)</span><br /><b>{readout.average.toFixed(1)} px/s</b></p>
          <p><span className="text-slate-500">FPS da corrida</span><br /><b>{effectiveRunFps(fps).toFixed(0)}</b></p>
        </section>
      </div>
    </main>
  );
}