import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useGameStore } from '../../stores/gameStore';
import { useFriendsStore } from '../../stores/friendsStore';
import { useChessStore } from '../../stores/chessStore';
import { useGameSettingsStore } from '../../stores/gameSettingsStore';
import { useColyseusStore } from '../../hooks/useColyseusConnection';
import type { ChatMessage } from '../../types';
import { REGIONS } from '../../config/game';
import { voiceClient } from '../../game/voice/livekitVoiceClient';
import { leaveWorldRoom } from '../../game/network/colyseusClient';
import {
  User, MessageSquare, Users, Settings, DoorOpen, Mic, Maximize, Minimize, TreePine, Castle, Crown, Swords, BookOpen,
  ChevronDown, Backpack,
} from 'lucide-react';
import { isProvisionalRating } from '../../shared/rating/Glicko2';
import { useRatingStore } from '../../stores/ratingStore';
import { CollectionInventoryButton } from '../game/CollectionInventoryPanel';
import { useInventoryUiStore } from '../../stores/inventoryUiStore';
import { useRecipeBookStore } from '../../stores/recipeBookStore';
import { formatCrowns, useWalletStore } from '../../stores/walletStore';

// iPhone Safari has no Fullscreen API for arbitrary elements — hide the button there.
const FULLSCREEN_SUPPORTED =
  typeof document.documentElement.requestFullscreen === 'function' ||
  typeof (document.documentElement as any).webkitRequestFullscreen === 'function';

export function HUD() {
  const { profile, user } = useAuthStore();
  // Rating exibido = Glicko-2 arredondado (o inteiro legado `rating` é o espelho).
  const displayRating = Math.round(profile?.chess_rating ?? profile?.rating ?? 0);
  // Limiares de "provisório" vêm do servidor (config do admin); defaults até chegarem.
  const ratingRules = useRatingStore((s) => s.rules);
  const loadRatingRules = useRatingStore((s) => s.loadRules);
  useEffect(() => { void loadRatingRules(); }, [loadRatingRules]);
  const provisional = !!profile && isProvisionalRating(
    { ratedGamesPlayed: profile.chess_rated_games_played ?? 0, ratingDeviation: profile.chess_rating_deviation ?? ratingRules.initialRatingDeviation },
    ratingRules,
  );
  const crowns = useWalletStore((s) => s.crowns);
  const refreshWallet = useWalletStore((s) => s.refresh);
  const friendsUnseen = useFriendsStore((state) => state.unseenCount);
  const { region, onlinePlayers, unreadChat, liveChatMessage, showChat, toggleChat, toggleProfile, toggleFriends, toggleSettings, toggleVoiceChat, currentWorld, setTravelRequest } = useGameStore();
  const { phase } = useColyseusStore();
  const matchId = useChessStore(s => s.matchId);
  const chatPreviewSeconds = useGameSettingsStore((s) => s.chatPreviewSeconds);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const inventoryOpen = useInventoryUiStore((s) => s.open);
  const toggleInventory = useInventoryUiStore((s) => s.toggleInventory);
  const recipeBookOpen = useRecipeBookStore((s) => s.open);
  const toggleRecipeBook = useRecipeBookStore((s) => s.toggleBook);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!mobileMenuRef.current?.contains(event.target as Node)) setMobileMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [mobileMenuOpen]);

  const regionInfo = REGIONS.find(r => r.id === region);
  const inGame = !!matchId;

  // Saldo de Crowns: a sala empurra `wallet_update` ao entrar/coletar; o GET cobre
  // o caso de o servidor ainda não ter enviado (ou deploys sem a mensagem).
  useEffect(() => {
    if (!user?.id) return;
    void refreshWallet();
  }, [user?.id, refreshWallet]);

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
                <span
                  className="flex items-center gap-0.5 text-amber-400"
                  title={provisional ? 'Rating provisório (poucas partidas avaliadas)' : 'Rating Glicko-2'}
                  data-testid="hud-rating"
                >
                  ★ {displayRating}{provisional ? '?' : ''}
                </span>
                <span
                  className="flex items-center gap-1 text-emerald-300"
                  title="Gambits — ganhos nas partidas, usados no craft"
                  data-testid="hud-gambits"
                >
                  <Swords className="h-3 w-3" /> {profile?.gambits ?? 0}
                </span>
              </div>
            </div>
            {/* Crowns — moeda principal (renda das peças do Big Chess Board) */}
            <div
              className="ml-1 flex items-center gap-1.5 rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-2.5 py-1.5"
              title="Crowns — moeda principal"
              data-testid="hud-crowns"
            >
              <Crown className="h-4 w-4 text-yellow-300" />
              <span className="font-mono text-sm font-bold text-yellow-100">{formatCrowns(crowns)}</span>
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
          <div ref={mobileMenuRef} className="relative flex items-center gap-1.5 md:hidden">
            <HUDButton icon={<Mic className="w-4 h-4" />} onClick={toggleVoiceChat} label="Voz" />
            <button
              type="button"
              aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/50 bg-slate-900/90 text-slate-300 backdrop-blur-sm"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${mobileMenuOpen ? 'rotate-180' : ''}`} />
              {!mobileMenuOpen && (unreadChat > 0 || friendsUnseen > 0) && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />}
            </button>
            {mobileMenuOpen && (
              <div className="absolute right-0 top-full mt-2 flex w-48 flex-col gap-1 rounded-xl border border-slate-700/60 bg-slate-900/95 p-2 shadow-2xl">
                <MobileMenuButton icon={<MessageSquare />} label="Chat" badge={unreadChat} onClick={toggleChat} close={() => setMobileMenuOpen(false)} />
                {!inGame && (
                  <MobileMenuButton
                    icon={currentWorld === 'crafting' ? <Castle /> : <TreePine />}
                    label={currentWorld === 'crafting' ? 'Mundo principal' : 'Mundo de coleta'}
                    onClick={() => setTravelRequest(currentWorld === 'crafting' ? 'main' : 'crafting')}
                    close={() => setMobileMenuOpen(false)}
                  />
                )}
                <MobileMenuButton icon={<Backpack />} label="Inventário" onClick={toggleInventory} close={() => setMobileMenuOpen(false)} />
                <MobileMenuButton icon={<BookOpen />} label="Livro de receitas" onClick={toggleRecipeBook} close={() => setMobileMenuOpen(false)} />
                <MobileMenuButton icon={<Users />} label="Amigos" badge={friendsUnseen} onClick={toggleFriends} close={() => setMobileMenuOpen(false)} />
                <MobileMenuButton icon={<Settings />} label="Configurações" onClick={toggleSettings} close={() => setMobileMenuOpen(false)} />
                {FULLSCREEN_SUPPORTED && (
                  <MobileMenuButton icon={isFullscreen ? <Minimize /> : <Maximize />} label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'} onClick={toggleFullscreen} close={() => setMobileMenuOpen(false)} />
                )}
                {!inGame && (
                  <>
                    <MobileMenuButton icon={<User />} label="Perfil" onClick={toggleProfile} close={() => setMobileMenuOpen(false)} />
                    <MobileMenuButton icon={<DoorOpen />} label="Sair do jogo" onClick={() => { void handleLeaveGame(); }} close={() => setMobileMenuOpen(false)} />
                  </>
                )}
              </div>
            )}
          </div>
          <div className="hidden items-center gap-1.5 md:flex">
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
          <CollectionInventoryButton onClick={toggleInventory} active={inventoryOpen} />
          <button
            type="button"
            onClick={toggleRecipeBook}
            title="Livro de Receitas"
            aria-pressed={recipeBookOpen}
            data-testid="hud-recipe-book"
            className={`relative flex h-9 w-9 items-center justify-center rounded-lg border transition-all sm:h-10 sm:w-10 ${
              recipeBookOpen
                ? 'border-amber-400/70 bg-[#3b2411] text-amber-100'
                : 'border-slate-700/50 bg-slate-900/90 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <BookOpen className="h-4 w-4" />
          </button>
          <HUDButton icon={<Mic className="w-4 h-4" />} onClick={toggleVoiceChat} label="Voice" />
          <HUDButton icon={<Settings className="w-4 h-4" />} onClick={toggleSettings} label="Settings" />
          {FULLSCREEN_SUPPORTED && (
            <HUDButton
              icon={isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              onClick={toggleFullscreen}
              label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            />
          )}

          <HUDButton icon={<Users className="w-4 h-4" />} onClick={toggleFriends} label="Amigos" badge={friendsUnseen} />

          {/* Extra buttons — hidden in game mode */}
          {!inGame && (
            <>
              <HUDButton icon={<User className="w-4 h-4" />} onClick={toggleProfile} label="Profile" />
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
      </div>
    </div>
  );
}

function MobileMenuButton({
  icon, label, onClick, close, badge = 0,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  close: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={() => { onClick(); close(); }}
      className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-slate-200 hover:bg-slate-800"
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {badge > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{badge > 9 ? '9+' : badge}</span>}
    </button>
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
