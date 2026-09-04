import { useEffect, useMemo, useState } from 'react';
import { StationPreview } from '../admin/stations/StationPreview';
import { getColyseusHttpUrl } from '../../config/colyseus';
import { getGeneratorManifest } from '../../game/characters/appearanceRuntime';
import { buildCraftCatalog } from '../../lib/craft/craftCatalog';
import { craft } from '../../game/stations/stationCraftBridge';
import { useCollectionInventoryStore } from '../../stores/collectionInventoryStore';
import { usePlacedStationsStore } from '../../stores/placedStationsStore';
import type { CraftItemConfig, CraftRecipeConfig } from '../../shared/craft/CraftShapes';
import type { StationConfig } from '../../shared/craft/StationShapes';
import { PlacedStationBanner } from './stations/PlacedStationBanner';

interface StationsPayload {
  stations: StationConfig[];
  members: Record<string, string>;
}
interface CraftPayload {
  items: Record<string, CraftItemConfig>;
  recipes: Record<string, CraftRecipeConfig>;
}

async function getPublic<T>(path: string): Promise<T> {
  const base = getColyseusHttpUrl();
  if (!base) throw new Error('Servidor do mundo não configurado.');
  const response = await fetch(`${base.replace(/\/api$/, '')}${path}`);
  if (!response.ok) throw new Error('Não foi possível carregar os dados da estação.');
  return response.json() as Promise<T>;
}

export function StationGamePanel({ stationId, placedId, onClose }: {
  stationId: string;
  /** Estação portátil posicionada (privada) que abriu este card — craft gasta a durabilidade dela. */
  placedId?: string;
  onClose: () => void;
}) {
  const inventory = useCollectionInventoryStore((state) => state.items);
  const placed = usePlacedStationsStore((state) => (placedId ? state.stations[placedId] : undefined));
  const pushNotice = usePlacedStationsStore((state) => state.pushNotice);
  // A estação portátil sumiu (recolhida/expirou) com o card aberto: fecha e avisa.
  const placedGone = !!placedId && !placed;
  useEffect(() => {
    if (!placedGone) return;
    pushNotice('info', 'A estação portátil não está mais no lugar.');
    onClose();
  }, [placedGone, pushNotice, onClose]);
  const applySnapshot = useCollectionInventoryStore((state) => state.applyServerTotals);
  const setInventoryError = useCollectionInventoryStore((state) => state.setInventoryError);
  const [data, setData] = useState<{ stations: StationsPayload; craft: CraftPayload; manifest: Awaited<ReturnType<typeof getGeneratorManifest>> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getPublic<StationsPayload>('/api/craft-stations-data'),
      getPublic<CraftPayload>('/api/craft-data'),
      getGeneratorManifest(),
    ]).then(([stations, craftData, manifest]) => {
      if (!cancelled) setData({ stations, craft: craftData, manifest });
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Falha ao carregar estação.');
    });
    return () => { cancelled = true; };
  }, []);

  const catalog = useMemo(
    () => buildCraftCatalog(data?.manifest ?? null, data?.craft.items ?? {}),
    [data],
  );
  const station = useMemo(() => {
    const source = data?.stations.stations.find((entry) => entry.stationId === stationId);
    if (!source || !data) return null;
    return {
      ...source,
      tabs: source.tabs.map((tabConfig) => ({
        ...tabConfig,
        rows: tabConfig.rows.map((row) =>
          row.filter((itemId) =>
            data.stations.members[itemId] === stationId &&
            !!data.craft.recipes[itemId] &&
            catalog.byId.has(itemId),
          ),
        ).filter((row) => row.length > 0),
      })),
    };
  }, [catalog, data, stationId]);

  if (error) return <CompactNotice text={error} onClose={onClose} />;
  if (!data) return <CompactNotice text="Carregando estação..." onClose={onClose} />;
  if (!station) return <CompactNotice text="Esta estação não está disponível." onClose={onClose} />;

  return (
    <div className="pointer-events-none fixed inset-0 z-[500] grid place-items-center">
      <div className="pointer-events-auto">
        <StationPreview
          station={station}
          activeTabIndex={tab}
          onSelectTab={setTab}
          recipes={data.craft.recipes}
          inventory={inventory}
          resolveItem={(id) => {
            const entry = catalog.byId.get(id);
            return entry ? { name: entry.name, thumb: entry.thumb } : null;
          }}
          onClose={onClose}
          banner={placed ? <PlacedStationBanner station={placed} /> : undefined}
          onCraft={async (targetId, quantity) => {
            try {
              const result = await craft(stationId, targetId, quantity, placedId);
              applySnapshot(result.items);
            } catch (reason) {
              const message = reason instanceof Error ? reason.message : 'Falha ao criar item.';
              setInventoryError(message);
              throw reason;
            }
          }}
        />
      </div>
    </div>
  );
}

function CompactNotice({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[500] grid place-items-center">
      <div className="pointer-events-auto w-72 rounded-lg border-2 border-[#8a5a2b] bg-[#2b1c10] p-4 text-sm text-amber-100 shadow-xl">
        <p>{text}</p>
        <button type="button" onClick={onClose} className="mt-3 text-xs underline">Fechar</button>
      </div>
    </div>
  );
}