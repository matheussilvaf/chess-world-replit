import { useCallback, useEffect, useRef, useState } from 'react';
import { CRAFTING_MAP, CRAFT_REGION_PREFIX } from '../game/config/craftingMapConfig';
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
  getWorldRoomRegion,
} from '../game/network/colyseusClient';
import { seatTournamentPlayerWhenReady } from '../game/tournamentSeatClient';
import { supabase } from '../lib/supabase';
import { useColyseusStore } from '../hooks/useColyseusConnection';
import { initCharacterSystem, getDefaultCharacterId } from '../game/characters/characterCatalog';
import type { WorldScene } from '../game/scenes/WorldScene';
import type { Room } from 'colyseus.js';
import { PlayerNameTags } from './game/PlayerNameTags';
import { AttackButton } from './game/AttackButton';
import { CharacterCreationModal } from './character-creation/CharacterCreationModal';
import { ToolHotbar } from './game/ToolHotbar';
import { CollectionInventoryPanel } from './game/CollectionInventoryPanel';
import { SkillsPanel } from './game/SkillsPanel';
import { InventoryDropPlacement } from './game/inventory/InventoryDropPlacement';
import { PerformanceHud } from './game/PerformanceHud';
import { usePlayerCharacterStore } from '../stores/playerCharacterStore';
import { setInventoryBridge } from '../game/inventory/inventoryBridge';
import { useCollectionInventoryStore } from '../stores/collectionInventoryStore';
import { useInventoryUiStore } from '../stores/inventoryUiStore';
import { loadInventoryVisualCatalog } from '../lib/inventory/inventoryVisualCatalog';
import type { CraftThumb } from '../lib/craft/craftCatalog';
import { clearStationCraftBridge, rejectStationCraft, resolveStationCraft, setStationCraftSender } from '../game/stations/stationCraftBridge';
import { clearEatBridge, rejectEat, resolveEat, setEatSender, type EatResult } from '../game/progress/eatBridge';
import { ensureProgressConfig, useProgressStore } from '../stores/progressStore';
import type { ProgressSnapshot } from '../shared/progress/EnergySkillsShapes';
import { StationGamePanel } from './game/StationGamePanel';
import { PlacedStationOverlays } from './game/stations/PlacedStationOverlays';
import { canUsePlacedStation, usePlacedStationsStore, type PlacedStationView } from '../stores/placedStationsStore';
import { parseAllowedIds } from '../shared/craft/PlaceableStations';

export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneReadyRef = useRef(false);
  const attachedRoomIdRef = useRef<string | null>(null);
  const inventoryListenerCleanupRef = useRef<(() => void) | null>(null);
  const transitionInProgressRef = useRef(false);
  const { setSelectedBoard } = useGameStore();
  const { user, profile } = useAuthStore();
  const { region } = useGameStore();
  const pcLoaded = usePlayerCharacterStore((s) => s.loaded);
  const pcCharacter = usePlayerCharacterStore((s) => s.character);
  const liveAppearance = usePlayerCharacterStore((s) => s.liveAppearance);
  const liveWeapon = usePlayerCharacterStore((s) => s.liveWeapon);
  const worldReady = usePlayerCharacterStore((s) => s.worldReady);
  const [stationId, setStationId] = useState<string | null>(null);
  /** Estação portátil posicionada que abriu o card atual (craft privado). */
  const [stationPlacedId, setStationPlacedId] = useState<string | null>(null);
  const inventoryOpen = useInventoryUiStore((s) => s.open);
  const skillsOpen = useProgressStore((s) => s.skillsOpen);
  const dropPlacementActive = useInventoryUiStore((s) => !!s.placement);
  const closeStationPanel = useCallback(() => {
    setStationId(null);
    setStationPlacedId(null);
    usePlacedStationsStore.getState().setOpenPlacedId(null);
  }, []);
  // Modal obrigatório: usuário logado, resposta do banco chegou e não há
  // personagem. Sem resposta (loaded=false) NÃO abre — evita pedir criação
  // para quem já tem personagem numa falha de rede.
  const showCreation = !!user && pcLoaded && !pcCharacter;

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    let cancelled = false;

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
        if (obj.category === 'station') {
          setStationPlacedId(null);
          setStationId(String(obj.properties.stationId));
          return;
        }

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
        setStationId(null);
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

    (async () => {
      // Manifest + saved configs must be ready BEFORE Phaser boots — the
      // scene preload reads the character definitions synchronously.
      await initCharacterSystem();
      if (cancelled || !containerRef.current || gameRef.current) return;
      gameRef.current = createPhaserGame(containerRef.current);
      setTimeout(setupScene, 500);
    })();

    return () => {
      cancelled = true;
      attachedRoomIdRef.current = null;
      inventoryListenerCleanupRef.current?.();
      inventoryListenerCleanupRef.current = null;
      sceneReadyRef.current = false;
      usePlayerCharacterStore.getState().reset();
      setInventoryBridge(null);
      clearStationCraftBridge();
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

    const applySettings = (state: ReturnType<typeof settingsStore.getState>) => {
      if (!gameRef.current) return;
      const scene = getWorldScene(gameRef.current);
      if (scene) {
        scene.setDefaultZoom(state.defaultZoom);
        scene.setPlayerSpeed(state.playerSpeed);
        scene.setShowDebugVisuals(state.showDebugVisuals);
        // Game-mode (board) zoom: pick per device class
        const isMobile = window.innerWidth < 768;
        scene.setBoardZoom(isMobile ? state.boardZoomMobile : state.boardZoomDesktop);
      }
    };

    const unsubStore = settingsStore.subscribe(applySettings);

    // The scene boots asynchronously — settings often finish loading BEFORE
    // Phaser is ready, and that first apply hits a missing scene. Re-apply
    // once the scene exists so toggles like Debug Visuals aren't lost until
    // the next realtime change.
    const readyPoll = window.setInterval(() => {
      if (gameRef.current && getWorldScene(gameRef.current)) {
        applySettings(settingsStore.getState());
        window.clearInterval(readyPoll);
      }
    }, 500);

    return () => {
      window.clearInterval(readyPoll);
      unsubRealtime();
      unsubStore();
    };
  }, []);

  // Personagem salvo do usuário (decide se o modal de criação abre).
  useEffect(() => {
    if (user) void usePlayerCharacterStore.getState().load();
  }, [user]);

  // Mundo pronto (create() terminou): habilita aplicar a aparência local.
  useEffect(() => {
    const poll = window.setInterval(() => {
      const scene = gameRef.current ? getWorldScene(gameRef.current) : null;
      if (scene && scene.isWorldReady()) {
        usePlayerCharacterStore.getState().setWorldReady(true);
        window.clearInterval(poll);
      }
    }, 300);
    return () => window.clearInterval(poll);
  }, []);

  // Estado AO VIVO do servidor → cena. Um único caminho cobre login com
  // personagem, criação recém-salva e equipar/desequipar arma.
  useEffect(() => {
    if (!worldReady || !liveAppearance) return;
    const scene = gameRef.current ? getWorldScene(gameRef.current) : null;
    if (!scene) return;
    void scene.setLocalAppearance(liveAppearance, liveWeapon || null);
  }, [worldReady, liveAppearance, liveWeapon]);

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

  // Reconcile after the tab comes back from background (minimized phone):
  // patches keep flowing while hidden, but Phaser visuals and missed messages
  // can leave the client stuck "seated" at a match the server already ended.
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
      if (hiddenFor < 3000) return;
      const room = getActiveRoom();
      if (!room || !room.state || !gameRef.current) return;
      const scene = getWorldScene(gameRef.current);
      if (!scene) return;

      // Skip right after a tournament auto-seat: the new match may not have
      // hit our state copy yet, and tearing the seat down would be wrong.
      const seatAt = (window as any).__tournamentSeatAt || 0;
      const freshlySeated = Date.now() - seatAt < 5000;

      const chess = useChessStore.getState();
      const matchGone =
        !!chess.matchId && room.state.matches && !room.state.matches.get(chess.matchId);
      if (matchGone && !freshlySeated) {
        console.log('[GameCanvas] Reconcile: local match no longer on server — cleaning up');
        scene.deactivateOverlayInteraction();
        scene.unseatPlayer();
        if (chess.boardId) scene.updateBoardStatus(chess.boardId, 'idle');
        chess.reset();
        useGameStore.getState().setOpponentDisconnected(null);
      }

      // Resync remote sprites (seat + position) and board visuals
      room.state.players?.forEach((p: any, sid: string) => {
        if (sid === room.sessionId) return;
        scene.syncRemoteSeat(sid, (p.currentBoardId ?? '') as string, p.x, p.y);
      });
      room.state.boards?.forEach((b: any) => updateBoardVisual(scene, b, room));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
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

  // Botão dev do HUD: viagem entre o mapa principal e o Mundo de Coleta
  const travelRequest = useGameStore((s) => s.travelRequest);
  useEffect(() => {
    if (!travelRequest) return;
    const store = useGameStore.getState();
    // Consome SEMPRE a request: clique durante transição é descartado (e o
    // próximo clique volta a disparar o effect, já que null -> valor muda).
    store.setTravelRequest(null);
    if (!gameRef.current || !sceneReadyRef.current || transitionInProgressRef.current) return;
    const scene = getWorldScene(gameRef.current);
    if (!scene || !store.region) return;
    if (travelRequest === 'crafting') {
      transitionToRoom(scene, 'world', CRAFTING_MAP.path, CRAFTING_MAP.spawnId, {
        regionOverride: `${CRAFT_REGION_PREFIX}${store.region}`,
      }).then((ok) => { if (ok) useGameStore.getState().setCurrentWorld('crafting'); });
    } else {
      transitionToRoom(scene, 'world', '/assets/world-v2/main_world.tmj', 'main_player_spawn')
        .then((ok) => { if (ok) useGameStore.getState().setCurrentWorld('main'); });
    }
  }, [travelRequest]);

  async function transitionToRoom(
    scene: WorldScene,
    targetRoomType: 'world' | 'arena',
    mapPath: string,
    targetSpawn: string,
    opts?: { regionOverride?: string }
  ): Promise<boolean> {
    if (transitionInProgressRef.current) return false;
    transitionInProgressRef.current = true;

    const { user, profile } = useAuthStore.getState();
    const { region } = useGameStore.getState();
    if (!user || !region) {
      transitionInProgressRef.current = false;
      return false;
    }

    try {
      // 1. Reset listener flag
      attachedRoomIdRef.current = null;

      // 2. Destroy all remote players from the old room
      scene.destroyAllRemotePlayers();

      // 3. Leave the current room. Viagem com TROCA DE REGIÃO (main ↔ Mundo de
      // Coleta) também sai da sala world já aqui — senão eventos da sala antiga
      // chegam durante o build do mapa. Teleportes na MESMA região (recepção de
      // torneio) continuam reusando a sala, como sempre.
      if (targetRoomType === 'arena') {
        await leaveWorldRoom();
      } else {
        await leaveArenaRoom();
        if (getWorldRoomRegion() !== (opts?.regionOverride ?? region)) {
          await leaveWorldRoom();
        }
      }

      // 4. Switch the visual map
      await scene.switchMap(mapPath, targetSpawn);

      // 5. Join the new room
      const pos = scene.getPlayerPosition();
      // O servidor deriva a identidade do TOKEN (playerId é só compat legada).
      const { data: sessionData } = await supabase.auth.getSession();
      const options = {
        playerId: user.id,
        token: sessionData.session?.access_token ?? null,
        username: profile?.username || 'Player',
        rating: profile?.rating || 1200,
        region: opts?.regionOverride ?? region,
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
      return true;
    } catch (err) {
      console.error('[GameCanvas] Room transition failed:', err);
      return false;
    } finally {
      transitionInProgressRef.current = false;
    }
  }

  function attachListeners(scene: WorldScene, room: Room<any>) {
    if (attachedRoomIdRef.current === room.roomId) return;
    inventoryListenerCleanupRef.current?.();
    inventoryListenerCleanupRef.current = null;
    scene.clearWorldDrops();
    setInventoryBridge(null);
    clearStationCraftBridge();
    attachedRoomIdRef.current = room.roomId;

    const state = room.state;
    console.log('[Colyseus] Attaching listeners. players:', state.players.size, '| boards:', state.boards.size);

    scene.setMovementSender((data) => {
      sendMovement(data);
    });

    scene.setAttackSender((payload) => {
      room.send('attack', payload);
    });
    scene.setInventoryPickupSender((dropId) => room.send('inventory_pickup', { requestId: crypto.randomUUID(), dropId }));
    // Estação portátil posicionada: dono/autorizado abre o card privado; os demais podem pedir permissão.
    scene.onPlacedStationClick = (placedId) => {
      const placedStore = usePlacedStationsStore.getState();
      const view = placedStore.stations[placedId];
      if (!view) return;
      const myId = useAuthStore.getState().user?.id ?? null;
      if (canUsePlacedStation(view, myId)) {
        placedStore.setPermissionPrompt(null);
        placedStore.setOpenPlacedId(placedId);
        setStationPlacedId(placedId);
        setStationId(view.stationId);
        return;
      }
      const current = placedStore.permissionPrompt;
      placedStore.setPermissionPrompt(
        current?.placedId === placedId ? current : { placedId, status: 'idle' },
      );
    };
    // CSS px ↔ px do canvas: o backing store pode ser maior que o rect (DPR/escala),
    // mesma correção que o WorldScene aplica nos overlays HTML.
    const canvasFrame = () => {
      const canvas = gameRef.current?.canvas;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        rect,
        scaleX: canvas.width > 0 ? rect.width / canvas.width : 1,
        scaleY: canvas.height > 0 ? rect.height / canvas.height : 1,
      };
    };
    setInventoryBridge({
      screenToWorld: (clientX, clientY) => {
        const frame = canvasFrame();
        if (!frame) return null;
        const point = scene.cameras.main.getWorldPoint(
          (clientX - frame.rect.left) / frame.scaleX,
          (clientY - frame.rect.top) / frame.scaleY,
        );
        return { x: point.x, y: point.y };
      },
      worldToScreen: (x, y) => {
        const frame = canvasFrame();
        if (!frame) return null;
        // Inverso exato de getWorldPoint: a mesma matriz combinada da câmera (scroll+zoom+origem).
        const point = scene.cameras.main.matrixCombined.transformPoint(x, y);
        return { x: frame.rect.left + point.x * frame.scaleX, y: frame.rect.top + point.y * frame.scaleY };
      },
      getPlayerPosition: () => scene.getPlayerSpritePosition(),
      getPlayerCenter: () => scene.getPlayerSpriteCenter(),
      setDropRadiusVisible: (visible) => scene.setDropRadiusVisible(visible),
      setDropMarker: (point) => scene.setDropMarker(point),
      sendDrop: (request) => room.send('inventory_drop', request),
      validatePlacement: (itemKey, x, y) => scene.validateStationPlacement(itemKey, x, y),
      setPlacementGhost: (ghost) => scene.setPlacementGhost(ghost),
      sendPlace: (request) => room.send('station_place', request),
      sendStationPickup: (request) => room.send('station_pickup', request),
      sendStationAccessRequest: (placedId) => room.send('station_request_access', { placedId }),
      sendStationAccessResponse: (placedId, requesterId, allow) => room.send('station_respond_access', { placedId, requesterId, allow }),
    });
    setStationCraftSender((payload) => room.send('craft_item', payload));
    // Energia + habilidades: snapshot empurrado pela sala; comer via hotbar.
    setEatSender((payload) => room.send('eat_item', payload));
    void ensureProgressConfig();
    const removeProgressUpdate = room.onMessage('progress_update', (data: ProgressSnapshot) => {
      useProgressStore.getState().applySnapshot(data);
    });
    const removeEatResult = room.onMessage('eat_result', (data: EatResult & { requestId?: string }) => {
      if (Array.isArray(data.items)) useCollectionInventoryStore.getState().applyServerTotals(data.items);
      resolveEat(data.requestId, data);
    });
    // Fraco → anda mais devagar e ferramentas de coleta não batem (a cena avisa via onToolBlocked).
    const applyEnergyState = (snapshot: ProgressSnapshot | null) => {
      scene.setEnergyState({ weak: snapshot?.state.weak ?? false, speedPercent: snapshot?.weakSpeedPercent ?? 100 });
    };
    applyEnergyState(useProgressStore.getState().snapshot);
    let lastProgressSnapshot = useProgressStore.getState().snapshot;
    const unsubscribeProgress = useProgressStore.subscribe((next) => {
      if (next.snapshot === lastProgressSnapshot) return;
      lastProgressSnapshot = next.snapshot;
      applyEnergyState(next.snapshot);
    });
    scene.onToolBlocked = () => useProgressStore.getState().setNotice('Você está fraco demais para usar ferramentas — coma algo.');
    const removeCraftResult = room.onMessage('craft_result', (data: { requestId: string; items: Array<{ itemKey: string; qty: number }> }) => {
      resolveStationCraft(data.requestId, { items: data.items });
    });
    const removeCraftError = room.onMessage('craft_error', (data: { requestId?: string; message?: string }) => {
      rejectStationCraft(data.requestId, data.message ?? 'Não foi possível criar o item.');
    });
    const removeInventoryChanged = room.onMessage('inventory_changed', (data: { requestId?: string; items?: Array<{ itemKey: string; qty: number }>; placedId?: string }) => {
      if (Array.isArray(data.items)) useCollectionInventoryStore.getState().applyServerTotals(data.items);
      useInventoryUiStore.getState().resolvePlacement(data.requestId, { ok: true });
      const placedStore = usePlacedStationsStore.getState();
      if (data.requestId && placedStore.pickupRequestId === data.requestId) {
        placedStore.setPickupRequestId(null);
        placedStore.pushNotice('success', 'Estação recolhida para o inventário.');
      }
    });
    const removeInventoryError = room.onMessage('inventory_error', (data: { requestId?: string; message?: string }) => {
      const message = data.message ?? 'Não foi possível alterar o inventário.';
      // Refeição recusada (sem fome, item sem energia…): o hotbar mostra o aviso.
      if (rejectEat(data.requestId, message)) {
        useCollectionInventoryStore.getState().setInventoryError(message);
        return;
      }
      const placedStore = usePlacedStationsStore.getState();
      if (data.requestId && placedStore.pickupRequestId === data.requestId) {
        placedStore.setPickupRequestId(null);
        placedStore.pushNotice('error', message);
        return;
      }
      // Recusa do drop em andamento aparece no próprio popover; o resto vai para o aviso da hotbar.
      if (!useInventoryUiStore.getState().resolvePlacement(data.requestId, { ok: false, message })) {
        useCollectionInventoryStore.getState().setInventoryError(message);
      }
    });
    // Permissões de uso das estações portáteis.
    const removeAccessRequest = room.onMessage('station_access_request', (data: { placedId: string; stationId: string; itemKey: string; requesterId: string; requesterName: string }) => {
      usePlacedStationsStore.getState().pushAccessRequest({ ...data, receivedAt: Date.now() });
    });
    const removeAccessUpdate = room.onMessage('station_access_update', (data: { placedId: string; status: 'sent' | 'granted' | 'denied' | 'error'; message?: string; stationId?: string }) => {
      const placedStore = usePlacedStationsStore.getState();
      if (data.status === 'granted') {
        placedStore.pushNotice('success', 'Permissão concedida — você já pode usar a estação.');
        const view = placedStore.stations[data.placedId];
        if (placedStore.permissionPrompt?.placedId === data.placedId && view) {
          placedStore.setPermissionPrompt(null);
          placedStore.setOpenPlacedId(data.placedId);
          setStationPlacedId(data.placedId);
          setStationId(view.stationId);
        }
        return;
      }
      if (data.status === 'denied') placedStore.pushNotice('info', 'O dono recusou o pedido de uso.');
      placedStore.updatePermissionPrompt(data.placedId, { status: data.status, message: data.message });
    });
    // Estações portáteis posicionadas (MapSchema → store → cena). Deploys antigos não têm o mapa.
    const placedStations = state.placedStations;
    let detachPlaced: (() => void) | undefined;
    if (placedStations && typeof placedStations.onAdd === 'function') {
      const toView = (placed: any, id: string): PlacedStationView => ({
        id,
        itemKey: String(placed.itemKey),
        stationId: String(placed.stationId),
        ownerId: String(placed.ownerId),
        ownerName: String(placed.ownerName ?? ''),
        x: Number(placed.x),
        y: Number(placed.y),
        durability: Number(placed.durability),
        maxDurability: Number(placed.maxDurability),
        placedAt: Number(placed.placedAt),
        expiresAt: Number(placed.expiresAt),
        allowed: parseAllowedIds(String(placed.allowed ?? '')),
      });
      placedStations.onAdd((placed: any, id: string) => {
        usePlacedStationsStore.getState().upsertStation(toView(placed, id));
        placed.onChange?.(() => usePlacedStationsStore.getState().upsertStation(toView(placed, id)));
      });
      placedStations.onRemove((_: any, id: string) => usePlacedStationsStore.getState().removeStation(id));
      let lastStations = usePlacedStationsStore.getState().stations;
      scene.syncPlacedStations(Object.values(lastStations));
      const unsubscribe = usePlacedStationsStore.subscribe((next) => {
        if (next.stations === lastStations) return;
        lastStations = next.stations;
        scene.syncPlacedStations(Object.values(next.stations));
      });
      detachPlaced = () => {
        unsubscribe();
        usePlacedStationsStore.getState().clearStations();
        scene.syncPlacedStations([]);
      };
    }
    const removeEquipError = room.onMessage('equip_error', (data: { message?: string }) => {
      usePlayerCharacterStore.getState().setEquipError(data.message ?? 'Não foi possível equipar.');
    });
    // Older cloud deployments do not have this MapSchema yet.
    const drops = state.worldDrops;
    let detachDrops: (() => void) | undefined;
    if (drops && typeof drops.onAdd === 'function') {
      // O catálogo visual carrega de forma assíncrona: se o drop for removido
      // (recolhido/expirado) ou a sala trocar antes de resolver, o desenho
      // atrasado não pode ressuscitar o item. Só a geração viva desenha.
      const liveDrops = new Map<string, number>();
      drops.onAdd((drop: any, id: string) => {
        const render = () => {
          const generation = (liveDrops.get(id) ?? 0) + 1;
          liveDrops.set(id, generation);
          const data = { id, itemKey: drop.itemKey, qty: drop.qty, x: drop.x, y: drop.y, expiresAt: drop.expiresAt };
          const draw = (thumb?: CraftThumb) => {
            if (liveDrops.get(id) === generation) scene.upsertWorldDrop(data, undefined, thumb);
          };
          void loadInventoryVisualCatalog().then(catalog => draw(catalog.byId.get(data.itemKey)?.thumb)).catch(() => draw());
        };
        render();
        drop.onChange?.(render);
      });
      drops.onRemove((_: any, id: string) => {
        liveDrops.delete(id);
        scene.removeWorldDrop(id);
      });
      detachDrops = () => {
        liveDrops.clear();
        scene.clearWorldDrops();
      };
    }
    inventoryListenerCleanupRef.current = () => {
      if (typeof removeInventoryChanged === 'function') removeInventoryChanged();
      if (typeof removeInventoryError === 'function') removeInventoryError();
      if (typeof removeEquipError === 'function') removeEquipError();
      // Troca de sala/mundo no meio de um drop: a ponte muda, o fluxo é abandonado.
      useInventoryUiStore.getState().finishPlacement();
      if (typeof removeCraftResult === 'function') removeCraftResult();
      if (typeof removeCraftError === 'function') removeCraftError();
      if (typeof removeAccessRequest === 'function') removeAccessRequest();
      if (typeof removeAccessUpdate === 'function') removeAccessUpdate();
      if (typeof removeProgressUpdate === 'function') removeProgressUpdate();
      if (typeof removeEatResult === 'function') removeEatResult();
      unsubscribeProgress();
      scene.onToolBlocked = null;
      scene.setEnergyState({ weak: false, speedPercent: 100 });
      useProgressStore.getState().setEating(null);
      detachDrops?.();
      detachPlaced?.();
      scene.onPlacedStationClick = null;
      setInventoryBridge(null);
      clearStationCraftBridge();
      clearEatBridge();
    };
    // Personagem do jogador: equipar/desequipar arma + aviso de "receita
    // salva" (depois da criação, o servidor recarrega do banco e publica).
    usePlayerCharacterStore.getState().setSenders(
      (equip, ref) => room.send('equip_weapon', ref === undefined ? { equip } : { equip, ref }),
      () => room.send('character_ready'),
    );

    const arenas = scene.getArenas();
    if (arenas.length > 0) {
      const payload = arenas.map((a: any) => ({ id: a.id, name: a.title, x: a.x, y: a.y, width: a.width, height: a.height }));
      registerBoards(payload);
    }

    // All players in this room are on the same map - show them unconditionally
    state.players.onAdd((player: any, sessionId: string) => {
      if (sessionId === room.sessionId) {
        // Local HP is server-authoritative: mirror it into the scene's HP bar.
        scene.updateLocalHp(player.hp ?? 100, player.maxHp || 100);
        // Aparência/arma AO VIVO do próprio jogador — o efeito do GameCanvas
        // aplica na cena quando o mundo estiver pronto.
        usePlayerCharacterStore.getState().setLive(player.appearance ?? '', player.equippedWeapon ?? '');
        player.onChange(() => {
          scene.updateLocalHp(player.hp ?? 100, player.maxHp || 100);
          usePlayerCharacterStore.getState().setLive(player.appearance ?? '', player.equippedWeapon ?? '');
        });
        updateOnlineCount(room);
        return;
      }

      const joinPayload = () => ({
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
        characterId: player.characterId || undefined,
        hp: typeof player.hp === 'number' ? player.hp : undefined,
        maxHp: typeof player.maxHp === 'number' ? player.maxHp : undefined,
        appearance: player.appearance || undefined,
        equippedWeapon: player.equippedWeapon || undefined,
      });
      scene.handlePlayerJoined(joinPayload());

      player.onChange(() => {
        // Sprite remoto ainda não existe (ex.: personagem criado depois de
        // entrar na sala)? Só então re-oferece o join. Com o sprite vivo,
        // montar o payload em toda mudança (30x/s por jogador em movimento)
        // era trabalho jogado fora — mudanças de aparência/arma/HP já são
        // tratadas pelo updateRemotePlayerState abaixo.
        if (!scene.hasRemotePlayer(sessionId)) {
          scene.handlePlayerJoined(joinPayload());
        }
        // If the server cleared this player's board (tournament teleport /
        // teardown) while our sprite still thinks it's seated, unseat and
        // snap BEFORE the regular update — otherwise the seated-skip would
        // discard the teleport position and the sprite would stay stuck at
        // the removed arena table (out-of-map from the opponent's view).
        scene.syncRemoteSeat(sessionId, (player.currentBoardId ?? '') as string, player.x, player.y);
        scene.updateRemotePlayerState(sessionId, {
          x: player.x,
          y: player.y,
          targetX: player.targetX,
          targetY: player.targetY,
          direction: player.direction,
          isMoving: player.isMoving,
          characterId: player.characterId || undefined,
          hp: typeof player.hp === 'number' ? player.hp : undefined,
          maxHp: typeof player.maxHp === 'number' ? player.maxHp : undefined,
          appearance: player.appearance || undefined,
          equippedWeapon: player.equippedWeapon || undefined,
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

    state.boards.onRemove((_board: any, boardId: string) => {
      // Tournament teardown deletes boards without resetting them. Free any
      // remote sprite still seated there and snap everyone to their current
      // authoritative position (their teleport patch may have been skipped
      // while the sprite was flagged as seated).
      state.players.forEach((p: any, sid: string) => {
        if (sid !== room.sessionId) {
          scene.syncRemoteSeat(sid, (p.currentBoardId ?? '') as string, p.x, p.y);
        }
      });
      scene.unseatRemotePlayersAtBoard(boardId);
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
        // Sync immediately: if openMatch ran before this match appeared in
        // state, player names/elos were unknown then — backfill them now
        // instead of waiting for the first onChange (first move).
        useChessStore.getState().syncFromColyseus(match);
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

    room.onMessage('tournament_teleport', (data: any) => {
      useGameStore.getState().setLastEvent('tournament_teleport');
      if (gameRef.current) {
        const worldScene = getWorldScene(gameRef.current);
        if (worldScene) {
          worldScene.deactivateOverlayInteraction();
          // No unseatPlayer() here: it would start a 400ms exit tween toward
          // the arena table that fights the teleport. teleportLocalPlayer
          // does its own seat cleanup.
          worldScene.teleportLocalPlayer(data.x, data.y);
        }
      }
    });

    room.onMessage('opponent_disconnected', (data: any) => {
      useGameStore.getState().setLastEvent('opponent_disconnected');
      useGameStore.getState().setOpponentDisconnected({
        reconnectDeadline: data.reconnectDeadline,
        matchId: data.matchId,
        boardId: data.boardId,
      });
    });

    room.onMessage('opponent_reconnected', (_data: any) => {
      useGameStore.getState().setLastEvent('opponent_reconnected');
      useGameStore.getState().setOpponentDisconnected(null);
    });

    room.onMessage('opponent_forfeited', (_data: any) => {
      useGameStore.getState().setLastEvent('opponent_forfeited');
      useGameStore.getState().setOpponentDisconnected(null);
    });

    // Tournament W.O. decided by the coordinator sweep (match never started):
    // free the seat, clear waiting UI and show the outcome toast.
    room.onMessage('tournament_wo', (data: any) => {
      useGameStore.getState().setLastEvent(`tournament_wo ${data.result}`);
      useGameStore.getState().setOpponentDisconnected(null);
      useGameStore.getState().setWoNotice({
        boardId: data.boardId || '',
        youWin: !!data.youWin,
        result: data.result || '',
      });
      const chess = useChessStore.getState();
      if (!chess.matchId && gameRef.current) {
        const worldScene = getWorldScene(gameRef.current);
        if (worldScene) {
          if (worldScene.getCurrentSeatTableId() === data.boardId) {
            worldScene.deactivateOverlayInteraction();
            worldScene.unseatPlayer();
          }
          if (data.boardId) worldScene.updateBoardStatus(data.boardId, 'idle');
        }
      }
    });

    room.onMessage('draw_offered', (_data: any) => {
      useChessStore.getState().setDrawOfferPending(true);
    });

    room.onMessage('draw_declined', (_data: any) => {
      useChessStore.getState().setDrawOfferedByUs(false);
      useChessStore.getState().setDrawNotice({ kind: 'declined' });
    });

    room.onMessage('draw_offer_rejected', (data: any) => {
      useChessStore.getState().setDrawOfferedByUs(false);
      // 'pending_exists' is a harmless race (both offered at once) — no toast;
      // the incoming offer toast is already on screen to be answered.
      if (data?.reason !== 'pending_exists') {
        useChessStore.getState().setDrawNotice({ kind: 'limit', max: data?.max });
      }
    });

    room.onMessage('match_finished', (data: any) => {
      useGameStore.getState().setLastEvent(`match_finished: ${data.result}`);
      useChessStore.getState().finishMatchFromServer(data);
      setTimeout(() => {
        // The next tournament round may have begun during the 3s grace: a new
        // match is already open, or the sprite was just re-seated (possibly
        // at the SAME table). Skipping the teardown then is critical — it
        // used to stand the winner up from the next round's board.
        const currentMatchId = useChessStore.getState().matchId;
        if (currentMatchId && currentMatchId !== data.matchId) return;

        const seatAt = (window as any).__tournamentSeatAt || 0;
        const freshlySeated = Date.now() - seatAt < 4000;

        if (gameRef.current) {
          const worldScene = getWorldScene(gameRef.current);
          if (worldScene) {
            worldScene.deactivateOverlayInteraction();
            if (!freshlySeated) {
              worldScene.unseatPlayer();
              if (data.boardId) {
                worldScene.updateBoardStatus(data.boardId, 'idle');
              }
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
          // Pass the chosen color so a black creator gets the rotated camera
          // + correct sitting sprite immediately (same look as in-match).
          worldScene.seatPlayer(data.boardId, 'player', data.seat || 'bottom', data.color === 'b' ? 'b' : 'w');
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

    // Combat: another player's attack animation (server-validated broadcast)
    room.onMessage('player_attack', (data: any) => {
      if (!data || data.sessionId === room.sessionId) return;
      scene.playRemoteAttack(data.sessionId, data.movement, data.direction);
    });

    // Combat: a hit was confirmed by the server
    room.onMessage('combat_hit', (data: any) => {
      if (!data) return;
      const isMe = data.targetSessionId === room.sessionId;
      scene.flashHitPlayer(isMe ? null : data.targetSessionId);
      scene.playHurt(isMe ? null : data.targetSessionId);
      console.log(
        `[Combat] ${data.attackerName || '?'} acertou ${isMe ? 'você' : data.targetName || '?'} (-${data.damage} HP → ${data.targetHp})`,
      );
    });

    // Combat: a player's HP reached 0 — death pose + input lock until revive
    room.onMessage('player_died', (data: any) => {
      if (!data) return;
      const isMe = data.targetSessionId === room.sessionId;
      scene.playDeath(isMe ? null : data.targetSessionId, data.respawnMs ?? 3000);
      console.log(
        `[Combat] ${isMe ? 'Você' : data.targetName || '?'} morreu` +
          `${data.attackerName ? ` (${data.attackerName})` : ''} — respawn em ${((data.respawnMs ?? 3000) / 1000).toFixed(0)}s`,
      );
    });

    // Combat: server revived a dead player at full HP
    room.onMessage('player_revived', (data: any) => {
      if (!data) return;
      scene.revivePlayer(data.sessionId === room.sessionId ? null : data.sessionId);
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
    <div className="absolute inset-0">
      {/* Phaser canvas container */}
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-hidden"
        style={{ imageRendering: 'pixelated' }}
      />
      {/* HTML player name-tag overlay — sits above canvas, no pointer events */}
      <PlayerNameTags />
      {/* Mobile: circular attack button (touch devices only) */}
      <AttackButton
        getScene={() => (gameRef.current ? getWorldScene(gameRef.current) : null)}
      />
      {/* Personagem do jogador: criação obrigatória + equipamento */}
      {showCreation && <CharacterCreationModal />}
      <ToolHotbar />
      {inventoryOpen && <CollectionInventoryPanel />}
      {skillsOpen && <SkillsPanel />}
      {dropPlacementActive && <InventoryDropPlacement />}
      {stationId && (
        <StationGamePanel
          stationId={stationId}
          placedId={stationPlacedId ?? undefined}
          onClose={closeStationPanel}
        />
      )}
      <PlacedStationOverlays />
      <PerformanceHud />
    </div>
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
