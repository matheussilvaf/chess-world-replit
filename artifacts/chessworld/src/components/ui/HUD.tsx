import { useState, useCallback, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useGameStore } from '../../stores/gameStore';
import { useChessStore } from '../../stores/chessStore';
import { useColyseusStore } from '../../hooks/useColyseusConnection';
import { REGIONS } from '../../config/game';
import { voiceClient } from '../../game/voice/livekitVoiceClient';
import { leaveWorldRoom } from '../../game/network/colyseusClient';
import {
  User, MessageSquare, Users, Settings, DoorOpen, Mic, Maximize, Minimize,
} from 'lucide-react';

export function HUD() {
  const { profile } = useAuthStore();
  const { region, onlinePlayers, unreadChat, toggleChat, toggleProfile, toggleFriends, toggleSettings, toggleVoiceChat } = useGameStore();
  const { phase } = useColyseusStore();
  const matchId = useChessStore(s => s.matchId);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  const regionInfo = REGIONS.find(r => r.id === region);
  const inGame = !!matchId;

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

        {/* Player info badge — hidden in game mode */}
        {!inGame && (
          <div className="pointer-events-auto bg-slate-900/90 backdrop-blur-sm rounded-xl px-4 py-2.5 border border-slate-700/50 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
              <User className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-white font-medium text-sm">{profile?.username}</div>
              <div className="flex items-center gap-2 text-xs">
                <span className="flex items-center gap-0.5 text-amber-400">
                  ★ {profile?.rating}
                </span>
                <span className="flex items-center gap-0.5 text-yellow-400">
                  🏆 {profile?.trophies}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Spacer when badge is hidden */}
        {inGame && <div />}

        {/* Server / region info — hidden in game mode */}
        {!inGame && phase === 'connected' && (
          <div className="pointer-events-auto bg-slate-900/90 backdrop-blur-sm rounded-xl px-4 py-2.5 border border-slate-700/50 hidden sm:flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-white text-sm font-medium">{regionInfo?.name}</span>
            <span className="text-slate-400 text-xs">|</span>
            <span className="text-slate-300 text-xs flex items-center gap-1">
              <Users className="w-3 h-3" /> {onlinePlayers + 1} online
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="pointer-events-auto flex items-center gap-1.5">
          {/* Always visible in game mode: Chat, Voice, Settings, Fullscreen */}
          <HUDButton
            icon={<MessageSquare className="w-4 h-4" />}
            onClick={toggleChat}
            label="Chat"
            badge={unreadChat}
          />
          <HUDButton icon={<Mic className="w-4 h-4" />} onClick={toggleVoiceChat} label="Voice" />
          <HUDButton icon={<Settings className="w-4 h-4" />} onClick={toggleSettings} label="Settings" />
          <HUDButton
            icon={isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            onClick={toggleFullscreen}
            label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          />

          {/* Extra buttons — hidden in game mode */}
          {!inGame && (
            <>
              <HUDButton icon={<User className="w-4 h-4" />} onClick={toggleProfile} label="Profile" />
              <HUDButton icon={<Users className="w-4 h-4" />} onClick={toggleFriends} label="Friends" />
              <HUDButton
                icon={<DoorOpen className="w-4 h-4" />}
                onClick={handleLeaveGame}
                label="Leave Game"
                className="hover:bg-red-500/20 hover:text-red-400"
              />
            </>
          )}
        </div>
      </div>
      {/* Debug panel removed */}
    </div>
  );
}

function HUDButton({
  icon,
  onClick,
  label,
  className = '',
  badge = 0,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  label: string;
  className?: string;
  badge?: number;
}) {
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
