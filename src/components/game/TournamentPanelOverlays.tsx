import { useEffect, useState, useRef, ReactNode } from 'react';
import { useTournamentRoom } from '../../hooks/useTournamentRoom';
import { useTournamentAutoSeat } from '../../hooks/useTournamentAutoSeat';
import { TournamentRegistryPanel } from '../tournament/TournamentRegistryPanel';
import { TournamentStandingsPanel } from '../tournament/TournamentStandingsPanel';
import { useAuthStore } from '../../stores/authStore';

interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const RECT_TOLERANCE = 0.25;

function rectsEqual(a: PanelRect | undefined, b: PanelRect | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < RECT_TOLERANCE &&
    Math.abs(a.y - b.y) < RECT_TOLERANCE &&
    Math.abs(a.width - b.width) < RECT_TOLERANCE &&
    Math.abs(a.height - b.height) < RECT_TOLERANCE
  );
}

interface ScaledAnchorPanelProps {
  rect: PanelRect;
  baseWidth: number;
  baseHeight: number;
  children: ReactNode;
}

function ScaledAnchorPanel({ rect, baseWidth, baseHeight, children }: ScaledAnchorPanelProps) {
  const scaleX = rect.width / baseWidth;
  const scaleY = rect.height / baseHeight;
  const scale = Math.min(scaleX, scaleY);

  const scaledW = baseWidth * scale;
  const scaledH = baseHeight * scale;
  const offsetX = (rect.width - scaledW) / 2;
  const offsetY = (rect.height - scaledH) / 2;

  return (
    <div
      className="fixed z-[600] overflow-hidden"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    >
      <div
        className="rounded-lg border border-slate-700/80 bg-slate-900/95 backdrop-blur-sm shadow-xl shadow-black/40"
        style={{
          position: 'absolute',
          left: offsetX,
          top: offsetY,
          width: baseWidth,
          height: baseHeight,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {children}
      </div>
    </div>
  );
}

const REGISTRY_BASE_WIDTH = 240;
const REGISTRY_BASE_HEIGHT = 320;
const STANDINGS_BASE_WIDTH = 280;
const STANDINGS_BASE_HEIGHT = 380;

export function TournamentPanelOverlays() {
  const { user } = useAuthStore();
  const { state, connected, connect, register, unregister } = useTournamentRoom();
  const [panelRects, setPanelRects] = useState<{ registry?: PanelRect; standings?: PanelRect } | null>(null);
  const [inReception, setInReception] = useState(false);
  const prevDoorOpen = useRef(false);
  const prevModules = useRef<string>('');
  const prevRegistry = useRef<PanelRect | undefined>(undefined);
  const prevStandings = useRef<PanelRect | undefined>(undefined);

  useEffect(() => {
    let frameId: number;
    const poll = () => {
      const rects = (window as any).__tournamentPanelRects;
      if (rects && (rects.registry || rects.standings)) {
        const newRegistry = rects.registry as PanelRect | undefined;
        const newStandings = rects.standings as PanelRect | undefined;
        if (
          !rectsEqual(newRegistry, prevRegistry.current) ||
          !rectsEqual(newStandings, prevStandings.current)
        ) {
          prevRegistry.current = newRegistry;
          prevStandings.current = newStandings;
          setPanelRects({ registry: newRegistry, standings: newStandings });
        }
        if (!inReception) setInReception(true);
      } else {
        if (prevRegistry.current || prevStandings.current) {
          prevRegistry.current = undefined;
          prevStandings.current = undefined;
          setPanelRects(null);
        }
        if (inReception) setInReception(false);
      }
      frameId = requestAnimationFrame(poll);
    };
    frameId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frameId);
  }, [inReception]);

  useEffect(() => {
    if (inReception && user && !connected) {
      connect();
    }
  }, [inReception, user, connected, connect]);

  useEffect(() => {
    if (!inReception || !connected) return;
    const scene = (window as any).__worldScene;
    if (!scene) return;

    const shouldOpenDoor = state.doorOpen;
    if (shouldOpenDoor !== prevDoorOpen.current) {
      prevDoorOpen.current = shouldOpenDoor;
      if (typeof scene.setDoorState === 'function') {
        scene.setDoorState(shouldOpenDoor);
      }
    }

    const shouldDismount = state.status === 'finalizing' || state.status === 'completed'
      || state.status === 'registration_open' || state.status === 'idle'
      || state.status === 'cancelled_insufficient_players' || state.status === 'starting';

    if (shouldDismount) {
      if (prevModules.current !== '') {
        prevModules.current = '';
        if (typeof scene.removeArenaModules === 'function') {
          scene.removeArenaModules();
        }
      }
      return;
    }

    if (state.status !== 'round_active' && state.status !== 'between_rounds') return;

    const layoutKey = JSON.stringify({ modules: state.modules, tables: state.tables });

    if (state.status === 'between_rounds') {
      if (prevModules.current === '' && state.modules.length > 0 && state.tables.length > 0) {
        prevModules.current = layoutKey;
        if (typeof scene.loadArenaModules === 'function') {
          try { scene.loadArenaModules(state.modules, state.tables); } catch (err) {
            console.error('[TournamentPanelOverlays] loadArenaModules error:', err);
          }
        }
      }
      return;
    }

    if (layoutKey === prevModules.current) return;
    if (state.currentRound <= 0) return;
    if (state.modules.length === 0 || state.tables.length === 0) return;

    const currentPairings = state.pairings.filter(p => p.roundNumber === state.currentRound && !p.isBye);
    if (currentPairings.length === 0) return;

    const allHaveRuntime = currentPairings.every(p => !!p.runtimeTableId);
    if (!allHaveRuntime) return;

    const tableSet = new Set(state.tables.map(t => t.runtimeTableId));
    const allInTables = currentPairings.every(p => tableSet.has(p.runtimeTableId));
    if (!allInTables) return;

    prevModules.current = layoutKey;
    if (typeof scene.loadArenaModules === 'function') {
      try {
        scene.loadArenaModules(state.modules, state.tables);
      } catch (err) {
        console.error('[TournamentPanelOverlays] loadArenaModules error:', err);
      }
    }
  }, [state.doorOpen, state.modules, state.tables, state.pairings, state.currentRound, state.status, inReception, connected]);

  useTournamentAutoSeat(state, connected);

  if (!panelRects || !connected) return null;
  if (state.status === 'idle' && !state.startsAt) return null;

  const registryRect = panelRects.registry;
  const standingsRect = panelRects.standings;

  return (
    <>
      {registryRect && registryRect.width > 20 && registryRect.height > 20 && (
        <ScaledAnchorPanel
          rect={registryRect}
          baseWidth={REGISTRY_BASE_WIDTH}
          baseHeight={REGISTRY_BASE_HEIGHT}
        >
          <TournamentRegistryPanel
            state={state}
            userId={user?.id || null}
            onRegister={register}
            onUnregister={unregister}
          />
        </ScaledAnchorPanel>
      )}
      {standingsRect && standingsRect.width > 20 && standingsRect.height > 20 && (
        <ScaledAnchorPanel
          rect={standingsRect}
          baseWidth={STANDINGS_BASE_WIDTH}
          baseHeight={STANDINGS_BASE_HEIGHT}
        >
          <TournamentStandingsPanel state={state} />
        </ScaledAnchorPanel>
      )}
    </>
  );
}
