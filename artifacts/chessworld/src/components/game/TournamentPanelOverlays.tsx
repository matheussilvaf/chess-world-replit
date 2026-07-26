import { useEffect, useState, useRef, ReactNode } from 'react';
import { useTournamentRoom } from '../../hooks/useTournamentRoom';
import { useTournamentAutoSeat } from '../../hooks/useTournamentAutoSeat';
import { TournamentRegistryPanel } from '../tournament/TournamentRegistryPanel';
import { TournamentStandingsPanel, TournamentStandingsModal } from '../tournament/TournamentStandingsPanel';
import { useAuthStore } from '../../stores/authStore';
import { useGameStore } from '../../stores/gameStore';

// ── Countdown hook ──────────────────────────────────────────────────────────
function useSecondsUntil(isoTarget: string): number {
  const [secs, setSecs] = useState(() => Math.max(0, Math.ceil((new Date(isoTarget).getTime() - Date.now()) / 1000)));
  useEffect(() => {
    const tick = () => setSecs(Math.max(0, Math.ceil((new Date(isoTarget).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [isoTarget]);
  return secs;
}

// ── Round countdown pill ────────────────────────────────────────────────────
function RoundCountdown({ nextRoundAt, round }: { nextRoundAt: string; round: number }) {
  const secs = useSecondsUntil(nextRoundAt);
  if (secs <= 0) return null;
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[700] pointer-events-none">
      <div className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-slate-900/95 border border-emerald-500/40 shadow-xl shadow-black/50 backdrop-blur-sm">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-sm font-medium text-slate-200">
          Round {round} começa em{' '}
          <span className="tabular-nums font-bold text-emerald-400">{secs}s</span>
        </span>
      </div>
    </div>
  );
}

// ── Waiting-for-opponent pill ───────────────────────────────────────────────
function WaitingForOpponentPill({ deadline }: { deadline: string }) {
  const secs = useSecondsUntil(deadline);
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[700] pointer-events-none">
      <div className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-slate-900/95 border border-amber-500/40 shadow-xl shadow-black/50 backdrop-blur-sm">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-sm font-medium text-slate-200">
          Aguardando adversário…
          {secs > 0 && (
            <> W.O. em <span className="tabular-nums font-bold text-amber-400">{secs}s</span></>
          )}
        </span>
      </div>
    </div>
  );
}

// ── Opponent disconnected overlay ───────────────────────────────────────────
function OpponentDisconnectedOverlay({ reconnectDeadline }: { reconnectDeadline: string }) {
  const secs = useSecondsUntil(reconnectDeadline);
  return (
    <div className="fixed inset-0 z-[800] flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl bg-slate-900/95 border border-amber-500/30 shadow-2xl shadow-black/60 backdrop-blur-sm max-w-xs text-center">
        <span className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
        <p className="text-sm font-semibold text-white">Aguardando o jogador se conectar novamente</p>
        {secs > 0 ? (
          <p className="text-xs text-slate-400">
            W.O. automático em{' '}
            <span className="tabular-nums font-bold text-amber-400">{secs}s</span>
          </p>
        ) : (
          <p className="text-xs text-slate-400">Processando resultado…</p>
        )}
      </div>
    </div>
  );
}

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
  children: ReactNode;
}

function ScaledAnchorPanel({ rect, baseWidth, children }: ScaledAnchorPanelProps) {
  // Fill the ENTIRE anchor rect: uniform scale locked to the rect width, and
  // the content box made exactly rect.height/scale tall — no letterboxing.
  // (Math.min of both axes left wide anchors with big empty side margins.)
  const scale = rect.width / baseWidth;
  const innerHeight = scale > 0 ? rect.height / scale : 0;

  return (
    <div
      className="fixed z-[600]"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    >
      <div
        className="rounded-lg border border-slate-700/80 bg-slate-900/95 backdrop-blur-sm shadow-xl shadow-black/40 overflow-hidden"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: baseWidth,
          height: innerHeight,
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
const STANDINGS_BASE_WIDTH = 280;

export function TournamentPanelOverlays() {
  const { user } = useAuthStore();
  const { state, connected, connect, register, unregister } = useTournamentRoom();
  const [panelRects, setPanelRects] = useState<{ registry?: PanelRect; standings?: PanelRect } | null>(null);
  const [standingsModalOpen, setStandingsModalOpen] = useState(false);
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

  // Must be called before any early returns (Rules of Hooks).
  const opponentDisconnected = useGameStore(s => s.opponentDisconnected);
  const woNotice = useGameStore(s => s.woNotice);

  // The W.O. toast must survive the early returns below — the notified player
  // may be anywhere (plaza, reception) when the walkover is decided.
  const woToast = woNotice ? <TournamentWoToast notice={woNotice} /> : null;

  if (!panelRects || !connected) return woToast;
  if (state.status === 'idle' && !state.startsAt) return woToast;

  const registryRect = panelRects.registry;
  const standingsRect = panelRects.standings;

  // ── Overlay logic ─────────────────────────────────────────────────────────

  // Round countdown: show when between_rounds and server wrote a nextRoundAt
  const showRoundCountdown = state.status === 'between_rounds' && !!state.nextRoundAt;

  // Waiting for opponent: current user has a pairing for this round with a
  // presence deadline set but the match has not started yet.
  const myPairing = state.currentRound > 0 ? state.pairings.find(p =>
    p.roundNumber === state.currentRound &&
    !p.isBye &&
    (p.whitePlayerId === user?.id || p.blackPlayerId === user?.id) &&
    !!p.presenceDeadline &&
    !p.startedAt &&
    // A decided pairing (W.O. written) must kill the waiting pill instantly
    !p.result
  ) : undefined;
  const showWaitingForOpponent =
    state.status === 'round_active' && !!myPairing && !opponentDisconnected;
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      {registryRect && registryRect.width > 20 && registryRect.height > 20 && (
        <ScaledAnchorPanel rect={registryRect} baseWidth={REGISTRY_BASE_WIDTH}>
          <TournamentRegistryPanel
            state={state}
            userId={user?.id || null}
            onRegister={register}
            onUnregister={unregister}
          />
        </ScaledAnchorPanel>
      )}
      {standingsRect && standingsRect.width > 20 && standingsRect.height > 20 && (
        <ScaledAnchorPanel rect={standingsRect} baseWidth={STANDINGS_BASE_WIDTH}>
          <TournamentStandingsPanel
            state={state}
            onExpandStandings={state.standings.length > 0 ? () => setStandingsModalOpen(true) : undefined}
          />
        </ScaledAnchorPanel>
      )}
      {standingsModalOpen && state.standings.length > 0 && (
        <TournamentStandingsModal
          title={state.status === 'registration_open' ? 'Ultimo Torneio' : state.status === 'completed' ? 'Classificacao Final' : 'Classificacao'}
          state={state}
          onClose={() => setStandingsModalOpen(false)}
        />
      )}
      {showRoundCountdown && (
        <RoundCountdown nextRoundAt={state.nextRoundAt} round={state.currentRound} />
      )}
      {showWaitingForOpponent && myPairing && (
        <WaitingForOpponentPill deadline={myPairing.presenceDeadline} />
      )}
      {opponentDisconnected && (
        <OpponentDisconnectedOverlay reconnectDeadline={opponentDisconnected.reconnectDeadline} />
      )}
      {woToast}
    </>
  );
}

function TournamentWoToast({ notice }: { notice: { boardId: string; youWin: boolean; result: string } }) {
  const setWoNotice = useGameStore(s => s.setWoNotice);

  useEffect(() => {
    const t = setTimeout(() => setWoNotice(null), 7000);
    return () => clearTimeout(t);
  }, [notice, setWoNotice]);

  const isDouble = notice.result === '-/-';
  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[900] rounded-lg border border-amber-500/60 bg-slate-900/95 px-4 py-3 shadow-xl shadow-black/50 pointer-events-none">
      <div className="text-sm font-semibold text-amber-300">
        {isDouble ? 'W.O. duplo' : notice.youWin ? 'Vitória por W.O.!' : 'Derrota por W.O.'}
      </div>
      <div className="text-xs text-slate-300 mt-0.5">
        {isDouble
          ? 'Nenhum jogador compareceu — mesa liberada.'
          : notice.youWin
            ? 'Seu adversário não compareceu. Ponto para você!'
            : 'Você não compareceu a tempo.'}
      </div>
    </div>
  );
}
