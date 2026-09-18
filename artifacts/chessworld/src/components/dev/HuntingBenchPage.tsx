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
  RUN_MAX_FPS,
  RUN_MIN_FPS,
  effectiveRunFps,
  runDistanceBetween,
  runSlotForDistance,
  runStrideFor,
} from '../../shared/hunting/HuntingMotion';
import { INTERPOLATION_DELAY_MS } from '../../game/network/interpolation';

const WIDTH = 920;
const HEIGHT = 560;
const WORLD_BOTTOM = 430;
const FRAME_SEQUENCE = [0, 1, 2, 1];

interface Snapshot { x: number; y: number; t: number }
interface TrailDot { x: number; y: number; slot: number }
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
  const [legacy, setLegacy] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [readout, setReadout] = useState<Readout>({ anim: 'run', frame: 0, instant: 0, average: 0 });
  const controlsRef = useRef({ speed, fps, runDistance, legacy });
  controlsRef.current = { speed, fps, runDistance, legacy };

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
    let server = { x: 120, y: 220, targetX: 620, targetY: 220, anim: 'run' as AnimalAnimation, dir: 2, runElapsed: 0, runTravel: 0, stride: 0 };
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
    playback.push(server.anim, server.dir, runStrideFor(controlsRef.current.speed, controlsRef.current.fps), lastServer);

    const serverTimer = window.setInterval(() => {
      const now = performance.now();
      const dtMs = Math.min(150, now - lastServer);
      lastServer = now;
      const dx = server.targetX - server.x;
      const dy = server.targetY - server.y;
      const distance = Math.hypot(dx, dy);
      const config = controlsRef.current;
      const eff = runStrideFor(config.speed, config.fps);
      let step = 0;
      if (distance < 4) {
        server.anim = 'idle';
        server.runElapsed = 0;
      } else {
        const nextAnim: AnimalAnimation = distance > config.runDistance ? 'run' : 'walk';
        // like the real server: the leap cycle restarts when the run starts or the stride changes
        if (nextAnim === 'run' && (server.anim !== 'run' || server.stride !== eff)) { server.runElapsed = 0; server.runTravel = 0; }
        server.stride = eff;
        server.anim = nextAnim;
        const baseSpeed = nextAnim === 'run' ? config.speed : config.speed * ANIMAL_APPROACH_SPEED_FACTOR;
        step = config.legacy
          ? baseSpeed * dtMs / 1000
          : nextAnim === 'run'
            ? runDistanceBetween(server.runElapsed, server.runElapsed + dtMs, eff, config.speed)
            : baseSpeed * dtMs / 1000;
        step = Math.min(distance, step);
        server.x += dx / distance * step;
        server.y += dy / distance * step;
        server.dir = ANIMAL_DIRECTIONS.indexOf(animalDirectionFromVector(dx, dy));
        if (nextAnim === 'run') {
          server.runElapsed += dtMs;
          server.runTravel += step;
        }
      }
      instant = dtMs > 0 ? step * 1000 / dtMs : 0;
      totalDistance += step;
      speedSamples.push({ t: now, distance: totalDistance });
      speedSamples = speedSamples.filter((sample) => sample.t >= now - 1100);
      trail.push({ x: server.x, y: server.y, slot: server.anim === 'run' ? runSlotForDistance(server.runTravel, eff) : -1 });
      if (trail.length > 180) trail.shift();
      playback.push(server.anim, server.dir, eff, now);
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
      const state = playback.update(now, x, y);
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
        ctx.fillStyle = dot.slot === 0 ? '#94a3b8' : dot.slot === 1 || dot.slot === 3 ? '#22d3ee' : dot.slot === 2 ? '#f59e0b' : '#64748b';
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

  const effectiveStride = runStrideFor(speed, fps);
  return (
    <main className="min-h-screen bg-slate-950 px-5 py-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-4">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-400">Bancada DEV · Caça</p>
          <h1 className="text-2xl font-bold">Corrida em saltos</h1>
          <p className="text-sm text-slate-400">Clique na área para mudar o alvo. Os pontos mostram cada tique do servidor.</p>
        </header>
        <section className="grid gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4 md:grid-cols-6">
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
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={legacy} onChange={(e) => setLegacy(e.target.checked)} /> movimento antigo (constante)</label>
            <button className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold hover:bg-cyan-600" onClick={() => setResetKey((key) => key + 1)}>Reiniciar</button>
          </div>
          <p className="text-xs text-slate-400 md:col-span-6">Salto: <b className="text-white">{effectiveStride.toFixed(1)} px</b> a cada 2 quadros · animação a <b className="text-white">{effectiveRunFps(fps).toFixed(0)} fps</b> (caminhada: {ANIMAL_ANIMATION_FPS.walk} fps) · quadros 0 e 2 = no ar (rápido), 1 = agachado (lento)</p>
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