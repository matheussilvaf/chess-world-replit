import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import {
  ANIMAL_ANIMATIONS,
  ANIMAL_ANIMATION_COLUMNS,
  ANIMAL_DEFAULT_COLLISION_RADIUS,
  ANIMAL_DEFAULT_HITBOX,
  ANIMAL_DEFAULT_HURTBOX,
  ANIMAL_DEFAULT_ORIGIN,
  ANIMAL_DIRECTIONS,
  type AnimalAnimation,
  type AnimalDirection,
  type HuntingManifestAnimal,
} from '../../../shared/hunting/HuntingShapes';
import {
  RIG_SCHEMA_VERSION,
  cloneRigConfig,
  emptyRigFrame,
  getRigFrameConfig,
  validateRigConfig,
  type LocalRectangle,
  type RigConfig,
  type RigFrameConfig,
} from '../../../shared/combat/RigShapes';
import { rigApi, RigApiError } from '../rig-editor/rigApi';
import { RigCanvas } from '../rig-editor/RigCanvas';
import type { BoxKind, BoxSelection, EditorTool } from '../rig-editor/types';

const button = 'rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-40';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function freshRig(animal: HuntingManifestAnimal): RigConfig {
  const reference = animal.variants[0];
  const animationConfigs: RigConfig['animationConfigs'] = {};
  for (const animation of ANIMAL_ANIMATIONS) {
    animationConfigs[animation] = { directions: {} };
    for (const direction of ANIMAL_DIRECTIONS) {
      const frames: Record<string, RigFrameConfig> = {};
      for (let i = 0; i < 3; i++) {
        frames[String(i)] = {
          hurtbox: { enabled: true, rectangles: [{ id: `hurt-${animation}-${direction}-${i}`, ...ANIMAL_DEFAULT_HURTBOX }] },
          hitbox: animation === 'attack'
            ? { enabled: true, rectangles: [{ id: `hit-${direction}-${i}`, ...ANIMAL_DEFAULT_HITBOX }] }
            : { enabled: false, rectangles: [] },
        };
      }
      animationConfigs[animation].directions[direction] = { frames };
    }
  }
  return {
    schemaVersion: RIG_SCHEMA_VERSION,
    rigId: animal.rigId,
    displayName: animal.animal,
    sheet: {
      width: reference.width, height: reference.height,
      frameWidth: reference.frameWidth, frameHeight: reference.frameHeight,
      columns: 12, rows: 8,
    },
    directions: { south: 0, west: 1, east: 2, north: 3 },
    animations: clone(ANIMAL_ANIMATION_COLUMNS),
    origin: { ...ANIMAL_DEFAULT_ORIGIN },
    collisionBody: { shape: 'circle', offsetX: 0, offsetY: 0, radius: ANIMAL_DEFAULT_COLLISION_RADIUS },
    previewAppearance: {},
    animationConfigs,
  };
}

export function AnimalRigPanel({ animal }: { animal: HuntingManifestAnimal }) {
  const [rig, setRig] = useState<RigConfig>(() => freshRig(animal));
  const [exists, setExists] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [animation, setAnimation] = useState<AnimalAnimation>('idle');
  const [direction, setDirection] = useState<AnimalDirection>('south');
  const [localFrame, setLocalFrame] = useState(0);
  const [variantId, setVariantId] = useState(animal.variants[0].variantId);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [selection, setSelection] = useState<BoxSelection | null>(null);
  const [tool, setTool] = useState<EditorTool>('select');

  useEffect(() => {
    let active = true;
    rigApi.get(animal.rigId).then(({ rig: loaded }) => {
      if (active) {
        setRig(cloneRigConfig(loaded));
        setExists(true);
      }
    }).catch((cause) => {
      if (active && (!(cause instanceof RigApiError) || cause.status !== 404)) setMessage(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [animal.rigId]);

  const variant = animal.variants.find((item) => item.variantId === variantId) ?? animal.variants[0];
  useEffect(() => {
    const next = new Image();
    next.onload = () => setImage(next);
    next.onerror = () => setMessage('Não foi possível abrir a sheet de referência.');
    next.src = variant.url;
  }, [variant.url]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const frame = useMemo(() => getRigFrameConfig(rig, animation, direction, localFrame), [rig, animation, direction, localFrame]);
  const updateRig = (apply: (next: RigConfig) => void) => {
    setRig((current) => {
      const next = cloneRigConfig(current);
      apply(next);
      return next;
    });
    setDirty(true);
    setMessage(null);
  };
  const editFrame = (apply: (next: RigFrameConfig) => void) => updateRig((next) => {
    const config = next.animationConfigs[animation] ??= { directions: {} };
    const dir = config.directions[direction] ??= { frames: {} };
    const current = dir.frames[String(localFrame)] ??= emptyRigFrame();
    apply(current);
  });
  const addRect = (kind: BoxKind, rect: LocalRectangle) => editFrame((next) => {
    next[kind].enabled = true;
    next[kind].rectangles.push({ ...rect, id: `${kind}-${Date.now().toString(36)}` });
    setTool('select');
  });
  const copyPrevious = (kind: BoxKind) => {
    const source = getRigFrameConfig(rig, animation, direction, localFrame - 1);
    editFrame((next) => {
      next[kind].enabled = source[kind].enabled;
      next[kind].rectangles = source[kind].rectangles.map((rect, index) => ({
        ...rect,
        id: `${kind}-${Date.now().toString(36)}-${index}`,
      }));
    });
    setSelection(null);
  };
  const save = async () => {
    const validation = validateRigConfig(rig);
    if (!validation.ok) {
      setMessage(`Rig inválido: ${validation.errors.join('; ')}`);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = exists ? await rigApi.save(validation.config) : await rigApi.create(validation.config);
      setRig(cloneRigConfig(response.rig));
      setExists(true);
      setDirty(false);
      setMessage('Rig salvo');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const maxScale = Math.max(1, Math.min(4, Math.floor(320 / Math.max(rig.sheet.frameWidth, rig.sheet.frameHeight))));
  return (
    <details className="mt-4 rounded-lg border border-cyan-900/50 bg-slate-950/60 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-cyan-300">
        Rig (hurtbox/hitbox) <span className="ml-2 text-xs font-normal text-slate-500">{exists ? (dirty ? 'alterado' : 'Rig salvo') : 'sem rig'}</span>
      </summary>
      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(280px,auto)_1fr]">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <select className={button} value={variantId} onChange={(event) => setVariantId(event.target.value)}>
              {animal.variants.map((item) => <option key={item.variantId} value={item.variantId}>{item.file}</option>)}
            </select>
            <select className={button} value={animation} onChange={(event) => { setAnimation(event.target.value as AnimalAnimation); setSelection(null); }}>
              {ANIMAL_ANIMATIONS.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select className={button} value={direction} onChange={(event) => { setDirection(event.target.value as AnimalDirection); setSelection(null); }}>
              {ANIMAL_DIRECTIONS.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select className={button} value={localFrame} onChange={(event) => setLocalFrame(Number(event.target.value))}>
              {[0, 1, 2].map((item) => <option key={item} value={item}>frame {item}</option>)}
            </select>
          </div>
          <div className="inline-block overflow-auto rounded border border-slate-700">
            <RigCanvas
              image={image}
              frameWidth={rig.sheet.frameWidth}
              frameHeight={rig.sheet.frameHeight}
              rowIndex={rig.directions[direction] ?? 0}
              sheetColumn={rig.animations[animation]?.[localFrame] ?? 0}
              scale={maxScale}
              origin={rig.origin}
              body={rig.collisionBody}
              frame={frame}
              showBoxes
              selection={selection}
              tool={tool}
              snap1px
              onInteractionStart={() => setDirty(true)}
              onOriginChange={(x, y) => updateRig((next) => { next.origin = { x, y }; })}
              onBodyChange={(offsetX, offsetY) => updateRig((next) => { next.collisionBody.offsetX = offsetX; next.collisionBody.offsetY = offsetY; })}
              onRectChange={(kind, index, rect) => editFrame((next) => { next[kind].rectangles[index] = rect; })}
              onRectAdd={addRect}
              onSelect={setSelection}
            />
          </div>
        </div>
        <div className="space-y-3 text-xs">
          <div className="flex flex-wrap gap-2">
            {(['select', 'draw-hurtbox', 'draw-hitbox'] as const).map((item) => (
              <button key={item} type="button" className={`${button} ${tool === item ? 'border-cyan-500 text-cyan-300' : ''}`} onClick={() => setTool(item)}>
                {item === 'select' ? 'Selecionar/mover' : item === 'draw-hurtbox' ? 'Desenhar hurtbox' : 'Desenhar hitbox'}
              </button>
            ))}
          </div>
          <div className="flex gap-4">
            {(['hurtbox', 'hitbox'] as const).map((kind) => (
              <label key={kind} className={kind === 'hitbox' && animation !== 'attack' ? 'opacity-40' : ''}>
                <input type="checkbox" checked={frame[kind].enabled} disabled={kind === 'hitbox' && animation !== 'attack'}
                  onChange={(event) => editFrame((next) => { next[kind].enabled = event.target.checked; })} /> {kind} ativa
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {selection && frame[selection.kind].rectangles[selection.index] && (
              <button type="button" className={`${button} border-rose-800 text-rose-300`} onClick={() => editFrame((next) => {
                next[selection.kind].rectangles.splice(selection.index, 1);
                setSelection(null);
              })}>Excluir caixa selecionada</button>
            )}
            <button type="button" className={button} disabled={localFrame === 0}
              title="Substitui a hurtbox deste frame pela hurtbox do frame anterior"
              onClick={() => copyPrevious('hurtbox')}>Copiar hurtbox do frame anterior</button>
            <button type="button" className={button} disabled={localFrame === 0 || animation !== 'attack'}
              title="Substitui a hitbox deste frame pela hitbox do frame anterior da animação de ataque"
              onClick={() => copyPrevious('hitbox')}>Copiar hitbox do frame anterior</button>
          </div>
          <label className="block">Raio de colisão
            <input type="number" min={1} max={512} className="ml-2 w-20 rounded bg-slate-800 px-2 py-1"
              value={rig.collisionBody.radius} onChange={(event) => updateRig((next) => { next.collisionBody.radius = Number(event.target.value); })} />
          </label>
          <p className="text-slate-500">Arraste a cruz ciano para a origem, o círculo vermelho para a colisão e as caixas para mover/redimensionar.</p>
          {message && <p className={message === 'Rig salvo' ? 'text-emerald-400' : 'text-rose-400'}>{message}</p>}
          <button type="button" disabled={busy || (!dirty && exists)} onClick={() => void save()} className={`${button} border-cyan-600 bg-cyan-950 text-cyan-200`}>
            <Save className="inline h-3.5 w-3.5" /> {busy ? 'Salvando…' : 'Salvar rig'}
          </button>
        </div>
      </div>
    </details>
  );
}