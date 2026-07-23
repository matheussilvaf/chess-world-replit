import { X, Bug } from 'lucide-react';
import { useInteractionStore } from '../../stores/interactionStore';

const CATEGORY_LABELS: Record<string, string> = {
  chess_table: 'Chess Table',
  player_seat: 'Player Seat',
  spectator_seat: 'Spectator Seat',
  house: 'House Entrance',
  building: 'Building Entrance',
  portal: 'Portal',
  village_gateway: 'Village Gateway',
  stats_board: 'Stats Board',
};

const CATEGORY_MESSAGES: Record<string, string> = {
  chess_table: 'Interaction recognized. Awaiting match implementation.',
  player_seat: 'Interaction recognized. Awaiting match implementation.',
  spectator_seat: 'Spectator interaction recognized.',
  house: 'House entrance recognized. Awaiting implementation.',
  building: 'Building entrance recognized. Awaiting implementation.',
  portal: 'Portal interaction recognized. Awaiting implementation.',
  village_gateway: 'Village gateway recognized. Awaiting implementation.',
  stats_board: 'Stats board interaction recognized. Awaiting implementation.',
};

export function InteractionDebugModal() {
  const { modalData, closeModal } = useInteractionStore();
  if (!modalData) return null;

  const { object, playerDistance } = modalData;
  const props = object.properties;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-slate-800/80 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Bug className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-white">Debug: Interaction</span>
          </div>
          <button
            onClick={closeModal}
            className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Category badge */}
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              {CATEGORY_LABELS[object.category] || object.category}
            </span>
            <span className="text-xs text-slate-500">ID: {object.id}</span>
          </div>

          {/* Properties table */}
          <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 overflow-hidden">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-700/50">
                <Row label="Object Name" value={object.name} />
                <Row label="Category" value={object.category} />
                <Row label="Trigger Mode" value={object.triggerMode} />
                <Row label="Distance" value={`${Math.round(playerDistance)}px`} />
                {props.tableId && <Row label="Table ID" value={String(props.tableId)} />}
                {props.interaction && <Row label="Element" value={String(props.interaction)} />}
                {props.position && <Row label="Position" value={String(props.position)} />}
                {props.houseId && <Row label="House ID" value={String(props.houseId)} />}
                {props.villageId && <Row label="Village ID" value={String(props.villageId)} />}
                {props.buildingId && <Row label="Building ID" value={String(props.buildingId)} />}
                {props.portalId && <Row label="Portal ID" value={String(props.portalId)} />}
                {props.targetMap && <Row label="Target Map" value={String(props.targetMap)} />}
                {props.targetSpawn && <Row label="Target Spawn" value={String(props.targetSpawn)} />}
                {props.objectId && <Row label="Object ID" value={String(props.objectId)} />}
                {props.action && <Row label="Action" value={String(props.action)} />}
              </tbody>
            </table>
          </div>

          {/* Message */}
          <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <p className="text-xs text-amber-200/90">
              {CATEGORY_MESSAGES[object.category] || 'Interaction recognized.'}
            </p>
          </div>

          {/* Coordinates */}
          <div className="flex gap-4 text-xs text-slate-500">
            <span>x: {Math.round(object.x)}, y: {Math.round(object.y)}</span>
            <span>size: {object.width}x{object.height}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-800/40 border-t border-slate-700 flex justify-end">
          <button
            onClick={closeModal}
            className="px-4 py-1.5 text-sm font-medium bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="px-3 py-1.5 text-slate-400 font-medium whitespace-nowrap">{label}</td>
      <td className="px-3 py-1.5 text-white font-mono text-xs">{value}</td>
    </tr>
  );
}
