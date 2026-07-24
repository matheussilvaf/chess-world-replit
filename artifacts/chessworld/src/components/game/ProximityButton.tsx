import { DoorOpen, Building2, Compass, BarChart3, Landmark } from 'lucide-react';
import { useInteractionStore } from '../../stores/interactionStore';

const CATEGORY_ICONS: Record<string, typeof DoorOpen> = {
  house: DoorOpen,
  building: Building2,
  portal: Compass,
  village_gateway: Landmark,
  stats_board: BarChart3,
};

const CATEGORY_ACTIONS: Record<string, string> = {
  house: 'Enter',
  building: 'Enter',
  portal: 'Use Portal',
  village_gateway: 'Travel',
  stats_board: 'View Stats',
};

export function ProximityButton() {
  const { proximityObject, debugEnabled, confirmAction } = useInteractionStore();

  if (!proximityObject || !debugEnabled) return null;

  const Icon = CATEGORY_ICONS[proximityObject.category] || Building2;
  const actionLabel = CATEGORY_ACTIONS[proximityObject.category] || 'Interact';
  const displayName =
    (proximityObject.properties.buildingId as string) ||
    (proximityObject.properties.houseId as string) ||
    (proximityObject.properties.portalId as string) ||
    (proximityObject.properties.villageId as string) ||
    proximityObject.name;

  const handleClick = () => {
    if (confirmAction) {
      confirmAction();
    }
  };

  return (
    <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[900] animate-fade-in-up">
      <button
        onClick={handleClick}
        className="flex items-center gap-2.5 px-5 py-2.5 bg-slate-900/95 backdrop-blur-sm border border-slate-600 rounded-full shadow-xl hover:bg-slate-800 hover:border-slate-500 transition-all group"
      >
        <Icon className="w-4 h-4 text-cyan-400 group-hover:text-cyan-300" />
        <div className="flex flex-col items-start">
          <span className="text-xs text-slate-400 leading-none">{formatName(displayName)}</span>
          <span className="text-sm font-medium text-white leading-tight">{actionLabel}</span>
        </div>
        <kbd className="ml-2 px-1.5 py-0.5 text-[10px] font-mono bg-slate-700 text-slate-300 rounded border border-slate-600">
          E
        </kbd>
      </button>
    </div>
  );
}

function formatName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
