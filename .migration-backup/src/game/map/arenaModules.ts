import type { TournamentState } from '../../hooks/useTournamentRoom';

export interface ModuleLayout {
  instanceId: string;
  type: 'double' | 'single' | 'end';
  order: number;
  mapKey: string;
  offsetX: number;
  offsetY: number;
}

export interface ConnectorData {
  x: number;
  y: number;
}

const MODULE_MAP_KEYS = {
  double: 'tournament_table_module_double',
  single: 'tournament_table_module_single',
  end: 'tournament_table_module_end',
};

const CONNECTOR_NAMES: Record<string, { south: string; north?: string }> = {
  double: { south: 'double_module_south_connector', north: 'double_module_north_connector' },
  single: { south: 'single_module_south_connector', north: 'single_module_north_connector' },
  end: { south: 'end_module_south_connector' },
};

export function getModuleMapKey(type: string): string {
  return MODULE_MAP_KEYS[type as keyof typeof MODULE_MAP_KEYS] || type;
}

export function getConnectorNames(type: string): { south: string; north?: string } {
  return CONNECTOR_NAMES[type as keyof typeof CONNECTOR_NAMES] || { south: '' };
}

export function findConnectorInMap(mapData: any, connectorName: string): ConnectorData | null {
  if (!mapData?.layers) return null;

  for (const layer of mapData.layers) {
    if (layer.type === 'objectgroup' && layer.objects) {
      for (const obj of layer.objects) {
        if (obj.name === connectorName && obj.point) {
          return { x: obj.x, y: obj.y };
        }
      }
    }
  }
  return null;
}

export function computeModulePositions(
  modules: TournamentState['modules'],
  receptionMapData: any,
  moduleMapDataMap: Map<string, any>,
): ModuleLayout[] {
  if (!modules.length || !receptionMapData) return [];

  const receptionConnector = findConnectorInMap(receptionMapData, 'reception_north_connector');
  if (!receptionConnector) {
    console.warn('[ArenaModules] reception_north_connector not found');
    return [];
  }

  const sorted = [...modules].sort((a, b) => a.order - b.order);
  const result: ModuleLayout[] = [];

  let previousNorthConnectorGlobal = { x: receptionConnector.x, y: receptionConnector.y };

  for (const mod of sorted) {
    const mapKey = getModuleMapKey(mod.moduleType);
    const mapData = moduleMapDataMap.get(mapKey);
    if (!mapData) {
      console.warn(`[ArenaModules] Map data not found for ${mapKey}`);
      continue;
    }

    const connectors = getConnectorNames(mod.moduleType);
    const southConnector = findConnectorInMap(mapData, connectors.south);
    if (!southConnector) {
      console.warn(`[ArenaModules] ${connectors.south} not found in ${mapKey}`);
      continue;
    }

    const offsetX = previousNorthConnectorGlobal.x - southConnector.x;
    const offsetY = previousNorthConnectorGlobal.y - southConnector.y;

    result.push({
      instanceId: mod.instanceId,
      type: mod.moduleType as 'double' | 'single' | 'end',
      order: mod.order,
      mapKey,
      offsetX,
      offsetY,
    });

    if (connectors.north) {
      const northConnector = findConnectorInMap(mapData, connectors.north);
      if (northConnector) {
        previousNorthConnectorGlobal = {
          x: northConnector.x + offsetX,
          y: northConnector.y + offsetY,
        };
      }
    }
  }

  return result;
}

export function computeArenaBounds(
  receptionMapData: any,
  moduleLayouts: ModuleLayout[],
  moduleMapDataMap: Map<string, any>,
): { width: number; height: number; minX: number; minY: number } {
  let minX = 0;
  let minY = 0;
  let maxX = receptionMapData?.width * (receptionMapData?.tilewidth || 16) || 800;
  let maxY = receptionMapData?.height * (receptionMapData?.tileheight || 16) || 600;

  for (const layout of moduleLayouts) {
    const mapData = moduleMapDataMap.get(layout.mapKey);
    if (!mapData) continue;

    const modWidth = mapData.width * (mapData.tilewidth || 16);
    const modHeight = mapData.height * (mapData.tileheight || 16);

    minX = Math.min(minX, layout.offsetX);
    minY = Math.min(minY, layout.offsetY);
    maxX = Math.max(maxX, layout.offsetX + modWidth);
    maxY = Math.max(maxY, layout.offsetY + modHeight);
  }

  return {
    width: maxX - minX,
    height: maxY - minY,
    minX,
    minY,
  };
}
