import { getColyseusHttpUrl } from '../config/colyseus';
import { supabase } from './supabase';

export interface FriendSummary {
  userId: string;
  username: string;
  chessRating: number;
  level: number;
  online: boolean;
  region: string | null;
}

export interface FriendsPayload {
  friends: FriendSummary[];
  incoming: Array<{ id: string; createdAt: string; from: FriendSummary }>;
  outgoing: Array<{ id: string; createdAt: string; to: FriendSummary }>;
}

export interface PlayerSummary extends FriendSummary {
  skills: Array<{ id: string; name: string; level: number; xp: number; intoLevel: number; needed: number }>;
  gambits: number;
  crowns: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  friendship: 'none' | 'friends' | 'pending_out' | 'pending_in';
  requestId?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const endpoint = getColyseusHttpUrl();
  if (!endpoint) throw new Error('Servidor do jogo não configurado.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Faça login para acessar amigos.');
  let response: Response;
  try {
    response = await fetch(`${endpoint.replace(/\/api$/, '')}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
    });
  } catch {
    throw new Error('Sem conexão com o servidor.');
  }
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? `Erro ${response.status} do servidor.`);
  return body as T;
}

export const fetchFriends = () => request<FriendsPayload>('/api/friends');
export const sendFriendRequest = (targetUserId: string) => request<{ accepted: boolean; requestId?: string }>('/api/friends/requests', { method: 'POST', body: JSON.stringify({ targetUserId }) });
export const acceptFriendRequest = (id: string) => request<{ ok: true }>(`/api/friends/requests/${id}/accept`, { method: 'POST' });
export const rejectFriendRequest = (id: string) => request<{ ok: true }>(`/api/friends/requests/${id}/reject`, { method: 'POST' });
export const removeFriend = (id: string) => request<{ ok: true }>(`/api/friends/${id}`, { method: 'DELETE' });
export const fetchPlayerSummary = (id: string) => request<PlayerSummary>(`/api/players/${id}/summary`);