import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Copy, Loader2, Minus, Plus, RefreshCw, RotateCcw, Save, Sprout } from 'lucide-react';
import {
  COLLECTIBLE_ITEM_KEYS,
  COLLECTION_CONFIG_ID,
  DEFAULT_DROP_COUNT,
  DEFAULT_FLEE_RADIUS,
  DEFAULT_RESOURCE_HP,
  DEFAULT_RESPAWN_SECONDS,
  GATHER_TOOL_LABELS,
  RESOURCE_HP_RANGE,
  RESOURCE_MIN_LEVEL_RANGE,
  FLEE_RADIUS_RANGE,
  FLEE_SPEED_RANGE,
  FLEEING_ANIMAL_KEYS,
  RESOURCE_KEYS,
  RESPAWN_OPTIONS_SECONDS,
  defaultGatherToolFor,
  type CollectionWorldConfig,
  type GatherToolKind,
  type ResourceHurtbox,
  validateCollectionWorldConfig,
} from '../../../shared/collection/CollectionShapes';
import {
  ANIMAL_FLEE,
  ANIMALS,
  CRAFTING_MAP,
  MINERALS,
  RESOURCES_BASE,
} from '../../../game/config/craftingMapConfig';
import {
  RESOURCE_DEFINITIONS,
  RESOURCE_LABELS,
  type ResourceDefinition,
} from '../../../lib/collection/resourceCatalog';
import { RigApiError } from '../rig-editor/rigApi';
import { collectionApi } from './collectionApi';

// Rótulos e definições de recurso agora vêm do catálogo único
// (lib/collection/resourceCatalog) — compartilhado com o /admin/craft.
const labels = RESOURCE_LABELS;
const resources = RESOURCE_DEFINITIONS;

/** Velocidade de fuga padrão (px/s) = speedMultiplier × o passeio do bicho. */
const defaultFleeSpeed = (key: string): number => {
  const id = key.split(':')[1] ?? key;
  const def = ANIMALS.find((animal) => animal.id === id);
  return Math.round((def?.speed ?? 22) * ANIMAL_FLEE.speedMultiplier);
};

const fullFrame = (width: number, height: number): ResourceHurtbox => ({
  offsetX: 0,
  offsetY: 0,
  width,
  height,
});

function isFullFrame(hurtbox: ResourceHurtbox, width: number, height: number): boolean {
  return hurtbox.offsetX === 0
    && hurtbox.offsetY === 0
    && hurtbox.width === width
    && hurtbox.height === height;
}

function SpritePreview({
  resource,
  hurtbox,
  custom,
  disabled,
  onChange,
  onNaturalSize,
}: {
  resource: ResourceDefinition;
  hurtbox: ResourceHurtbox;
  custom: boolean;
  disabled: boolean;
  onChange: (hurtbox: ResourceHurtbox) => void;
  onNaturalSize: (key: string, width: number, height: number) => void;
}) {
  const fitScale = Math.min(1, 280 / resource.frameWidth, 260 / resource.frameHeight);
  const suggestedScale = resource.frameWidth <= 32
    ? 4
    : resource.frameWidth <= 64
      ? 3
      : fitScale;
  const [scale, setScale] = useState(suggestedScale);
  const [drag, setDrag] = useState<{
    startX: number;
    startY: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);
  const width = resource.frameWidth * scale;
  const height = resource.frameHeight * scale;

  useEffect(() => {
    setScale(resource.frameWidth <= 32 ? 4 : resource.frameWidth <= 64 ? 3 : Math.min(1, 280 / resource.frameWidth, 260 / resource.frameHeight));
  }, [resource.frameWidth, resource.frameHeight]);

  const pointInFrame = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(resource.frameWidth, Math.round((event.clientX - rect.left) / scale))),
      y: Math.max(0, Math.min(resource.frameHeight, Math.round((event.clientY - rect.top) / scale))),
    };
  };

  const finishDrawing = (value: NonNullable<typeof drag>) => {
    const left = Math.max(0, Math.min(resource.frameWidth - 1, value.left));
    const top = Math.max(0, Math.min(resource.frameHeight - 1, value.top));
    const right = Math.max(left + 1, Math.min(resource.frameWidth, value.right));
    const bottom = Math.max(top + 1, Math.min(resource.frameHeight, value.bottom));
    const boxWidth = right - left;
    const boxHeight = bottom - top;
    onChange({
      offsetX: left + boxWidth / 2 - resource.frameWidth / 2,
      offsetY: resource.frameHeight - bottom,
      width: boxWidth,
      height: boxHeight,
    });
  };

  const boundsFromPoint = (
    current: NonNullable<typeof drag>,
    point: { x: number; y: number },
  ) => ({
    ...current,
    left: Math.min(current.startX, point.x),
    top: Math.min(current.startY, point.y),
    right: point.x === current.startX
      ? current.startX + 1
      : Math.max(current.startX, point.x),
    bottom: point.y === current.startY
      ? current.startY + 1
      : Math.max(current.startY, point.y),
  });

  const overlay = drag
    ? {
        left: drag.left,
        top: drag.top,
        width: Math.max(1, drag.right - drag.left),
        height: Math.max(1, drag.bottom - drag.top),
      }
    : {
        left: resource.frameWidth / 2 + hurtbox.offsetX - hurtbox.width / 2,
        top: resource.frameHeight - hurtbox.offsetY - hurtbox.height,
        width: hurtbox.width,
        height: hurtbox.height,
      };

  return (
    <div className="shrink-0">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-500">
        <span>Arraste para desenhar</span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            title="Diminuir zoom"
            disabled={scale <= 0.25}
            onClick={() => setScale((current) => Math.max(0.25, current <= 1 ? current - 0.25 : current - 1))}
            className="rounded border border-slate-700 bg-slate-800 p-0.5 hover:bg-slate-700 disabled:opacity-30"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="w-9 text-center font-mono">{scale.toFixed(scale % 1 ? 2 : 0)}x</span>
          <button
            type="button"
            title="Aumentar zoom"
            disabled={scale >= 8}
            onClick={() => setScale((current) => Math.min(8, current < 1 ? current + 0.25 : current + 1))}
            className="rounded border border-slate-700 bg-slate-800 p-0.5 hover:bg-slate-700 disabled:opacity-30"
          >
            <Plus className="h-3 w-3" />
          </button>
        </span>
      </div>
      <div className="max-h-[320px] max-w-[300px] overflow-auto rounded-lg">
        <div
          className={`relative overflow-hidden border bg-slate-950/80 touch-none select-none ${
            disabled ? 'cursor-not-allowed border-slate-700/60 opacity-50' : 'cursor-crosshair border-cyan-500/30'
          }`}
          style={{ width, height }}
          onPointerDown={(event) => {
            if (disabled) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const point = pointInFrame(event);
            const startX = Math.min(resource.frameWidth - 1, point.x);
            const startY = Math.min(resource.frameHeight - 1, point.y);
            setDrag({
              startX,
              startY,
              left: startX,
              top: startY,
              right: startX + 1,
              bottom: startY + 1,
            });
          }}
          onPointerMove={(event) => {
            if (!drag || disabled) return;
            const point = pointInFrame(event);
            setDrag(boundsFromPoint(drag, point));
          }}
          onPointerUp={(event) => {
            if (!drag || disabled) return;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            const point = pointInFrame(event);
            finishDrawing(boundsFromPoint(drag, point));
            setDrag(null);
          }}
          onPointerCancel={() => setDrag(null)}
        >
          <img
            src={encodeURI(resource.url)}
            alt={`Prévia de ${resource.label}`}
            draggable={false}
            onLoad={(event) => {
              if (resource.naturalImage) {
                onNaturalSize(resource.key, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
              }
            }}
            className="pointer-events-none absolute left-0 top-0 max-w-none select-none [image-rendering:pixelated]"
            style={resource.naturalImage ? { width, height } : { height, width: 'auto' }}
          />
          <div
            className={`pointer-events-none absolute ${
              custom || drag
                ? 'border-2 border-cyan-300 bg-cyan-400/35 shadow-[0_0_10px_rgba(34,211,238,0.35)]'
                : 'border-2 border-dashed border-amber-300/80 bg-amber-300/5'
            }`}
            style={{
              left: overlay.left * scale,
              top: overlay.top * scale,
              width: overlay.width * scale,
              height: overlay.height * scale,
            }}
          />
        </div>
      </div>
      <div
        className="mt-1 font-mono text-[9px] text-slate-600"
      >
        frame {resource.frameWidth}×{resource.frameHeight}px
      </div>
    </div>
  );
}

function respawnLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60} min`;
  return `${seconds / 3600} h`;
}

function countMineralPoints(data: unknown): number {
  const visit = (layers: unknown): number | null => {
    if (!Array.isArray(layers)) return null;
    for (const entry of layers) {
      if (!entry || typeof entry !== 'object') continue;
      const layer = entry as { name?: unknown; objects?: unknown; layers?: unknown };
      if (layer.name === 'minerals_spawns' && Array.isArray(layer.objects)) return layer.objects.length;
      const nested = visit(layer.layers);
      if (nested !== null) return nested;
    }
    return null;
  };
  if (!data || typeof data !== 'object') throw new Error('Formato de mapa inválido.');
  const count = visit((data as { layers?: unknown }).layers);
  if (count === null) throw new Error('Camada "minerals_spawns" não encontrada no mapa.');
  return count;
}

const inputClass =
  'w-full rounded-md border border-slate-700/70 bg-slate-950/70 px-2 py-1.5 text-xs font-mono text-slate-200 focus:border-cyan-500/60 focus:outline-none disabled:opacity-40';
const buttonClass =
  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

export function CollectionAdminPage() {
  const [mineralCounts, setMineralCounts] = useState<Record<string, number>>(
    Object.fromEntries(MINERALS.map((mineral) => [mineral.id, mineral.defaultCount])),
  );
  /** Apenas overrides customizados; chave ausente significa frame inteiro. */
  const [hurtboxes, setHurtboxes] = useState<Record<string, ResourceHurtbox>>({});
  const [dropCounts, setDropCounts] = useState<Record<string, number>>(
    Object.fromEntries(COLLECTIBLE_ITEM_KEYS.map((key) => [key, DEFAULT_DROP_COUNT])),
  );
  /** HP dos recursos golpeáveis (animais fora — eles fogem, não quebram). */
  const [resourceHp, setResourceHp] = useState<Record<string, number>>(
    Object.fromEntries(COLLECTIBLE_ITEM_KEYS.map((key) => [key, DEFAULT_RESOURCE_HP])),
  );
  /** Nível mínimo da ferramenta por recurso (0 = qualquer nível extrai). */
  const [resourceMinLevel, setResourceMinLevel] = useState<Record<string, number>>(
    Object.fromEntries(COLLECTIBLE_ITEM_KEYS.map((key) => [key, 0])),
  );
  /** Ferramenta que extrai cada recurso (padrão por tipo: árvore→machado etc.). */
  const [resourceTool, setResourceTool] = useState<Record<string, GatherToolKind>>(
    Object.fromEntries(COLLECTIBLE_ITEM_KEYS.map((key) => [key, defaultGatherToolFor(key)])),
  );
  const [respawnSeconds, setRespawnSeconds] = useState<Record<string, number>>(
    Object.fromEntries(RESOURCE_KEYS.map((key) => [key, DEFAULT_RESPAWN_SECONDS])),
  );
  const [fleeRadius, setFleeRadius] = useState<Record<string, number>>(
    Object.fromEntries(FLEEING_ANIMAL_KEYS.map((key) => [key, DEFAULT_FLEE_RADIUS])),
  );
  const [fleeSpeed, setFleeSpeed] = useState<Record<string, number>>(
    Object.fromEntries(FLEEING_ANIMAL_KEYS.map((key) => [key, defaultFleeSpeed(key)])),
  );
  const [availablePoints, setAvailablePoints] = useState<number | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [tableSql, setTableSql] = useState<string | null>(null);
  const naturalSizes = useRef(new Map<string, { width: number; height: number }>());
  const [, refreshResourceDimensions] = useState(0);

  useEffect(() => {
    const elements = [document.documentElement, document.body, document.getElementById('root')].filter(
      Boolean,
    ) as HTMLElement[];
    const previous = elements.map((element) => element.style.overflow);
    elements.forEach((element) => {
      element.style.overflow = 'auto';
    });
    return () => elements.forEach((element, index) => {
      element.style.overflow = previous[index];
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(CRAFTING_MAP.path)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Falha ao carregar o mapa (${response.status}).`);
        return response.json() as Promise<unknown>;
      })
      .then((data) => {
        if (!cancelled) setAvailablePoints(countMineralPoints(data));
      })
      .catch((cause) => {
        if (!cancelled) setMapError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyError = useCallback((cause: unknown) => {
    if (cause instanceof RigApiError) {
      setError(
        cause.details?.length
          ? `${cause.message}: ${cause.details.join(' · ')}`
          : cause.message,
      );
      if (cause.tableMissing) {
        setTableMissing(true);
        setTableSql(cause.tableSql ?? null);
      }
    } else {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const loadConfig = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await collectionApi.get();
      setTableMissing(response.tableMissing);
      setTableSql(response.tableSql ?? null);
      const config = response.config;
      if (config) {
        setMineralCounts(Object.fromEntries(
          MINERALS.map((mineral) => [
            mineral.id,
            config.mineralCounts[mineral.id] ?? mineral.defaultCount,
          ]),
        ));
        setHurtboxes(Object.fromEntries(resources.flatMap((resource) => {
          const saved = config.hurtboxes[resource.key];
          if (!saved || isFullFrame(saved, resource.frameWidth, resource.frameHeight)) return [];
          return [[resource.key, saved]];
        })));
        setDropCounts(Object.fromEntries(
          COLLECTIBLE_ITEM_KEYS.map((key) => [
            key,
            config.dropCounts?.[key] ?? DEFAULT_DROP_COUNT,
          ]),
        ));
        setResourceHp(Object.fromEntries(
          COLLECTIBLE_ITEM_KEYS.map((key) => [
            key,
            config.resourceHp?.[key] ?? DEFAULT_RESOURCE_HP,
          ]),
        ));
        setResourceMinLevel(Object.fromEntries(
          COLLECTIBLE_ITEM_KEYS.map((key) => [
            key,
            config.resourceMinLevel?.[key] ?? 0,
          ]),
        ));
        setResourceTool(Object.fromEntries(
          COLLECTIBLE_ITEM_KEYS.map((key) => [
            key,
            config.resourceTool?.[key] ?? defaultGatherToolFor(key),
          ]),
        ));
        setRespawnSeconds(Object.fromEntries(
          RESOURCE_KEYS.map((key) => [
            key,
            config.respawnSeconds?.[key] ?? DEFAULT_RESPAWN_SECONDS,
          ]),
        ));
        setFleeRadius(Object.fromEntries(
          FLEEING_ANIMAL_KEYS.map((key) => [
            key,
            config.fleeRadius?.[key] ?? DEFAULT_FLEE_RADIUS,
          ]),
        ));
        setFleeSpeed(Object.fromEntries(
          FLEEING_ANIMAL_KEYS.map((key) => [
            key,
            config.fleeSpeed?.[key] ?? defaultFleeSpeed(key),
          ]),
        ));
      } else {
        setHurtboxes({});
        setDropCounts(Object.fromEntries(
          COLLECTIBLE_ITEM_KEYS.map((key) => [key, DEFAULT_DROP_COUNT]),
        ));
        setResourceHp(Object.fromEntries(
          COLLECTIBLE_ITEM_KEYS.map((key) => [key, DEFAULT_RESOURCE_HP]),
        ));
        setResourceMinLevel(Object.fromEntries(
          COLLECTIBLE_ITEM_KEYS.map((key) => [key, 0]),
        ));
        setResourceTool(Object.fromEntries(
          COLLECTIBLE_ITEM_KEYS.map((key) => [key, defaultGatherToolFor(key)]),
        ));
        setRespawnSeconds(Object.fromEntries(
          RESOURCE_KEYS.map((key) => [key, DEFAULT_RESPAWN_SECONDS]),
        ));
        setFleeRadius(Object.fromEntries(
          FLEEING_ANIMAL_KEYS.map((key) => [key, DEFAULT_FLEE_RADIUS]),
        ));
        setFleeSpeed(Object.fromEntries(
          FLEEING_ANIMAL_KEYS.map((key) => [key, defaultFleeSpeed(key)]),
        ));
      }
    } catch (cause) {
      applyError(cause);
    } finally {
      setBusy(false);
    }
  }, [applyError]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleNaturalSize = useCallback((key: string, width: number, height: number) => {
    const previous = naturalSizes.current.get(key);
    if (previous?.width === width && previous.height === height) return;
    naturalSizes.current.set(key, { width, height });
    const resource = resources.find((entry) => entry.key === key);
    if (resource) {
      resource.frameWidth = width;
      resource.frameHeight = height;
    }
    setHurtboxes((current) => {
      const saved = current[key];
      if (!saved || !isFullFrame(saved, width, height)) return { ...current };
      const next = { ...current };
      delete next[key];
      return next;
    });
    refreshResourceDimensions((current) => current + 1);
  }, []);

  const totalMinerals = useMemo(
    () => MINERALS.reduce((sum, mineral) => sum + (mineralCounts[mineral.id] ?? 0), 0),
    [mineralCounts],
  );
  const exceedsCapacity = availablePoints !== null && totalMinerals > availablePoints;

  const changeHurtbox = (key: string, field: keyof ResourceHurtbox, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const resource = resources.find((entry) => entry.key === key);
    setHurtboxes((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? fullFrame(resource?.frameWidth ?? 1, resource?.frameHeight ?? 1)),
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    const config: CollectionWorldConfig = {
      configId: COLLECTION_CONFIG_ID,
      mineralCounts: Object.fromEntries(
        MINERALS.map((mineral) => [mineral.id, mineralCounts[mineral.id] ?? 0]),
      ),
      hurtboxes: Object.fromEntries(
        resources.flatMap((resource) => {
          const hurtbox = hurtboxes[resource.key];
          return hurtbox ? [[resource.key, hurtbox]] : [];
        }),
      ),
      dropCounts: Object.fromEntries(
        COLLECTIBLE_ITEM_KEYS.map((key) => [key, dropCounts[key] ?? DEFAULT_DROP_COUNT]),
      ),
      resourceHp: Object.fromEntries(
        COLLECTIBLE_ITEM_KEYS.map((key) => [key, resourceHp[key] ?? DEFAULT_RESOURCE_HP]),
      ),
      resourceMinLevel: Object.fromEntries(
        COLLECTIBLE_ITEM_KEYS.map((key) => [key, resourceMinLevel[key] ?? 0]),
      ),
      resourceTool: Object.fromEntries(
        COLLECTIBLE_ITEM_KEYS.map((key) => [key, resourceTool[key] ?? defaultGatherToolFor(key)]),
      ),
      respawnSeconds: Object.fromEntries(
        RESOURCE_KEYS.map((key) => [key, respawnSeconds[key] ?? DEFAULT_RESPAWN_SECONDS]),
      ),
      fleeRadius: Object.fromEntries(
        FLEEING_ANIMAL_KEYS.map((key) => [key, fleeRadius[key] ?? DEFAULT_FLEE_RADIUS]),
      ),
      fleeSpeed: Object.fromEntries(
        FLEEING_ANIMAL_KEYS.map((key) => [key, fleeSpeed[key] ?? defaultFleeSpeed(key)]),
      ),
    };
    const validation = validateCollectionWorldConfig(config);
    if (!validation.ok) {
      setError(`Corrija os dados antes de salvar: ${validation.errors.join(' · ')}`);
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await collectionApi.save(config);
      setMineralCounts(response.config.mineralCounts);
      setHurtboxes(response.config.hurtboxes);
      setDropCounts(Object.fromEntries(
        COLLECTIBLE_ITEM_KEYS.map((key) => [
          key,
          response.config.dropCounts?.[key] ?? DEFAULT_DROP_COUNT,
        ]),
      ));
      setResourceHp(Object.fromEntries(
        COLLECTIBLE_ITEM_KEYS.map((key) => [
          key,
          response.config.resourceHp?.[key] ?? DEFAULT_RESOURCE_HP,
        ]),
      ));
      setResourceMinLevel(Object.fromEntries(
        COLLECTIBLE_ITEM_KEYS.map((key) => [
          key,
          response.config.resourceMinLevel?.[key] ?? 0,
        ]),
      ));
      setResourceTool(Object.fromEntries(
        COLLECTIBLE_ITEM_KEYS.map((key) => [
          key,
          response.config.resourceTool?.[key] ?? defaultGatherToolFor(key),
        ]),
      ));
      setRespawnSeconds(Object.fromEntries(
        RESOURCE_KEYS.map((key) => [
          key,
          response.config.respawnSeconds?.[key] ?? DEFAULT_RESPAWN_SECONDS,
        ]),
      ));
      setFleeRadius(Object.fromEntries(
        FLEEING_ANIMAL_KEYS.map((key) => [
          key,
          response.config.fleeRadius?.[key] ?? DEFAULT_FLEE_RADIUS,
        ]),
      ));
      setFleeSpeed(Object.fromEntries(
        FLEEING_ANIMAL_KEYS.map((key) => [
          key,
          response.config.fleeSpeed?.[key] ?? defaultFleeSpeed(key),
        ]),
      ));
      setSuccess('Configuração salva com sucesso.');
    } catch (cause) {
      applyError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 [background-image:radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.06),transparent_45%),radial-gradient(circle_at_80%_100%,rgba(16,185,129,0.06),transparent_45%)]">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <header className="mb-5 flex flex-wrap items-center gap-3">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2">
            <Sprout className="h-5 w-5 text-emerald-300" />
          </div>
          <div>
            <h1 className="bg-gradient-to-r from-emerald-300 via-cyan-300 to-sky-300 bg-clip-text text-xl font-semibold text-transparent">
              Mundo de Coleta
            </h1>
            <p className="font-mono text-[11px] text-slate-500">
              distribuição de minérios · caixas de acerto dos recursos
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => void loadConfig()}
              disabled={busy}
              className={`${buttonClass} border border-slate-700/60 bg-slate-800/80 hover:bg-slate-700/80`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Recarregar
            </button>
            <Link
              to="/admin"
              className={`${buttonClass} border border-slate-700/60 bg-slate-800/80 hover:bg-slate-700/80`}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Administração
            </Link>
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            {success}
          </div>
        )}
        {tableMissing && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            <p className="mb-1.5 font-medium">
              A tabela do mundo de coleta ainda não existe. Rode uma vez no SQL editor do Supabase e clique em Recarregar:
            </p>
            {tableSql && (
              <div className="relative">
                <pre className="overflow-x-auto rounded-md border border-amber-500/20 bg-slate-950/70 p-2.5 pr-10 text-[10px] leading-relaxed text-amber-100/90">
                  {tableSql}
                </pre>
                <button
                  type="button"
                  title="Copiar SQL"
                  onClick={() => void navigator.clipboard.writeText(tableSql)}
                  className="absolute right-1.5 top-1.5 rounded-md bg-slate-800/90 p-1.5 text-slate-300 hover:bg-slate-700"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        <section className="mb-4 rounded-xl border border-slate-700/60 bg-slate-900/70 p-4">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Minérios no mapa</h2>
              <p className="mt-1 text-xs text-slate-500">
                Defina quantos nós de cada minério entram no sorteio diário.
              </p>
            </div>
            <div className={`rounded-md border px-3 py-1.5 text-xs font-mono ${exceedsCapacity ? 'border-rose-500/50 bg-rose-500/10 text-rose-300' : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'}`}>
              {totalMinerals} / {availablePoints ?? '…'} pontos disponíveis
            </div>
          </div>
          {mapError && <p className="mb-3 text-xs text-rose-300">Não foi possível contar os pontos: {mapError}</p>}
          {exceedsCapacity && (
            <p className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              A soma excede os pontos disponíveis. O mapa trunca silenciosamente os minérios que não couberem.
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {MINERALS.map((mineral) => (
              <label key={mineral.id} className="flex items-center gap-3 rounded-lg border border-slate-700/50 bg-slate-950/40 p-2">
                <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-slate-900">
                  <img
                    src={encodeURI(`${RESOURCES_BASE}minerals/${mineral.file}`)}
                    alt=""
                    className="absolute left-0 top-0 h-14 max-w-none [image-rendering:pixelated]"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mb-1 block text-xs text-slate-300">{labels[mineral.id]}</span>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    step={1}
                    disabled={busy || tableMissing}
                    value={mineralCounts[mineral.id] ?? 0}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isInteger(value)) {
                        setMineralCounts((current) => ({
                          ...current,
                          [mineral.id]: Math.max(0, Math.min(999, value)),
                        }));
                      }
                    }}
                    className={inputClass}
                  />
                </span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Pedras de mão, arbustos, ervas, árvores e animais sempre preenchem todos os seus pontos e não são configuráveis aqui.
          </p>
        </section>

        <section className="rounded-xl border border-slate-700/60 bg-slate-900/70 p-4">
          <h2 className="text-sm font-semibold text-slate-100">Caixas de acerto (hurtboxes)</h2>
          <p className="mb-5 mt-1 text-xs text-slate-500">
            Clique e arraste sobre cada imagem para desenhar a área atingível. Use o zoom para ganhar precisão.
          </p>
          {(['Minerais', 'Árvores', 'Ervas', 'Outros', 'Animais'] as const).map((group) => (
            <div key={group} className="mb-6 last:mb-0">
              <h3 className="mb-2 font-mono text-[11px] uppercase tracking-widest text-slate-400">{group}</h3>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {resources.filter((resource) => resource.group === group).map((resource) => {
                  const customHurtbox = hurtboxes[resource.key];
                  const hurtbox = customHurtbox ?? fullFrame(resource.frameWidth, resource.frameHeight);
                  return (
                    <div key={resource.key} className="flex flex-col gap-3 rounded-lg border border-slate-700/50 bg-slate-950/40 p-3 sm:flex-row">
                      <SpritePreview
                        resource={resource}
                        hurtbox={hurtbox}
                        custom={customHurtbox !== undefined}
                        disabled={busy || tableMissing}
                        onChange={(next) => setHurtboxes((current) => ({ ...current, [resource.key]: next }))}
                        onNaturalSize={handleNaturalSize}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span>
                            <span className="block text-xs font-medium text-slate-200">{resource.label}</span>
                            <span className="mb-2 block truncate font-mono text-[9px] text-slate-600">{resource.key}</span>
                          </span>
                          <button
                            type="button"
                            disabled={busy || tableMissing || !customHurtbox}
                            onClick={() => setHurtboxes((current) => {
                              const next = { ...current };
                              delete next[resource.key];
                              return next;
                            })}
                            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-1.5 py-1 text-[10px] text-slate-400 hover:text-amber-200 disabled:opacity-30"
                          >
                            <RotateCcw className="h-3 w-3" /> Limpar
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            ['offsetX', 'Deslocamento X'],
                            ['offsetY', 'Deslocamento Y'],
                            ['width', 'Largura'],
                            ['height', 'Altura'],
                          ] as const).map(([field, label]) => (
                            <label key={field} className="text-[10px] text-slate-500">
                              {label}
                              <input
                                type="number"
                                step={field === 'offsetX' ? 0.5 : 1}
                                disabled={busy || tableMissing}
                                value={hurtbox[field]}
                                onChange={(event) => {
                                  if (!customHurtbox) {
                                    setHurtboxes((current) => ({ ...current, [resource.key]: hurtbox }));
                                  }
                                  changeHurtbox(resource.key, field, event.target.value);
                                }}
                                className={`${inputClass} mt-0.5`}
                              />
                            </label>
                          ))}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-800 pt-3">
                          {!resource.key.startsWith('animal:') && (
                            <>
                              <label className="text-[10px] text-slate-500">
                                Itens por quebra
                                <input
                                  type="number"
                                  min={0}
                                  max={20}
                                  step={1}
                                  disabled={busy || tableMissing}
                                  value={dropCounts[resource.key] ?? DEFAULT_DROP_COUNT}
                                  onChange={(event) => {
                                    const value = Number(event.target.value);
                                    if (Number.isInteger(value)) {
                                      setDropCounts((current) => ({
                                        ...current,
                                        [resource.key]: Math.max(0, Math.min(20, value)),
                                      }));
                                    }
                                  }}
                                  className={`${inputClass} mt-0.5`}
                                />
                              </label>
                              <label className="text-[10px] text-slate-500">
                                HP do recurso
                                <input
                                  type="number"
                                  min={RESOURCE_HP_RANGE.min}
                                  max={RESOURCE_HP_RANGE.max}
                                  step={1}
                                  disabled={busy || tableMissing}
                                  value={resourceHp[resource.key] ?? DEFAULT_RESOURCE_HP}
                                  onChange={(event) => {
                                    const value = Number(event.target.value);
                                    if (Number.isInteger(value)) {
                                      setResourceHp((current) => ({
                                        ...current,
                                        [resource.key]: Math.max(
                                          RESOURCE_HP_RANGE.min,
                                          Math.min(RESOURCE_HP_RANGE.max, value),
                                        ),
                                      }));
                                    }
                                  }}
                                  className={`${inputClass} mt-0.5`}
                                />
                              </label>
                              <label className="text-[10px] text-slate-500">
                                Nível mínimo ({RESOURCE_MIN_LEVEL_RANGE.min}–{RESOURCE_MIN_LEVEL_RANGE.max})
                                <input
                                  type="number"
                                  min={RESOURCE_MIN_LEVEL_RANGE.min}
                                  max={RESOURCE_MIN_LEVEL_RANGE.max}
                                  step={1}
                                  disabled={busy || tableMissing}
                                  value={resourceMinLevel[resource.key] ?? 0}
                                  onChange={(event) => {
                                    const value = Number(event.target.value);
                                    if (Number.isInteger(value)) {
                                      setResourceMinLevel((current) => ({
                                        ...current,
                                        [resource.key]: Math.max(
                                          RESOURCE_MIN_LEVEL_RANGE.min,
                                          Math.min(RESOURCE_MIN_LEVEL_RANGE.max, value),
                                        ),
                                      }));
                                    }
                                  }}
                                  className={`${inputClass} mt-0.5`}
                                />
                              </label>
                              <label className="text-[10px] text-slate-500">
                                Dado por qual ferramenta?
                                <select
                                  disabled={busy || tableMissing}
                                  value={resourceTool[resource.key] ?? defaultGatherToolFor(resource.key)}
                                  onChange={(event) => {
                                    const value = event.target.value as GatherToolKind;
                                    setResourceTool((current) => ({
                                      ...current,
                                      [resource.key]: value,
                                    }));
                                  }}
                                  className={`${inputClass} mt-0.5`}
                                >
                                  {Object.entries(GATHER_TOOL_LABELS).map(([kind, label]) => (
                                    <option key={kind} value={kind}>{label}</option>
                                  ))}
                                </select>
                              </label>
                            </>
                          )}
                          <label className={`text-[10px] text-slate-500 ${resource.key.startsWith('animal:') ? 'col-span-2' : ''}`}>
                            Renascer após
                            <select
                              disabled={busy || tableMissing}
                              value={respawnSeconds[resource.key] ?? DEFAULT_RESPAWN_SECONDS}
                              onChange={(event) => setRespawnSeconds((current) => ({
                                ...current,
                                [resource.key]: Number(event.target.value),
                              }))}
                              className={`${inputClass} mt-0.5`}
                            >
                              {RESPAWN_OPTIONS_SECONDS.map((seconds) => (
                                <option key={seconds} value={seconds}>{respawnLabel(seconds)}</option>
                              ))}
                            </select>
                          </label>
                          {FLEEING_ANIMAL_KEYS.includes(resource.key) && (
                            <>
                              <label className="text-[10px] text-slate-500">
                                Raio de fuga (px)
                                <input
                                  type="number"
                                  min={FLEE_RADIUS_RANGE.min}
                                  max={FLEE_RADIUS_RANGE.max}
                                  step={10}
                                  disabled={busy || tableMissing}
                                  value={fleeRadius[resource.key] ?? DEFAULT_FLEE_RADIUS}
                                  onChange={(event) => {
                                    const value = Number(event.target.value);
                                    if (Number.isFinite(value)) {
                                      setFleeRadius((current) => ({
                                        ...current,
                                        [resource.key]: Math.max(
                                          FLEE_RADIUS_RANGE.min,
                                          Math.min(FLEE_RADIUS_RANGE.max, Math.round(value)),
                                        ),
                                      }));
                                    }
                                  }}
                                  className={`${inputClass} mt-0.5`}
                                />
                              </label>
                              <label className="text-[10px] text-slate-500">
                                Velocidade de fuga (px/s)
                                <input
                                  type="number"
                                  min={FLEE_SPEED_RANGE.min}
                                  max={FLEE_SPEED_RANGE.max}
                                  step={5}
                                  disabled={busy || tableMissing}
                                  value={fleeSpeed[resource.key] ?? defaultFleeSpeed(resource.key)}
                                  onChange={(event) => {
                                    const value = Number(event.target.value);
                                    if (Number.isFinite(value)) {
                                      setFleeSpeed((current) => ({
                                        ...current,
                                        [resource.key]: Math.max(
                                          FLEE_SPEED_RANGE.min,
                                          Math.min(FLEE_SPEED_RANGE.max, Math.round(value)),
                                        ),
                                      }));
                                    }
                                  }}
                                  className={`${inputClass} mt-0.5`}
                                />
                              </label>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <div className="sticky bottom-0 mt-4 flex justify-end border-t border-slate-800/80 bg-slate-950/90 py-3 backdrop-blur">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || tableMissing}
            className={`${buttonClass} bg-cyan-600 px-5 py-2 text-white hover:bg-cyan-500`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}