import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../stores/gameStore';

let boardBroadcastChannel: ReturnType<typeof supabase.channel> | null = null;

export function broadcastBoardStatus(region: string, boardName: string, status: string) {
  if (!boardBroadcastChannel) {
    boardBroadcastChannel = supabase.channel(`board_status_${region}`, {
      config: { broadcast: { self: true } },
    });
    boardBroadcastChannel.subscribe();
  }
  boardBroadcastChannel.send({
    type: 'broadcast',
    event: 'board_status',
    payload: { boardName, status },
  });
}

export function useRealtimeBoards() {
  const { region, loadBoards } = useGameStore();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const broadcastRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!region) return;

    // Postgres changes as backup
    channelRef.current = supabase
      .channel(`boards_pg_${region}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'boards',
        filter: `region=eq.${region}`,
      }, () => {
        loadBoards(region);
      })
      .subscribe();

    // Broadcast channel for instant board status sync
    const broadcastChannel = supabase.channel(`board_status_${region}`, {
      config: { broadcast: { self: true } },
    });

    broadcastChannel.on('broadcast', { event: 'board_status' }, (payload) => {
      const { boardName, status } = payload.payload as { boardName: string; status: string };
      // Directly update the scene via the global callback
      if (window.__updateBoardStatusInScene) {
        window.__updateBoardStatusInScene(boardName, status);
      }
    });

    broadcastChannel.subscribe();
    broadcastRef.current = broadcastChannel;
    boardBroadcastChannel = broadcastChannel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
      if (broadcastRef.current) {
        supabase.removeChannel(broadcastRef.current);
        boardBroadcastChannel = null;
      }
    };
  }, [region]);
}

declare global {
  interface Window {
    __updateBoardStatusInScene?: (boardName: string, status: string) => void;
  }
}
