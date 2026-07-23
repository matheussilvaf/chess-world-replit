import { useState, useEffect, useRef, useCallback } from 'react';
import { Client, Room } from 'colyseus.js';
import { getColyseusWsUrl } from '../config/colyseus';
import { supabase } from '../lib/supabase';

export interface TournamentState {
  status: string;
  tournamentId: string;
  startsAt: string;
  serverNow: string;
  currentRound: number;
  totalRounds: number;
  playerCount: number;
  timeControlLabel: string;
  timeControlCategory: string;
  baseTimeSeconds: number;
  incrementSeconds: number;
  roundMode: string;
  practiceTablesLocked: boolean;
  doorOpen: boolean;
  lastStatus: string;
  modules: Array<{ instanceId: string; moduleType: string; order: number }>;
  tables: Array<{ runtimeTableId: string; tableNumber: number; moduleInstanceId: string; localSlotId: string }>;
  pairings: Array<{
    roundNumber: number;
    boardNumber: number;
    whitePlayerId: string;
    blackPlayerId: string;
    whiteUsername: string;
    blackUsername: string;
    tableNumber: number;
    runtimeTableId: string;
    result: string;
    resultReason: string;
    isBye: boolean;
    byePlayerId: string;
    presenceDeadline: string;
    startedAt: string;
    completedAt: string;
  }>;
  registrations: Array<{ playerId: string; username: string; rating: number }>;
  standings: Array<{
    position: number;
    playerId: string;
    username: string;
    rating: number;
    points: number;
    wins: number;
    draws: number;
    losses: number;
    buchholz: number;
    isChampion: boolean;
  }>;
}

const EMPTY_STATE: TournamentState = {
  status: 'idle',
  tournamentId: '',
  startsAt: '',
  serverNow: '',
  currentRound: 0,
  totalRounds: 0,
  playerCount: 0,
  timeControlLabel: '',
  timeControlCategory: '',
  baseTimeSeconds: 300,
  incrementSeconds: 0,
  roundMode: 'auto-normal',
  practiceTablesLocked: false,
  doorOpen: false,
  lastStatus: '',
  modules: [],
  tables: [],
  pairings: [],
  registrations: [],
  standings: [],
};

export function useTournamentRoom() {
  const [state, setState] = useState<TournamentState>(EMPTY_STATE);
  const [connected, setConnected] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const clientRef = useRef<Client | null>(null);

  const connect = useCallback(async () => {
    if (roomRef.current) return;

    const wsUrl = getColyseusWsUrl();
    if (!wsUrl) return;

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    try {
      if (!clientRef.current) {
        clientRef.current = new Client(wsUrl);
      }
      const room = await clientRef.current.joinOrCreate('tournament', {
        accessToken: token,
      });

      roomRef.current = room;
      setConnected(true);

      room.onMessage('fullState', (msg: any) => {
        setState(prev => ({ ...prev, ...msg }));
      });

      room.onStateChange((newState: any) => {
        const modules: TournamentState['modules'] = [];
        if (newState.modules) {
          newState.modules.forEach((m: any) => {
            modules.push({ instanceId: m.instanceId, moduleType: m.moduleType, order: m.order });
          });
        }
        const tables: TournamentState['tables'] = [];
        if (newState.tables) {
          newState.tables.forEach((t: any) => {
            tables.push({ runtimeTableId: t.runtimeTableId, tableNumber: t.tableNumber, moduleInstanceId: t.moduleInstanceId, localSlotId: t.localSlotId });
          });
        }
        const pairings: TournamentState['pairings'] = [];
        if (newState.pairings) {
          newState.pairings.forEach((p: any) => {
            pairings.push({
              roundNumber: p.roundNumber,
              boardNumber: p.boardNumber,
              whitePlayerId: p.whitePlayerId,
              blackPlayerId: p.blackPlayerId,
              whiteUsername: p.whiteUsername,
              blackUsername: p.blackUsername,
              tableNumber: p.tableNumber,
              runtimeTableId: p.runtimeTableId,
              result: p.result,
              resultReason: p.resultReason,
              isBye: p.isBye,
              byePlayerId: p.byePlayerId,
              presenceDeadline: p.presenceDeadline,
              startedAt: p.startedAt,
              completedAt: p.completedAt,
            });
          });
        }
        const registrations: TournamentState['registrations'] = [];
        if (newState.registrations) {
          newState.registrations.forEach((r: any) => {
            registrations.push({ playerId: r.playerId, username: r.username, rating: r.rating });
          });
        }
        const standings: TournamentState['standings'] = [];
        if (newState.standings) {
          newState.standings.forEach((s: any) => {
            standings.push({
              position: s.position,
              playerId: s.playerId,
              username: s.username,
              rating: s.rating,
              points: s.points,
              wins: s.wins,
              draws: s.draws,
              losses: s.losses,
              buchholz: s.buchholz,
              isChampion: s.isChampion,
            });
          });
        }

        setState({
          status: newState.status || 'idle',
          tournamentId: newState.tournamentId || '',
          startsAt: newState.startsAt || '',
          serverNow: newState.serverNow || '',
          currentRound: newState.currentRound || 0,
          totalRounds: newState.totalRounds || 0,
          playerCount: newState.playerCount || 0,
          timeControlLabel: newState.timeControlLabel || '',
          timeControlCategory: newState.timeControlCategory || '',
          baseTimeSeconds: newState.baseTimeSeconds || 300,
          incrementSeconds: newState.incrementSeconds || 0,
          roundMode: newState.roundMode || 'auto-normal',
          practiceTablesLocked: newState.practiceTablesLocked || false,
          doorOpen: newState.doorOpen || false,
          lastStatus: newState.lastStatus || '',
          modules,
          tables,
          pairings,
          registrations,
          standings,
        });
      });

      room.onLeave(() => {
        setConnected(false);
        roomRef.current = null;
      });
    } catch (e) {
      console.warn('[TournamentRoom] Failed to connect:', (e as Error).message);
      setConnected(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (roomRef.current) {
      await roomRef.current.leave();
      roomRef.current = null;
    }
    setConnected(false);
  }, []);

  const register = useCallback((username: string, rating: number) => {
    if (roomRef.current) {
      roomRef.current.send('register', { username, rating });
    }
  }, []);

  const unregister = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.send('unregister');
    }
  }, []);

  const reportResult = useCallback((roundNumber: number, boardNumber: number, result: string, reason: string) => {
    if (roomRef.current) {
      roomRef.current.send('reportResult', { roundNumber, boardNumber, result, reason });
    }
  }, []);

  const refresh = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.send('refresh');
    }
  }, []);

  useEffect(() => {
    return () => { disconnect(); };
  }, [disconnect]);

  return {
    state,
    connected,
    connect,
    disconnect,
    register,
    unregister,
    reportResult,
    refresh,
    room: roomRef,
  };
}
