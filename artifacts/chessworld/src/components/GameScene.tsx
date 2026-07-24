import { useEffect } from 'react';
import { GameCanvas } from './GameCanvas';
import { HUD } from './ui/HUD';
import { PublicChat } from './chat/PublicChat';
import { PlayerProfile } from './profile/PlayerProfile';
import { BoardModal } from './game/BoardModal';
import { HouseModal } from './game/HouseModal';
import { FriendRequests } from './game/FriendRequests';
import { SettingsModal } from './game/SettingsModal';
import { VoiceChatPanel } from './game/VoiceChatPanel';
import { TableWaitingOverlays } from './game/TableWaitingOverlays';
import { TournamentPanelOverlays } from './game/TournamentPanelOverlays';
import { InteractionDebugModal } from './game/InteractionDebugModal';
import { MatchHUD } from './game/MatchHUD';
import { ChessBoardOverlay } from '../components/chess/ChessBoardOverlay';
import { ProximityButton } from './game/ProximityButton';
import { ZoneIndicator } from './game/ZoneIndicator';
import { useColyseusConnection, useColyseusStore } from '../hooks/useColyseusConnection';
import { leaveWorldRoom } from '../game/network/colyseusClient';
import { Loader2, WifiOff, RefreshCw } from 'lucide-react';

export default function GameScene() {
  useColyseusConnection();
  const { phase, error } = useColyseusStore();

  useEffect(() => {
    const handleBeforeUnload = () => {
      leaveWorldRoom();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  if (phase === 'not_configured') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center px-6">
          <WifiOff className="w-12 h-12 text-amber-400" />
          <h2 className="text-xl font-bold text-white">Server not configured</h2>
          <p className="text-slate-400 max-w-sm">
            VITE_COLYSEUS_URL is not set. Add your Colyseus Cloud URL to the environment secrets and restart the app.
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'connecting') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          <p className="text-slate-400">Connecting to game server…</p>
        </div>
      </div>
    );
  }

  if (phase === 'connection_failed') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center px-6">
          <WifiOff className="w-12 h-12 text-red-400" />
          <h2 className="text-xl font-bold text-white">Could not reach game server</h2>
          <p className="text-slate-400 max-w-sm text-sm">{error || 'Connection refused'}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-900">
      <GameCanvas />
      <HUD />
      <PublicChat />
      <PlayerProfile />
      <BoardModal />
      <HouseModal />
      <FriendRequests />
      <SettingsModal />
      <VoiceChatPanel />
      <InteractionDebugModal />
      <ProximityButton />
      <ZoneIndicator />
      <MatchHUD />
      <ChessBoardOverlay />
      <TableWaitingOverlays />
      <TournamentPanelOverlays />
    </div>
  );
}
