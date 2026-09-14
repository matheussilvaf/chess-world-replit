import { create } from 'zustand';
import { getColyseusHttpUrl } from '../config/colyseus';
import {
  DEFAULT_RATING_GAMBITS_CONFIG,
  parseRatingGambitsConfig,
  type ChessRatingUpdateMessage,
  type RatingRulesConfig,
} from '../shared/rating/RatingShapes';

/**
 * Rating no cliente (só leitura — quem calcula é o servidor):
 *  - `update`: último `chess_rating_update` recebido da sala. Vive fora do
 *    chessStore de propósito: o chessStore faz `reset()` ~3 s depois de
 *    `match_finished`, e o card de rating precisa continuar na tela até o
 *    jogador fechar (ou expirar).
 *  - `rules`: limiares públicos do admin (`GET /api/rating-config`) para o HUD
 *    marcar "provisório" com os MESMOS números do servidor; até a resposta
 *    chegar (ou sem rede) valem os defaults.
 */
interface RatingState {
  update: ChessRatingUpdateMessage | null;
  receivedAt: number;
  rules: RatingRulesConfig;
  rulesLoaded: boolean;
  setUpdate: (update: ChessRatingUpdateMessage) => void;
  dismiss: () => void;
  /** Busca as regras públicas uma vez por sessão (silencioso em erro). */
  loadRules: () => Promise<void>;
}

let rulesRequest: Promise<void> | null = null;

export const useRatingStore = create<RatingState>((set, get) => ({
  update: null,
  receivedAt: 0,
  rules: DEFAULT_RATING_GAMBITS_CONFIG.rating,
  rulesLoaded: false,
  setUpdate: (update) => set({ update, receivedAt: Date.now() }),
  dismiss: () => set({ update: null, receivedAt: 0 }),
  loadRules: async () => {
    if (get().rulesLoaded) return;
    if (rulesRequest) return rulesRequest;
    rulesRequest = (async () => {
      const httpUrl = getColyseusHttpUrl();
      if (!httpUrl) return;
      try {
        const response = await fetch(`${httpUrl.replace(/\/api$/, '')}/api/rating-config`);
        if (!response.ok) return;
        const body = (await response.json()) as { config?: unknown };
        const parsed = parseRatingGambitsConfig(body.config);
        set({ rules: parsed.config.rating, rulesLoaded: true });
      } catch {
        // sem rede / servidor antigo: ficam os defaults
      } finally {
        rulesRequest = null;
      }
    })();
    return rulesRequest;
  },
}));
