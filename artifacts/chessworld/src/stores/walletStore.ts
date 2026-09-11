/**
 * Carteira do jogador (moeda Crowns). O servidor manda `wallet_update {crowns}`
 * ao entrar na sala e depois de cada "coletar renda"; fora da sala o HUD pode
 * pedir o saldo por HTTP (`GET /api/me/wallet`). `null` = ainda desconhecido.
 */
import { create } from 'zustand';
import { getColyseusHttpUrl } from '../config/colyseus';
import { supabase } from '../lib/supabase';

interface WalletState {
  crowns: number | null;
  /** Último saldo recebido (ms) — para animar a pill quando muda. */
  updatedAt: number;
  setCrowns: (crowns: number) => void;
  /** Busca o saldo pelo HTTP do servidor (sessão Supabase). Silencioso em erro. */
  refresh: () => Promise<void>;
  reset: () => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  crowns: null,
  updatedAt: 0,
  setCrowns: (crowns) => set({ crowns: Math.max(0, Math.floor(crowns)), updatedAt: Date.now() }),
  refresh: async () => {
    const httpUrl = getColyseusHttpUrl();
    if (!httpUrl) return;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const response = await fetch(`${httpUrl.replace(/\/api$/, '')}/api/me/wallet`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const body = (await response.json()) as { crowns?: unknown };
      if (typeof body.crowns === 'number' && Number.isFinite(body.crowns)) {
        set({ crowns: Math.max(0, Math.floor(body.crowns)), updatedAt: Date.now() });
      }
    } catch {
      // sem rede / servidor antigo: a pill fica em "—" até o wallet_update da sala
    }
  },
  reset: () => set({ crowns: null, updatedAt: 0 }),
}));

/** 12345 → "12.345" (pt-BR). */
export function formatCrowns(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('pt-BR').format(value);
}
