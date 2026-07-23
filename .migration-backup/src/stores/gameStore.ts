import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { sendChat as colyseusSendChat } from '../game/network/colyseusClient';
import type { Board, House, PlayerPresence, Match, ChatMessage } from '../types';
import type { Region } from '../config/game';
import { GAME_CONFIG } from '../config/game';

interface ColyseusBoardInfo {
  id: string;
  name: string;
  status: string;
  waitingPlayerId: string;
  waitingPlayerName: string;
  timeCategory: string;
  baseMinutes: number;
  incrementSeconds: number;
  timeLabel: string;
  matchId: string;
}

interface MatchStartedInfo {
  matchId: string;
  boardId: string;
  color: 'w' | 'b';
}

interface GameState {
  region: Region | null;
  playerPosition: { x: number; y: number };
  targetPosition: { x: number; y: number } | null;
  otherPlayers: (PlayerPresence & { username?: string; rating?: number })[];
  boards: Board[];
  houses: House[];
  currentMatch: Match | null;
  chatMessages: ChatMessage[];
  onlinePlayers: number;
  selectedBoard: Board | null;
  selectedHouse: House | null;
  showChat: boolean;
  showProfile: boolean;
  showFriends: boolean;
  showSettings: boolean;
  showVoiceChat: boolean;
  boardLocked: boolean;
  unreadChat: number;
  colyseusBoards: ColyseusBoardInfo[];
  matchStartedInfo: MatchStartedInfo | null;
  challengeColor: 'w' | 'b' | null;
  lastEvent: string;

  setRegion: (region: Region) => void;
  setPlayerPosition: (pos: { x: number; y: number }) => void;
  setTargetPosition: (pos: { x: number; y: number } | null) => void;
  setOtherPlayers: (players: (PlayerPresence & { username?: string; rating?: number })[]) => void;
  setBoards: (boards: Board[]) => void;
  setHouses: (houses: House[]) => void;
  setCurrentMatch: (match: Match | null) => void;
  setChatMessages: (msgs: ChatMessage[]) => void;
  addChatMessage: (msg: ChatMessage) => void;
  setOnlinePlayers: (count: number) => void;
  setSelectedBoard: (board: Board | null) => void;
  setSelectedHouse: (house: House | null) => void;
  setBoardLocked: (locked: boolean) => void;
  setColyseusBoards: (boards: ColyseusBoardInfo[]) => void;
  setMatchStartedInfo: (info: MatchStartedInfo | null) => void;
  setChallengeColor: (color: 'w' | 'b' | null) => void;
  setLastEvent: (event: string) => void;
  toggleChat: () => void;
  toggleProfile: () => void;
  toggleFriends: () => void;
  toggleSettings: () => void;
  toggleVoiceChat: () => void;

  enterRegion: (region: Region, userId: string) => Promise<void>;
  updatePosition: (x: number, y: number, userId: string) => Promise<void>;
  loadBoards: (region: Region) => Promise<void>;
  loadHouses: (region: Region) => Promise<void>;
  loadChat: (region: Region) => Promise<void>;
  sendChat: (message: string, userId: string, username: string) => Promise<void>;
}

export const useGameStore = create<GameState>((set, get) => ({
  region: null,
  playerPosition: { x: GAME_CONFIG.WORLD_WIDTH / 2, y: GAME_CONFIG.WORLD_HEIGHT / 2 },
  targetPosition: null,
  otherPlayers: [],
  boards: [],
  houses: [],
  currentMatch: null,
  chatMessages: [],
  onlinePlayers: 0,
  selectedBoard: null,
  selectedHouse: null,
  showChat: false,
  showProfile: false,
  showFriends: false,
  showSettings: false,
  showVoiceChat: false,
  boardLocked: false,
  unreadChat: 0,
  colyseusBoards: [],
  matchStartedInfo: null,
  challengeColor: null,
  lastEvent: '',

  setRegion: (region) => set({ region }),
  setPlayerPosition: (pos) => set({ playerPosition: pos }),
  setTargetPosition: (pos) => set({ targetPosition: pos }),
  setOtherPlayers: (players) => set({ otherPlayers: players, onlinePlayers: players.length }),
  setBoards: (boards) => set({ boards }),
  setHouses: (houses) => set({ houses }),
  setCurrentMatch: (match) => set({ currentMatch: match }),
  setChatMessages: (msgs) => set({ chatMessages: msgs }),
  addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages.slice(-99), msg], unreadChat: s.showChat ? 0 : s.unreadChat + 1 })),
  setOnlinePlayers: (count) => set({ onlinePlayers: count }),
  setSelectedBoard: (board) => set({ selectedBoard: board }),
  setSelectedHouse: (house) => set({ selectedHouse: house }),
  setBoardLocked: (locked) => set({ boardLocked: locked }),
  setColyseusBoards: (boards) => set({ colyseusBoards: boards }),
  setMatchStartedInfo: (info) => set({ matchStartedInfo: info, lastEvent: info ? `Match started: ${info.matchId.slice(0, 8)}` : '' }),
  setChallengeColor: (color) => set({ challengeColor: color }),
  setLastEvent: (event) => set({ lastEvent: event }),
  toggleChat: () => set((s) => ({ showChat: !s.showChat, unreadChat: !s.showChat ? 0 : s.unreadChat })),
  toggleProfile: () => set((s) => ({ showProfile: !s.showProfile })),
  toggleFriends: () => set((s) => ({ showFriends: !s.showFriends })),
  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
  toggleVoiceChat: () => set((s) => ({ showVoiceChat: !s.showVoiceChat })),

  enterRegion: async (region, userId) => {
    const spawnX = GAME_CONFIG.WORLD_WIDTH / 2;
    const spawnY = GAME_CONFIG.WORLD_HEIGHT / 2;

    await supabase.from('player_presence').upsert({
      user_id: userId,
      region,
      x: spawnX,
      y: spawnY,
      status: 'online',
    }, { onConflict: 'user_id' });

    await supabase.from('profiles').update({ current_region: region }).eq('user_id', userId);

    set({ region, playerPosition: { x: spawnX, y: spawnY } });
    await get().loadBoards(region);
    await get().loadHouses(region);
    await get().loadChat(region);
  },

  updatePosition: async (x, y, userId) => {
    await supabase.from('player_presence')
      .update({ x, y, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  },

  loadBoards: async (region) => {
    const { data } = await supabase.from('boards').select('*').eq('region', region);
    if (data) set({ boards: data });
  },

  loadHouses: async (region) => {
    const { data } = await supabase.from('houses').select('*').eq('region', region);
    if (data) set({ houses: data });
  },

  loadChat: async (region) => {
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('region', region)
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) set({ chatMessages: data.reverse() });
  },

  sendChat: async (message, _userId, _username) => {
    const { region } = get();
    if (!region || !message.trim()) return;
    colyseusSendChat(message.trim());
  },
}));
