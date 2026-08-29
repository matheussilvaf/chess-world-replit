import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useGameStore } from '../../stores/gameStore';
import { useChessStore } from '../../stores/chessStore';
import { useGameSettingsStore } from '../../stores/gameSettingsStore';
import { useColyseusStore } from '../../hooks/useColyseusConnection';
import type { ChatMessage } from '../../types';
import { REGIONS } from '../../config/game';
import { voiceClient } from '../../game/voice/livekitVoiceClient';
import { leaveWorldRoom } from '../../game/network/colyseusClient';
import {
  User, MessageSquare, Users, Settings, DoorOpen, Mic, Maximize, Minimize, TreePine, Castle,
} from 'lucide-react';

// iPhone Safari has no Fullscreen API for arbitrary elements — hide the button there.
const FULLSCREEN_SUPPORTED =
  typeof document.documentElement.requestFullscreen === 'function' ||
  typeof (document.documentElement as any).webkitRequestFullscreen === 'function';

export function HUD() {
  const { profile } = useAuthStore();
  const { region, onlinePlayers, unreadChat, liveChatMessage, showChat, toggleChat, toggleProfile, toggleFriends, toggleSettings, toggleVoiceChat, currentWorld, setTravelRequest } = useGameStore();
  const { phase } = useColyseusStore();
  const matchId = useChessStore(s => s.matchId);
  const chatPreviewSeconds = useGameSettingsStore((s) => s.chatPreviewSeconds);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  const regionInfo = REGIONS.find(r => r.id === region);
  const inGame = !!matchId;

  // New-message preview balloon under the chat icon (auto-hides; admin-tunable).
  // Only liveChatMessage triggers it — the store sets that field exclusively on
  // live room/realtime messages, never on history loads (loadChat), so region
  // switches or reconnects can't fire ghost previews of old messages.
  const [chatPreview, setChatPreview] = useState<ChatMessage | null>(null);
  const seenLiveRef = useRef<ChatMessage | null>(useGameStore.getState().liveChatMessage);

  useEffect(() => {
    if (!liveChatMessage || liveChatMessage === seenLiveRef.current) return;
    seenLiveRef.current = liveChatMessage;
    if (useGameStore.getState().showChat) return; // chat open — the panel already shows it
    setChatPreview(liveChatMessage);
  }, [liveChatMessage]);

  useEffect(() => {
    if (!chatPreview) return;
    const seconds = Math.min(10, Math.max(2, chatPreviewSeconds));
    const t = window.setTimeout(() => setChatPreview(null), seconds * 1000);
    return () => window.clearTimeout(t);
  }, [chatPreview, chatPreviewSeconds]);

  useEffect(() => {
    if (showChat) setChatPreview(null);
  }, [showChat]);

  useEffect(() => {
    const handler = () =>
      setIsFullscreen(!!document.fullscreenElement || !!(document as any).webkitFullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    // iPhone Safari has no Fullscreen API for arbitrary elements — guard so
    // tapping the button never throws (button is hidden there anyway).
    const doc = document as any;
    const el = document.documentElement as any;
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      (document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document);
    } else if (typeof el.requestFullscreen === 'function') {
      el.requestFullscreen().catch(() => {});
    } else if (typeof el.webkitRequestFullscreen === 'function') {
      el.webkitRequestFullscreen();
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
          <div className="relative">
            <HUDButton
              icon={<MessageSquare className="w-4 h-4" />}
              onClick={toggleChat}
              label="Chat"
              badge={unreadChat}
            />
            {chatPreview && (
              <button
                key={chatPreview.id}
                onClick={() => { setChatPreview(null); toggleChat(); }}
                className={[
                  // Base
                  'absolute top-full mt-2 border border-slate-700/60 bg-slate-900/95 backdrop-blur-sm px-3 py-2 text-left shadow-2xl rounded-xl',
                  // Mobile: anchor left edge → balloon grows to the right; narrow
                  'left-0 w-40 max-w-[55vw] rounded-tl-sm',
                  // Desktop: anchor right edge → balloon grows to the left; wider
                  'sm:left-auto sm:right-0 sm:w-60 sm:max-w-[72vw] sm:rounded-tl-xl sm:rounded-tl-none sm:rounded-tr-sm',
                ].join(' ')}
                style={{ animation: 'chat-preview-in 0.18s ease-out' }}
              >
                {/* Caret — mobile: top-left of balloon; desktop: top-right */}
                <span className="absolute -top-[5px] left-4 sm:left-auto sm:right-4 h-2.5 w-2.5 rotate-45 border-l border-t border-slate-700/60 bg-slate-900" />
                <span className="block truncate text-[11px] font-semibold text-emerald-400">{chatPreview.username}</span>
                <span className="block break-words text-xs leading-snug text-white/90 line-clamp-2">
                  {chatPreview.message.length > 80
                    ? `${chatPreview.message.slice(0, 80).trimEnd()}...`
                    : chatPreview.message}
                </span>
              </button>
            )}
          </div>
          {!inGame && (
            <HUDButton
              icon={currentWorld === 'crafting' ? <Castle className="w-4 h-4" /> : <TreePine className="w-4 h-4" />}
              onClick={() => setTravelRequest(currentWorld === 'crafting' ? 'main' : 'crafting')}
              label={currentWorld === 'crafting' ? 'Voltar ao Mundo Principal' : 'Mundo de Coleta (dev)'}
            />
          )}
          <HUDButton icon={<Mic className="w-4 h-4" />} onClick={toggleVoiceChat} label="Voice" />
          <HUDButton icon={<Settings className="w-4 h-4" />} onClick={toggleSettings} label="Settings" />
          {FULLSCREEN_SUPPORTED && (
            <HUDButton
              icon={isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              onClick={toggleFullscreen}
              label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            />
          )}

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
