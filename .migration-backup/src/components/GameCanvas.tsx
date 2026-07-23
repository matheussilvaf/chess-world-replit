import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { createPhaserGame, getWorldScene } from '../game/PhaserGame';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { useChessStore } from '../stores/chessStore';
import { useGameSettingsStore } from '../stores/gameSettingsStore';
import { useInteractionStore } from '../stores/interactionStore';
import {
  getActiveRoom,
  joinArenaRoom,
  leaveArenaRoom,
  joinWorldRoom,
  leaveWorldRoom,
  registerBoards,
  sendMovement,
} from '../game/network/colyseusClient';
import { seatTournamentPlayerWhenReady } from '../game/tournamentSeatClient';
import { useColyseusStore } from '../hooks/useColyseusConnection';
import { loadCharacterConfigs } from '../config/loadCharacterConfigs';
import type { WorldScene } from '../game/scenes/WorldScene';
import type { Room } from 'colyseus.js';

export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneReadyRef = useRef(false);
  const attachedRoomIdRef = useRef<string | null>(null);
  const transitionInProgressRef = useRef(false);
  const { setSelectedBoard } = useGameStore();
  const { user, profile } = useAuthStore();
  const { region } = useGameStore();

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    loadCharacterConfigs();

    const game = createPhaserGame(containerRef.current);
    gameRef.current = game;

    const setupScene = () => {
      if (!gameRef.current) return;
      const scene = getWorldScene(gameRef.current);

      if (!scene) {
        setTimeout(setupScene, 200);
        return;
      }

      try {
        if (!scene.scene || !scene.scene.isActive()) {
          setTimeout(setupScene, 200);
          return;
        }
      } catch {
        setTimeout(setupScene, 200);
        return;
      }

      sceneReadyRef.current = true;
      console.log('[GameCanvas] Scene ready');

      useInteractionStore.getState().setConfirmAction(() => {
        scene.confirmProximityInteraction();
      });

      if (user && region) {
        scene.setLocalPlayer(user.id, region);
      }

      scene.onBoardClick = (arenaId: string, arenaTitle: string) => {
        if (!user || !profile || !region) return;
        const state = useGameStore.getState();
        if (state.selectedBoard || state.boardLocked) return;

        setSelectedBoard({
          id: arenaId,
          name: arenaTitle,
          region,
          x: 0,
          y: 0,
          status: 'free',
          waiting_user_id: null,
          current_match_id: null,
          time_minutes: null,
          increment_seconds: null,
          created_at: '',
          updated_at: '',
        } as any);
      };

      scene.onPositionUpdate = () => {};

      scene.onInteractionClick = (event) => {
        const interactionStore = useInteractionStore.getState();
        const obj = event.object;

        if (obj.category === 'chess_table' || obj.category === 'player_seat') {
          if (!user || !profile || !region) return;
          const tableId = obj.properties.tableId as string;
          if (!tableId) return;
          const state = useGameStore.getState();
          if (state.selectedBoard || state.boardLocked) return;

          let preSelectedSide: 'w' | 'b' | 'random' = 'random';
          if (obj.category === 'player_seat') {
            const pos = obj.properties.position as string;
            if (pos === 'top') preSelectedSide = 'b';
            else preSelectedSide = 'w';
          }

          setSelectedBoard({
            id: tableId,
            name: tableId,
            region,
            x: obj.x,
            y: obj.y,
            status: 'free',
            waiting_user_id: null,
            current_match_id: null,
            time_minutes: null,
            increment_seconds: null,
            created_at: '',
            updated_at: '',
            preSelectedSide,
          } as any);
          return;
        }

        if (obj.category === 'spectator_seat') {
          const tableId = obj.properties.tableId as string;
          if (!tableId) return;
          const state = useGameStore.getState();
          const boardState = state.colyseusBoards.find(b => b.id === tableId);
          if (boardState?.status === 'playing' && boardState.matchId) {
            useChessStore.getState().openSpectate(boardState.matchId);
            const position = obj.properties.position as string;
            const seatKey = position?.includes('left') ? 'left_01' : 'right_01';
            scene.seatPlayer(tableId, 'spectator', seatKey);
          }
          return;
        }

        // Enter building: transition to arena room
        if (obj.properties.action === 'enter_building' && obj.properties.targetMap) {
          const targetMap = obj.properties.targetMap as string;
          const targetSpawn = obj.properties.targetSpawn as string;
          let mapPath = '';
          if (targetMap === 'tournament_arena_interior') {
            mapPath = '/assets/world-v2/tournament_reception.tmj';
          }
          if (mapPath && targetSpawn) {
            useInteractionStore.getState().setProximityObject(null);
            transitionToRoom(scene, 'arena', mapPath, targetSpawn);
            return;
          }
        }

        // Exit building: transition back to world room
        if (obj.properties.action === 'exit_building' && obj.properties.targetMap) {
          const targetMap = obj.properties.targetMap as string;
          const targetSpawn = obj.properties.targetSpawn as string;
          let mapPath = '';
          if (targetMap === 'main_world') {
            mapPath = '/assets/world-v2/main_world.tmj';
          }
          if (mapPath && targetSpawn) {
            useInteractionStore.getState().setProximityObject(null);
            transitionToRoom(scene, 'world', mapPath, targetSpawn);
            return;
          }
        }

        if (interactionStore.debugEnabled) {
          interactionStore.openModal({ object: obj, playerDistance: event.playerDistance });
        }
      };
      scene.onProximityEnter = (event) => {
        useInteractionStore.getState().setProximityObject(event.object);
      };
      scene.onProximityExit = () => {
        useInteractionStore.getState().setProximityObject(null);
      };
      scene.onZoneChange = (event) => {
        const store = useInteractionStore.getState();
        if (event.entered) {
          store.setCurrentZone({ zoneId: event.zoneId, zoneName: event.zoneName, zoneType: event.zoneType });
        } else {
          store.setCurrentZone(null);
        }
        store.showZoneNotification(event);
      };

      tryAttachListeners(scene);
    };

    setTimeout(setupScene, 500);

    return () => {
      attachedRoomIdRef.current = null;
      sceneReadyRef.current = false;
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const settingsStore = useGameSettingsStore;
    settingsStore.getState().load();
    const unsubRealtime = settingsStore.getState().subscribe();

    const unsubStore = settingsStore.subscribe((state) => {
      if (!gameRef.current) return;
      const scene = getWorldScene(gameRef.current);
      if (scene) {
        scene.setDefaultZoom(state.defaultZoom);
        scene.setPlayerSpeed(state.playerSpeed);
        scene.setShowDebugVisuals(state.showDebugVisuals);
      }
    });

    return () => {
      unsubRealtime();
      unsubStore();
    };
  }, []);

  useEffect(() => {
    const unsubColyseus = useColyseusStore.subscribe((state, prev) => {
      if (state.connected && !prev.connected) {
        attemptListenerSetup();
      }
    });

    if (useColyseusStore.getState().connected) {
      attemptListenerSetup();
    }

    return () => unsubColyseus();
  }, []);

  function attemptListenerSetup() {
    if (!sceneReadyRef.current || !gameRef.current) return;
    const scene = getWorldScene(gameRef.current);
    if (scene) {
      tryAttachListeners(scene);
    }
  }

  function tryAttachListeners(scene: WorldScene) {
    const room = getActiveRoom();
    if (!room) return;
    if (attachedRoomIdRef.current === room.roomId) return;

    if (!room.state) {
      useGameStore.getState().setLastEvent('state null - waiting');
      room.onStateChange.once(() => {
        validateAndAttach(scene, room);
      });
      return;
    }

    validateAndAttach(scene, room);
  }

  function validateAndAttach(scene: WorldScene, room: Room<any>) {
    if (attachedRoomIdRef.current === room.roomId) return;

    const state = room.state;
    const playersOk = state && state.players && typeof state.players.onAdd === 'function';
    const boardsOk = state && state.boards && typeof state.boards.onAdd === 'function';

    if (!playersOk || !boardsOk) {
      console.error('[Colyseus] State contract invalid - players or boards missing onAdd');
      useGameStore.getState().setLastEvent('Colyseus state invalid');
      return;
    }

    attachListeners(scene, room);
  }

  async function transitionToRoom(
    scene: WorldScene,
    targetRoomType: 'world' | 'arena',
    mapPath: string,
    targetSpawn: string
  ) {
    if (transitionInProgressRef.current) return;
    transitionInProgressRef.current = true;

    const { user, profile } = useAuthStore.getState();
    const { region } = useGameStore.getState();
    if (!user || !region) {
      transitionInProgressRef.current = false;
      return;
    }

    try {
      // 1. Reset listener flag
      attachedRoomIdRef.current = null;

      // 2. Destroy all remote players from the old room
      scene.destroyAllRemotePlayers();

      // 3. Leave the current room
      if (targetRoomType === 'arena') {
        await leaveWorldRoom();
      } else {
        await leaveArenaRoom();
      }

      // 4. Switch the visual map
      await scene.switchMap(mapPath, targetSpawn);

      // 5. Join the new room
      const pos = scene.getPlayerPosition();
      const options = {
        playerId: user.id,
        username: profile?.username || 'Player',
        rating: profile?.rating || 1200,
        region,
        x: pos.x,
        y: pos.y,
      };

      let newRoom: Room<any>;
      if (targetRoomType === 'arena') {
        newRoom = await joinArenaRoom(options);
      } else {
        newRoom = await joinWorldRoom(options);
      }

      // 6. Update connection store
      useColyseusStore.getState().setConnected(newRoom.sessionId, newRoom.roomId);

      // 7. Attach listeners to new room
      if (!newRoom.state) {
        newRoom.onStateChange.once(() => {
          validateAndAttach(scene, newRoom);
        });
      } else {
        validateAndAttach(scene, newRoom);
      }

      console.log(`[GameCanvas] Room transition complete -> ${targetRoomType}`);
    } catch (err) {
      console.error('[GameCanvas] Room transition failed:', err);
    } finally {
      transitionInProgressRef.current = false;
    }
  }

  function attachListeners(scene: WorldScene, room: Room<any>) {
    if (attachedRoomIdRef.current === room.roomId) return;
    attachedRoomIdRef.current = room.roomId;

    const state = room.state;
    console.log('[Colyseus] Attaching listeners. players:', state.players.size, '| boards:', state.boards.size);

    scene.setMovementSender((data) => {
      sendMovement(data);
    });

    const arenas = scene.getArenas();
    if (arenas.length > 0) {
      const payload = arenas.map((a: any) => ({ id: a.id, name: a.title, x: a.x, y: a.y, width: a.width, height: a.height }));
      registerBoards(payload);
    }

    // All players in this room are on the same map - show them unconditionally
    state.players.onAdd((player: any, sessionId: string) => {
      if (sessionId === room.sessionId) {
        updateOnlineCount(room);
        return;
      }

      scene.handlePlayerJoined({
        id: player.id,
        socketId: sessionId,
        username: player.username,
        rating: player.rating,
        region: player.region,
        x: player.x,
        y: player.y,
        targetX: player.targetX,
        targetY: player.targetY,
        direction: player.direction,
        isMoving: player.isMoving,
      });

      player.onChange(() => {
        scene.updateRemotePlayerState(sessionId, {
          x: player.x,
          y: player.y,
          targetX: player.targetX,
          targetY: player.targetY,
          direction: player.direction,
          isMoving: player.isMoving,
        });
      });

      updateOnlineCount(room);
    });

    state.players.onRemove((_player: any, sessionId: string) => {
      scene.handlePlayerLeftBySession(sessionId);
      updateOnlineCount(room);
    });

    state.boards.onAdd((board: any, _boardId: string) => {
      updateBoardVisual(scene, board, room);
      syncBoardsToStore(room);

      board.onChange(() => {
        updateBoardVisual(scene, board, room);
        syncBoardsToStore(room);
      });
    });

    state.boards.onRemove((_board: any, _boardId: string) => {
      syncBoardsToStore(room);
    });

    if (state.matches && typeof state.matches.onAdd === 'function') {
      state.matches.onAdd((match: any, _matchId: string) => {
        if (match.boardId && match.fen && gameRef.current) {
          const ws = getWorldScene(gameRef.current);
          if (ws) ws.updateBoardFEN(match.boardId, match.fen);
        }
        match.onChange(() => {
          useChessStore.getState().syncFromColyseus(match);
          if (match.boardId && match.fen && gameRef.current) {
            const ws = getWorldScene(gameRef.current);
            if (ws) ws.updateBoardFEN(match.boardId, match.fen);
          }
        });
      });
    }

    room.onMessage('state_contract', (data: any) => {
      console.log('[Colyseus] state_contract:', data);
    });

    room.onMessage('match_started', (data: any) => {
      useGameStore.getState().setLastEvent(`match_started ${data.matchId.slice(0, 8)}`);
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return;

      useGameStore.getState().setSelectedBoard(null);
      useGameStore.getState().setBoardLocked(false);

      useChessStore.getState().openMatch(data.matchId, data.color, userId, data.boardId);

      if (data.boardId) {
        const seat = data.color === 'w' ? 'bottom' : 'top';
        seatTournamentPlayerWhenReady(data.boardId, seat, data.color);
        if (gameRef.current) {
          const worldScene = getWorldScene(gameRef.current);
          if (worldScene) {
            const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
            worldScene.updateBoardFEN(data.boardId, initialFen);
            worldScene.activateOverlayInteraction(data.boardId, data.color);
          }
        }
      }
    });

    room.onMessage('match_finished', (data: any) => {
      useGameStore.getState().setLastEvent(`match_finished: ${data.result}`);
      useChessStore.getState().finishMatchFromServer(data);
      setTimeout(() => {
        if (gameRef.current) {
          const worldScene = getWorldScene(gameRef.current);
          if (worldScene) {
            worldScene.deactivateOverlayInteraction();
            worldScene.unseatPlayer();
            if (data.boardId) {
              worldScene.updateBoardStatus(data.boardId, 'idle');
            }
          }
        }
        useChessStore.getState().reset();
      }, 3000);
    });

    room.onMessage('challenge_created', (data: any) => {
      useGameStore.getState().setChallengeColor(data.color || null);
      if (gameRef.current && data.boardId) {
        const worldScene = getWorldScene(gameRef.current);
        if (worldScene) {
          worldScene.seatPlayer(data.boardId, 'player', data.seat || 'bottom');
        }
      }
    });

    room.onMessage('challenge_cancelled', () => {
      if (gameRef.current) {
        const worldScene = getWorldScene(gameRef.current);
        if (worldScene) worldScene.unseatPlayer();
      }
    });

    room.onMessage('error', (data: any) => {
      console.warn('[Colyseus] Error:', data.message);
    });

    room.onMessage('chat', (data: any) => {
      useGameStore.getState().addChatMessage({
        id: data.id,
        region: '',
        user_id: data.playerId,
        username: data.username,
        message: data.message,
        created_at: data.createdAt,
      });
    });

    syncBoardsToStore(room);
    updateOnlineCount(room);
    useGameStore.getState().setLastEvent('listeners attached');
    console.log('[Colyseus] All listeners attached');
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

function updateOnlineCount(room: Room<any>) {
  if (!room.state?.players) return;
  const count = room.state.players.size;
  useGameStore.getState().setOnlinePlayers(Math.max(0, count - 1));
}

function updateBoardVisual(scene: WorldScene, board: any, room?: Room<any>) {
  if (board.status === 'waiting') {
    scene.updateBoardStatus(board.id, 'waiting', {
      playerName: board.waitingPlayerName,
      timeLabel: board.timeLabel,
    });
  } else if (board.status === 'playing') {
    let fen = '';
    if (room?.state?.matches && board.matchId) {
      room.state.matches.forEach((m: any, mId: string) => {
        if (mId === board.matchId || m.id === board.matchId) {
          fen = m.fen || '';
        }
      });
    }
    const fenToShow = fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    scene.updateBoardFEN(board.id, fenToShow);

    const localUserId = useAuthStore.getState().user?.id;
    if (board.whitePlayerId && board.whitePlayerId !== localUserId) {
      scene.seatRemotePlayerById(board.whitePlayerId, 'bottom', board.id);
    }
    if (board.blackPlayerId && board.blackPlayerId !== localUserId) {
      scene.seatRemotePlayerById(board.blackPlayerId, 'top', board.id);
    }
  } else {
    scene.updateBoardStatus(board.id, 'idle');
    scene.unseatRemotePlayersAtBoard(board.id);
  }
}

function syncBoardsToStore(room: Room<any>) {
  if (!room.state?.boards) return;
  const boards: any[] = [];
  room.state.boards.forEach((board: any, id: string) => {
    boards.push({
      id,
      name: board.name,
      status: board.status,
      waitingPlayerId: board.waitingPlayerId,
      waitingPlayerName: board.waitingPlayerName,
      whitePlayerId: board.whitePlayerId || '',
      blackPlayerId: board.blackPlayerId || '',
      timeCategory: board.timeCategory,
      baseMinutes: board.baseMinutes,
      incrementSeconds: board.incrementSeconds,
      timeLabel: board.timeLabel,
      matchId: board.matchId || '',
    });
  });
  useGameStore.getState().setColyseusBoards(boards);
}
