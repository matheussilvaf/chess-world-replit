import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Copy, Loader2, RefreshCw, Save, Sprout } from 'lucide-react';
import {
  COLLECTION_CONFIG_ID,
  type CollectionWorldConfig,
  type ResourceHurtbox,
  validateCollectionWorldConfig,
} from '../../../shared/collection/CollectionShapes';
import {
  ANIMALS,
  BUSH,
  CRAFTING_MAP,
  HAND_STONE,
  HERBS,
  MINERALS,
  MINERAL_SHEET,
  RESOURCES_BASE,
  TREE_SHEET,
  TREE_TYPES,
  herbUrl,
  treeSheetUrl,
} from '../../../game/config/craftingMapConfig';
import { RigApiError } from '../rig-editor/rigApi';
import { collectionApi } from './collectionApi';

interface ResourceDefinition {
  key: string;
  label: string;
  group: 'Minerais' | 'Árvores' | 'Ervas' | 'Outros' | 'Animais';
  url: string;
  frameWidth: number;
  frameHeight: number;
  naturalImage?: boolean;
}

const labels: Record<string, string> = {
  pedra: 'Pedra',
  carvao: 'Carvão',
  ferro: 'Ferro',
  cobre: 'Cobre',
  ouro: 'Ouro',
  diamante: 'Diamante',
  cristal_real: 'Cristal real',
  pinheiro_peao: 'Pinheiro-peão',
  carvalho_torre: 'Carvalho-torre',
  freixo_cavalo: 'Freixo-cavalo',
  ebano_dama: 'Ébano-dama',
  salgueiro_bispo: 'Salgueiro-bispo',
  heal_herb: 'Erva de cura',
  red_herb: 'Erva vermelha',
  blue_herb: 'Erva azul',
  queen_thorn: 'Espinho da rainha',
  horse_root: 'Raiz de cavalo',
  bush: 'Arbusto',
  hand_stone: 'Pedra de mão',
  cow: 'Vaca',
  sheep: 'Ovelha',
  chicken: 'Galinha',
};

const resources: ResourceDefinition[] = [
  ...MINERALS.map((m) => ({
    key: `mineral:${m.id}`,
    label: labels[m.id],
    group: 'Minerais' as const,
    url: `${RESOURCES_BASE}minerals/${m.file}`,
    frameWidth: MINERAL_SHEET.frameWidth,
    frameHeight: MINERAL_SHEET.frameHeight,
  })),
  ...TREE_TYPES.map((tree) => ({
    key: `tree:${tree}`,
    label: labels[tree],
    group: 'Árvores' as const,
    url: treeSheetUrl(tree),
    frameWidth: TREE_SHEET.frameWidth,
    frameHeight: TREE_SHEET.frameHeight,
  })),
  ...HERBS.map((herb) => ({
    key: `herb:${herb.id}`,
    label: labels[herb.id],
    group: 'Ervas' as const,
    url: herbUrl(herb.file),
    frameWidth: 1,
    frameHeight: 1,
    naturalImage: true,
  })),
  {
    key: 'bush',
    label: labels.bush,
    group: 'Outros',
    url: BUSH.url,
    frameWidth: 1,
    frameHeight: 1,
    naturalImage: true,
  },
  {
    key: 'hand_stone',
    label: labels.hand_stone,
    group: 'Outros',
    url: HAND_STONE.url,
    frameWidth: HAND_STONE.frameWidth,
    frameHeight: HAND_STONE.frameHeight,
  },
  ...ANIMALS.map((animal) => ({
    key: `animal:${animal.id}`,
    label: labels[animal.id],
    group: 'Animais' as const,
    url: `${RESOURCES_BASE}animais/${animal.file}`,
    frameWidth: animal.frameSize,
    frameHeight: animal.frameSize,
  })),
];

const fullFrame = (width: number, height: number): ResourceHurtbox => ({
  offsetX: 0,
  offsetY: 0,
  width,
  height,
});

function initialHurtboxes(): Record<string, ResourceHurtbox> {
  return Object.fromEntries(
    resources.map((resource) => [
      resource.key,
      fullFrame(resource.frameWidth, resource.frameHeight),
    ]),
  );
}

function SpritePreview({
  resource,
  hurtbox,
  onNaturalSize,
}: {
  resource: ResourceDefinition;
  hurtbox: ResourceHurtbox;
  onNaturalSize: (key: string, width: number, height: number) => void;
}) {
  const maxWidth = resource.group === 'Árvores' ? 240 : 150;
  const maxHeight = resource.group === 'Árvores' ? 182 : 150;
  const scale = Math.min(1, maxWidth / resource.frameWidth, maxHeight / resource.frameHeight);
  const width = resource.frameWidth * scale;
  const height = resource.frameHeight * scale;
  return (
    <div
      className="relative overflow-hidden bg-slate-950/80 border border-slate-700/60 rounded-lg shrink-0"
      style={{ width, height }}
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
        className="absolute left-0 top-0 max-w-none select-none [image-rendering:pixelated]"
        style={
          resource.naturalImage
            ? { width, height }
            : { height, width: 'auto' }
        }
      />
      <div
        className="absolute border-2 border-rose-400 bg-rose-400/15 pointer-events-none"
        style={{
          left: (resource.frameWidth / 2 + hurtbox.offsetX - hurtbox.width / 2) * scale,
          top: (resource.frameHeight - hurtbox.offsetY - hurtbox.height) * scale,
          width: hurtbox.width * scale,
          height: hurtbox.height * scale,
        }}
      />
    </div>
  );
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
  const [hurtboxes, setHurtboxes] = useState<Record<string, ResourceHurtbox>>(initialHurtboxes);
  const [availablePoints, setAvailablePoints] = useState<number | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [tableSql, setTableSql] = useState<string | null>(null);
  const persistedKeys = useRef(new Set<string>());
  const naturalSizes = useRef(new Map<string, { width: number; height: number }>());

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
        persistedKeys.current = new Set(Object.keys(config.hurtboxes));
        setMineralCounts(Object.fromEntries(
          MINERALS.map((mineral) => [
            mineral.id,
            config.mineralCounts[mineral.id] ?? mineral.defaultCount,
          ]),
        ));
        setHurtboxes(Object.fromEntries(resources.map((resource) => {
          const natural = naturalSizes.current.get(resource.key);
          return [
            resource.key,
            config.hurtboxes[resource.key]
              ?? fullFrame(
                natural?.width ?? resource.frameWidth,
                natural?.height ?? resource.frameHeight,
              ),
          ];
        })));
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
    if (!persistedKeys.current.has(key)) {
      setHurtboxes((current) => ({ ...current, [key]: fullFrame(width, height) }));
    }
  }, []);

  const totalMinerals = useMemo(
    () => MINERALS.reduce((sum, mineral) => sum + (mineralCounts[mineral.id] ?? 0), 0),
    [mineralCounts],
  );
  const exceedsCapacity = availablePoints !== null && totalMinerals > availablePoints;

  const changeHurtbox = (key: string, field: keyof ResourceHurtbox, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    setHurtboxes((current) => ({
      ...current,
      [key]: { ...current[key], [field]: value },
    }));
  };

  const handleSave = async () => {
    const config: CollectionWorldConfig = {
      configId: COLLECTION_CONFIG_ID,
      mineralCounts: Object.fromEntries(
        MINERALS.map((mineral) => [mineral.id, mineralCounts[mineral.id] ?? 0]),
      ),
      hurtboxes: Object.fromEntries(
        resources.map((resource) => [
          resource.key,
          hurtboxes[resource.key] ?? fullFrame(resource.frameWidth, resource.frameHeight),
        ]),
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
      persistedKeys.current = new Set(Object.keys(response.config.hurtboxes));
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
            Valores em pixels do frame fonte. O deslocamento X parte do centro do pé; Y sobe a partir do pé.
          </p>
          {(['Minerais', 'Árvores', 'Ervas', 'Outros', 'Animais'] as const).map((group) => (
            <div key={group} className="mb-6 last:mb-0">
              <h3 className="mb-2 font-mono text-[11px] uppercase tracking-widest text-slate-400">{group}</h3>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {resources.filter((resource) => resource.group === group).map((resource) => {
                  const hurtbox = hurtboxes[resource.key] ?? fullFrame(resource.frameWidth, resource.frameHeight);
                  return (
                    <div key={resource.key} className="flex flex-col gap-3 rounded-lg border border-slate-700/50 bg-slate-950/40 p-3 sm:flex-row">
                      <SpritePreview resource={resource} hurtbox={hurtbox} onNaturalSize={handleNaturalSize} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-200">{resource.label}</p>
                        <p className="mb-2 truncate font-mono text-[9px] text-slate-600">{resource.key}</p>
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
                                step={1}
                                disabled={busy || tableMissing}
                                value={hurtbox[field]}
                                onChange={(event) => changeHurtbox(resource.key, field, event.target.value)}
                                className={`${inputClass} mt-0.5`}
                              />
                            </label>
                          ))}
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