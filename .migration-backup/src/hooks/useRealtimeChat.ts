import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore';
import { socket } from '../game/network/socketClient';

export function useRealtimeChat() {
  const { region, addChatMessage } = useGameStore();
  const listenerRef = useRef(false);

  useEffect(() => {
    if (!region || listenerRef.current) return;

    const handler = (msg: any) => {
      addChatMessage({
        id: msg.id,
        region: msg.region,
        user_id: msg.playerId,
        username: msg.username,
        message: msg.message,
        created_at: msg.createdAt,
      });
    };

    socket.on('chat_message', handler);
    listenerRef.current = true;

    return () => {
      socket.off('chat_message', handler);
      listenerRef.current = false;
    };
  }, [region, addChatMessage]);
}
