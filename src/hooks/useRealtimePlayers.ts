import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';

export function useRealtimePlayers() {
  const { region, setOtherPlayers } = useGameStore();
  const { user } = useAuthStore();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!region || !user) return;

    const fetchPlayers = async () => {
      const { data } = await supabase
        .from('player_presence')
        .select('*')
        .eq('region', region)
        .neq('user_id', user.id);

      if (data) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, username, rating')
          .in('user_id', data.map(p => p.user_id));

        const enriched = data.map(p => {
          const prof = profiles?.find(pr => pr.user_id === p.user_id);
          return { ...p, username: prof?.username, rating: prof?.rating };
        });
        setOtherPlayers(enriched);
      }
    };

    fetchPlayers();

    channelRef.current = supabase
      .channel(`presence_${region}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'player_presence',
        filter: `region=eq.${region}`,
      }, () => {
        fetchPlayers();
      })
      .subscribe();

    const interval = setInterval(fetchPlayers, 3000);

    return () => {
      clearInterval(interval);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [region, user]);
}
