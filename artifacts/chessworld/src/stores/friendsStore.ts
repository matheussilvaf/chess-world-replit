import { create } from 'zustand';
import { acceptFriendRequest, fetchFriends, rejectFriendRequest, removeFriend, sendFriendRequest, type FriendSummary, type FriendsPayload } from '../lib/friendsApi';
import { useAuthStore } from './authStore';
import { useGameStore } from './gameStore';

interface FriendsState extends FriendsPayload {
  loading: boolean;
  error: string | null;
  unseenCount: number;
  refresh: () => Promise<void>;
  sendRequest: (userId: string) => Promise<void>;
  accept: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  markRequestsSeen: () => void;
  handleRealtime: (type: 'friend_request' | 'friend_accepted', payload: any) => void;
}

function seenKey() {
  return `chessworld.friends.seenAt.${useAuthStore.getState().user?.id ?? 'anonymous'}`;
}

function countUnseen(incoming: FriendsPayload['incoming']) {
  const seen = Number(localStorage.getItem(seenKey()) ?? 0);
  return incoming.filter((request) => new Date(request.createdAt).getTime() > seen).length;
}

export const useFriendsStore = create<FriendsState>((set, get) => ({
  friends: [],
  incoming: [],
  outgoing: [],
  loading: false,
  error: null,
  unseenCount: 0,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const result = await fetchFriends();
      set({ ...result, unseenCount: countUnseen(result.incoming), loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Não foi possível carregar amigos.', loading: false });
    }
  },
  sendRequest: async (id) => {
    set({ error: null });
    try {
      await sendFriendRequest(id);
      await get().refresh();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Não foi possível enviar a solicitação.' });
      throw error;
    }
  },
  accept: async (id) => {
    try {
      await acceptFriendRequest(id);
      await get().refresh();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Não foi possível aceitar.' });
    }
  },
  reject: async (id) => {
    try {
      await rejectFriendRequest(id);
      await get().refresh();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Não foi possível recusar.' });
    }
  },
  remove: async (id) => {
    try {
      await removeFriend(id);
      await get().refresh();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Não foi possível remover o amigo.' });
    }
  },
  markRequestsSeen: () => {
    localStorage.setItem(seenKey(), String(Date.now()));
    set({ unseenCount: 0 });
  },
  handleRealtime: (type, payload) => {
    if (type === 'friend_request') {
      const from: FriendSummary = { userId: payload.from.userId, username: payload.from.username, chessRating: 0, level: 0, online: true, region: null };
      set((state) => ({
        incoming: [...state.incoming.filter((item) => item.id !== payload.requestId), { id: payload.requestId, createdAt: payload.createdAt, from }],
        unseenCount: state.unseenCount + 1,
      }));
    } else {
      void get().refresh();
    }
  },
}));

export function openFriends(tab: 'friends' | 'requests' = 'friends') {
  useGameStore.getState().openFriends(tab);
}