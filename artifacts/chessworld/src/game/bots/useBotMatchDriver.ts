import { useEffect, useRef, useState } from 'react';
import { getActiveRoom, getActiveRoomType } from '../network/colyseusClient';
import { ACADEMY_MSG, botPlayerId, isAcademyBotId } from '../../shared/academy/AcademyShapes';
import { useChessStore } from '../../stores/chessStore';
import { useAcademyStore } from '../../stores/academyStore';
import { useAuthStore } from '../../stores/authStore';
import { pushNotice } from '../../stores/noticesStore';
import { botEngine } from './botEngine';

/** Pausa "humana" entre a resposta do engine e o envio do lance (o engine já gasta ~800 ms). */
const REPLY_DELAY_MS = 350;
/** Falha do engine numa posição: novas tentativas limitadas (o relógio do bot continua correndo). */
const MAX_ATTEMPTS_PER_POSITION = 3;
const RETRY_DELAY_MS = 1500;

interface ActiveRequest {
  /** `${matchId}:${fen}` — uma busca por posição. */
  key: string;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Calcula os lances do bot no cliente do HUMANO da partida (sala `academy`) e os
 * envia como `bot_move`; o servidor valida. Uma busca por posição; a busca só é
 * cancelada quando a posição/partida muda (não em qualquer re-render da store).
 */
export function useBotMatchDriver() {
  const matchId = useChessStore((s) => s.matchId);
  const fen = useChessStore((s) => s.game?.fen() ?? '');
  const turn = useChessStore((s) => s.turn);
  const botId = useChessStore((s) => s.botId);
  const status = useChessStore((s) => s.status);
  const whiteId = useChessStore((s) => s.whitePlayerId);
  const blackId = useChessStore((s) => s.blackPlayerId);
  const paused = useChessStore((s) => s.clockPausedAt);
  const spectator = useChessStore((s) => s.isSpectating);
  const userId = useAuthStore((s) => s.user?.id);
  const level = useAcademyStore((s) => s.bots.find((b) => b.id === botId)?.level);
  const active = useRef<ActiveRequest | null>(null);
  const attempts = useRef<{ key: string; count: number }>({ key: '', count: 0 });
  const [retryTick, setRetryTick] = useState(0);

  const stopActive = () => {
    const request = active.current;
    if (!request) return;
    active.current = null;
    request.controller.abort();
    if (request.timer) clearTimeout(request.timer);
  };

  useEffect(() => {
    const botToMove = isAcademyBotId(botId) && (turn === 'w' ? whiteId : blackId) === botPlayerId(botId);
    const participant = !!userId && (whiteId === userId || blackId === userId);
    const eligible = !!matchId && !!fen && botToMove && !!level && status === 'playing' && !paused && !spectator
      && participant && getActiveRoomType() === 'academy';
    const key = `${matchId}:${fen}`;

    if (!eligible) {
      // Só descarta a busca em andamento se ela era para outra posição/partida ou a partida acabou.
      if (active.current && (active.current.key !== key || status !== 'playing' || !matchId)) stopActive();
      return;
    }
    if (active.current?.key === key) return;
    stopActive();
    if (attempts.current.key !== key) attempts.current = { key, count: 0 };
    if (attempts.current.count >= MAX_ATTEMPTS_PER_POSITION) return;
    attempts.current.count++;

    const controller = new AbortController();
    const request: ActiveRequest = { key, controller };
    active.current = request;
    const room = getActiveRoom();
    const botLevel = level;

    void (async () => {
      let acquired = false;
      try {
        const engine = await botEngine.acquire();
        acquired = true;
        if (controller.signal.aborted) return;
        const move = await engine.bestMove({ fen, level: botLevel }, controller.signal);
        if (controller.signal.aborted) return;
        request.timer = setTimeout(() => {
          const current = useChessStore.getState();
          if (controller.signal.aborted || getActiveRoom() !== room || getActiveRoomType() !== 'academy') return;
          if (current.matchId !== matchId || current.game?.fen() !== fen || current.status !== 'playing') return;
          room?.send(ACADEMY_MSG.botMove, { matchId, from: move.from, to: move.to, promotion: move.promotion });
        }, REPLY_DELAY_MS);
      } catch (error) {
        // Saída da academia encerra o engine no meio da busca: não é erro para o jogador.
        if (controller.signal.aborted || getActiveRoomType() !== 'academy') return;
        console.error('[Academia] Falha ao calcular lance do bot:', error);
        const exhausted = attempts.current.key === key && attempts.current.count >= MAX_ATTEMPTS_PER_POSITION;
        if (exhausted) {
          pushNotice({
            title: acquired ? 'Não foi possível calcular o lance do bot.' : 'Engine do bot indisponível.',
            body: error instanceof Error ? error.message : String(error),
          });
        }
        // Nova tentativa na mesma posição (a store não muda sozinha enquanto o bot não joga).
        request.timer = setTimeout(() => {
          if (controller.signal.aborted) return;
          if (active.current === request) active.current = null;
          setRetryTick((tick) => tick + 1);
        }, RETRY_DELAY_MS);
      } finally {
        if (acquired) botEngine.release();
      }
    })();
  }, [matchId, fen, turn, botId, status, whiteId, blackId, paused, spectator, userId, level, retryTick]);

  useEffect(() => () => stopActive(), []);
}
