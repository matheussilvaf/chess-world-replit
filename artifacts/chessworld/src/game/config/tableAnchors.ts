export interface SeatAnchor {
  x: number;
  y: number;
  direction: string;
}

export interface OverlayArea {
  x: number;
  y: number;
  width: number;
  height: number;
  boardFiles: number;
  boardRanks: number;
}

export interface CameraFocus {
  x: number;
  y: number;
  width: number;
  height: number;
  padding: number;
}

export interface TableAnchors {
  tableId: string;
  playerTop: SeatAnchor;
  playerBottom: SeatAnchor;
  spectatorLeft01: SeatAnchor;
  spectatorLeft02: SeatAnchor;
  spectatorRight01: SeatAnchor;
  spectatorRight02: SeatAnchor;
  exitTop: SeatAnchor;
  exitBottom: SeatAnchor;
  exitLeft: SeatAnchor;
  exitRight: SeatAnchor;
  cameraFocus: CameraFocus | null;
  overlayArea: OverlayArea | null;
}

export interface TableRegistry {
  tables: Map<string, TableAnchors>;
}

export function loadTableRegistry(tmjData: any): TableRegistry {
  const characterAnchorsLayer = findObjectLayer(tmjData.layers, 'character_anchors');
  const cameraAnchorsLayer = findObjectLayer(tmjData.layers, 'camera_anchors');
  const uiAnchorsLayer = findObjectLayer(tmjData.layers, 'ui_anchors');

  const tables = new Map<string, TableAnchors>();

  // Group character anchors by tableId
  const byTable = new Map<string, any[]>();
  if (characterAnchorsLayer) {
    for (const obj of characterAnchorsLayer) {
      const props = getProps(obj);
      const tableId = props.tableId as string;
      if (!tableId) continue;
      if (!byTable.has(tableId)) byTable.set(tableId, []);
      byTable.get(tableId)!.push({ ...obj, props });
    }
  }

  // Load camera focus areas from both camera_anchors and ui_anchors
  const cameraByTable = new Map<string, CameraFocus>();
  if (cameraAnchorsLayer) {
    for (const obj of cameraAnchorsLayer) {
      const props = getProps(obj);
      const tableId = props.tableId as string;
      if (!tableId) continue;
      cameraByTable.set(tableId, {
        x: obj.x, y: obj.y,
        width: obj.width || 150, height: obj.height || 150,
        padding: parseInt(props.padding as string) || 32,
      });
    }
  }
  // ui_anchors camera focus areas (tables 3-14)
  if (uiAnchorsLayer) {
    for (const obj of uiAnchorsLayer) {
      const props = getProps(obj);
      const tableId = props.tableId as string;
      if (!tableId) continue;
      if (props.anchorType === 'camera_focus' && !cameraByTable.has(tableId)) {
        cameraByTable.set(tableId, {
          x: obj.x, y: obj.y,
          width: obj.width || 150, height: obj.height || 150,
          padding: parseInt(props.padding as string) || 32,
        });
      }
    }
  }

  // Load overlay areas from ui_anchors
  const overlayByTable = new Map<string, OverlayArea>();
  if (uiAnchorsLayer) {
    for (const obj of uiAnchorsLayer) {
      const props = getProps(obj);
      const tableId = props.tableId as string;
      if (!tableId) continue;
      if (props.anchorType === 'chess_board_overlay') {
        overlayByTable.set(tableId, {
          x: obj.x, y: obj.y,
          width: obj.width || 128, height: obj.height || 128,
          boardFiles: (props.boardFiles as number) || 8,
          boardRanks: (props.boardRanks as number) || 8,
        });
      }
    }
  }

  // Build table entries
  for (const [tableId, anchors] of byTable) {
    const find = (anchorType: string, role: string, position?: string, side?: string, seatIndex?: string): SeatAnchor => {
      const match = anchors.find(a =>
        a.props.anchorType === anchorType &&
        a.props.role === role &&
        (position === undefined || a.props.position === position) &&
        (side === undefined || a.props.side === side) &&
        (seatIndex === undefined || a.props.seatIndex === seatIndex)
      );
      if (match) return { x: match.x, y: match.y, direction: match.props.direction || 'down' };
      return { x: 0, y: 0, direction: 'down' };
    };

    tables.set(tableId, {
      tableId,
      playerTop: find('chess_seat', 'player', 'top'),
      playerBottom: find('chess_seat', 'player', 'bottom'),
      spectatorLeft01: find('chess_seat', 'spectator', undefined, 'left', '1'),
      spectatorLeft02: find('chess_seat', 'spectator', undefined, 'left', '2'),
      spectatorRight01: find('chess_seat', 'spectator', undefined, 'right', '1'),
      spectatorRight02: find('chess_seat', 'spectator', undefined, 'right', '2'),
      exitTop: find('chess_seat_exit', 'player', undefined, 'top'),
      exitBottom: find('chess_seat_exit', 'player', undefined, 'bottom'),
      exitLeft: find('chess_seat_exit', 'spectator', undefined, 'left'),
      exitRight: find('chess_seat_exit', 'spectator', undefined, 'right'),
      cameraFocus: cameraByTable.get(tableId) || null,
      overlayArea: overlayByTable.get(tableId) || null,
    });
  }

  return { tables };
}

export function getSeatAnchor(
  anchors: TableAnchors,
  role: 'player' | 'spectator',
  seat: string
): SeatAnchor {
  if (role === 'player') {
    return seat === 'top' ? anchors.playerTop : anchors.playerBottom;
  }
  switch (seat) {
    case 'left_01': return anchors.spectatorLeft01;
    case 'left_02': return anchors.spectatorLeft02;
    case 'right_01': return anchors.spectatorRight01;
    case 'right_02': return anchors.spectatorRight02;
    default: return anchors.spectatorLeft01;
  }
}

export function getExitAnchor(
  anchors: TableAnchors,
  role: 'player' | 'spectator',
  seat: string
): SeatAnchor {
  if (role === 'player') {
    return seat === 'top' ? anchors.exitTop : anchors.exitBottom;
  }
  return seat.startsWith('left') ? anchors.exitLeft : anchors.exitRight;
}

function findObjectLayer(layers: any[], name: string): any[] | null {
  for (const l of layers) {
    if (l.type === 'group') {
      const found = findObjectLayer(l.layers || [], name);
      if (found) return found;
    } else if (l.type === 'objectgroup' && l.name === name) {
      return l.objects || [];
    }
  }
  return null;
}

function getProps(obj: any): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const p of obj.properties || []) {
    result[p.name] = p.value;
  }
  return result;
}
