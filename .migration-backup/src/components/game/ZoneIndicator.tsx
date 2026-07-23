import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useInteractionStore } from '../../stores/interactionStore';

export function ZoneIndicator() {
  const { zoneNotification, debugEnabled, clearZoneNotification } = useInteractionStore();
  const [visible, setVisible] = useState(false);
  const [displayData, setDisplayData] = useState<{ zoneName: string; zoneType: string; entered: boolean } | null>(null);

  useEffect(() => {
    if (!zoneNotification || !debugEnabled) return;

    setDisplayData(zoneNotification);
    setVisible(true);

    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => {
        clearZoneNotification();
      }, 300);
    }, 2500);

    return () => clearTimeout(timer);
  }, [zoneNotification, debugEnabled, clearZoneNotification]);

  if (!displayData || !debugEnabled) return null;

  return (
    <div
      className={`fixed top-20 left-1/2 -translate-x-1/2 z-[800] transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
    >
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/90 backdrop-blur-sm border border-slate-700 rounded-lg shadow-lg">
        <MapPin className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-xs text-slate-300">
          {displayData.entered ? 'Entering' : 'Leaving'}:
        </span>
        <span className="text-xs font-medium text-white">
          {formatZoneName(displayData.zoneName)}
        </span>
        <span className="text-[10px] text-slate-500 font-mono">
          ({displayData.zoneType})
        </span>
      </div>
    </div>
  );
}

function formatZoneName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
