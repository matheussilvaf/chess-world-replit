import { useState, useCallback, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useGameStore } from '../../stores/gameStore';
import { useChessStore } from '../../stores/chessStore';
import { useColyseusStore, type ColyseusPhase } from '../../hooks/useColyseusConnection';
import { REGIONS } from '../../config/game';
import { voiceClient } from '../../game/voice/livekitVoiceClient';
import { leaveWorldRoom } from '../../game/network/colyseusClient';
import {
  User, MessageSquare, Users, Settings, Trophy, Star, DoorOpen, Mic, Maximize, Minimize,
} from 'lucide-react';

function getPhaseDisplay(phase: ColyseusPhase): { label: string; color: string; dotColor: string; animate: boolean } {
  switch (phase) {
    case 'not_configured':
      return { label: 'not configured', color: 'text-slate-400', dotColor: 'bg-slate-400', animate: false };
    case 'idle':
      return { label: 'idle', color: 'text-slate-400', dotColor: 'bg-slate-400', animate: false };
    case 'connecting':
      return { label: 'connecting', color: 'text-amber-400', dotColor: 'bg-amber-400', animate: true };
    case 'connected':
      return { label: 'connected', color: 'text-emerald-400', dotColor: 'bg-emerald-400', animate: false };
    case 'connection_failed':
      return { label: 'connection failed', color: 'text-red-400', dotColor: 'bg-red-400', animate: false };
    default:
      return { label: 'unknown', color: 'text-slate-400', dotColor: 'bg-slate-400', animate: false };
  }
}

export function HUD() {
  const { profile } = useAuthStore();
  const { region, onlinePlayers, unreadChat, toggleChat, toggleProfile, toggleFriends, toggleSettings, toggleVoiceChat, colyseusBoards, lastEvent } = useGameStore();
  const { phase, sessionId, roomId } = useColyseusStore();
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  const regionInfo = REGIONS.find(r => r.id === region);
  const display = getPhaseDisplay(phase);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleLeaveGame = useCallback(async () => {
    const chessState = useChessStore.getState();
    if (chessState.matchId && !chessState.gameOver && !chessState.isSpectating) {
      chessState.resign();
    }
    chessState.reset();

    if (voiceClient.status === 'connected') {
      await voiceClient.leave();
    }

    await leaveWorldRoom();
    useColyseusStore.getState().reset();
    useGameStore.setState({ region: null });
  }, []);

  return (
    <div className="absolute top-0 left-0 right-0 z-40 pointer-events-none">
      {/* Top bar */}
      <div className="flex items-center justify-between p-3 sm:p-4">
        {/* Player info */}
        <div className="pointer-events-auto bg-slate-900/90 backdrop-blur-sm rounded-xl px-4 py-2.5 border border-slate-700/50 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-white font-medium text-sm">{profile?.username}</div>
            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-0.5 text-amber-400">
                <Star className="w-3 h-3" /> {profile?.rating}
              </span>
              <span className="flex items-center gap-0.5 text-yellow-400">
                <Trophy className="w-3 h-3" /> {profile?.trophies}
              </span>
            </div>
          </div>
        </div>

        {/* Server info */}
        <div className="pointer-events-auto bg-slate-900/90 backdrop-blur-sm rounded-xl px-4 py-2.5 border border-slate-700/50 hidden sm:flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-white text-sm font-medium">{regionInfo?.name}</span>
          <span className="text-slate-400 text-xs">|</span>
          <span className="text-slate-300 text-xs flex items-center gap-1">
            <Users className="w-3 h-3" /> {onlinePlayers + 1} online
          </span>
        </div>

        {/* Action buttons */}
        <div className="pointer-events-auto flex items-center gap-1.5">
          <HUDButton icon={<MessageSquare className="w-4 h-4" />} onClick={toggleChat} label="Chat" badge={unreadChat} />
          <HUDButton icon={<User className="w-4 h-4" />} onClick={toggleProfile} label="Profile" />
          <HUDButton icon={<Users className="w-4 h-4" />} onClick={toggleFriends} label="Friends" />
          <HUDButton icon={<Mic className="w-4 h-4" />} onClick={toggleVoiceChat} label="Voice" />
          <HUDButton icon={<Settings className="w-4 h-4" />} onClick={toggleSettings} label="Settings" />
          <HUDButton
            icon={isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            onClick={toggleFullscreen}
            label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            className="sm:hidden"
          />
          <HUDButton icon={<DoorOpen className="w-4 h-4" />} onClick={handleLeaveGame} label="Leave Game" className="hover:bg-red-500/20 hover:text-red-400" />
        </div>
      </div>

      {/* Colyseus debug panel */}
      <div className="absolute bottom-4 left-4 pointer-events-auto">
        <div className="bg-slate-900/90 backdrop-blur-sm rounded-lg px-3 py-2 border border-slate-700/50 space-y-1">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${display.dotColor} ${display.animate ? 'animate-pulse' : ''}`} />
            <span className={`text-xs font-mono ${display.color}`}>
              Colyseus: {display.label}
            </span>
          </div>
          {phase === 'connected' && (
            <>
              <div className="text-xs font-mono text-slate-500">
                room: {roomId?.slice(0, 8)} | session: {sessionId?.slice(0, 8)}
              </div>
              <div className="text-xs font-mono text-slate-400">
                players: {onlinePlayers + 1} | boards: {colyseusBoards.length}
              </div>
              {lastEvent && (
                <div className={`text-xs font-mono truncate max-w-[200px] ${lastEvent.includes('invalid') ? 'text-red-400' : 'text-cyan-400'}`}>
                  {lastEvent}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function HUDButton({ icon, onClick, label, className = '', badge = 0 }: { icon: React.ReactNode; onClick: () => void; label: string; className?: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`relative w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-slate-900/90 backdrop-blur-sm border border-slate-700/50 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-all ${className}`}
    >
      {icon}
      {badge > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow-lg">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}
