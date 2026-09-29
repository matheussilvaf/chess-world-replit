import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Flag, LogOut, Puzzle, RotateCcw, X } from 'lucide-react';
import {
  BATTLE_MODE_INFO, PUZZLE_BAND_INFO, dailyRewardFor, puzzleDifficultyLabel, puzzleMainThemes, puzzleThemeLabel,
  type BattleEndReason, type BattlePlayerView,
} from '../../../shared/academy/PuzzleShapes';
import { useNow } from '../../../hooks/useNow';
import { dismissBattle, sendBattleLeave } from '../../../game/network/battleHandlers';
import { leaveDailyTable } from '../../../game/network/puzzleHandlers';
import { useAuthStore } from '../../../stores/authStore';
import { battleServerTime, useBattleStore } from '../../../stores/battleStore';
import { useGameStore } from '../../../stores/gameStore';
import { usePuzzleSessionStore, type PuzzlePhase } from '../../../stores/puzzleSessionStore';
import { usePuzzleStore } from '../../../stores/puzzleStore';
import { usePuzzleTable } from './usePuzzleTable';

const REASONS: Record<BattleEndReason, string> = {
  time: 'Tempo esgotado', score: 'Pontuação', lives: 'Vidas', clock: 'Relógio',
  both_done: 'Ambos terminaram', forfeit: 'Desistência', all_puzzles: 'Todos os puzzles concluídos', aborted: 'Batalha interrompida',
};

function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function hearts(lives: number, max = 3): string {
  return '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, max - lives));
}
function phaseText(phase: PuzzlePhase, moveNumber: number, total: number, overReason?: string): { text: string; tone: string } {
  switch (phase) {
    case 'setup': return { text: 'Lance de preparação…', tone: 'text-slate-300' };
    case 'waiting': return { text: 'Verificando lance…', tone: 'text-amber-300' };
    case 'reply': return { text: 'Resposta do adversário…', tone: 'text-slate-300' };
    case 'wrong': return { text: 'Lance errado', tone: 'text-red-400' };
    case 'solved': return { text: 'Resolvido!', tone: 'text-emerald-400' };
    case 'solution': return { text: 'Sem vidas — veja a solução', tone: 'text-red-400' };
    case 'over': return { text: overReason === 'opponent_first' ? 'Adversário resolveu antes' : overReason === 'timeout' ? 'Tempo esgotado' : 'Errou', tone: 'text-red-400' };
    default: return { text: `Sua vez · lance ${moveNumber} de ${total}`, tone: 'text-emerald-400' };
  }
}

function PieceDot({ color }: { color: 'w' | 'b' }) {
  return <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${color === 'w' ? 'border border-slate-300 bg-white' : 'border border-slate-400 bg-slate-950'}`} />;
}

/** Cartão compacto no estilo do relógio das partidas (canto superior = adversário, inferior = jogador). */
function Chip({ active, clickable, onClick, children, testId }: { active?: boolean; clickable?: boolean; onClick?: () => void; children: ReactNode; testId?: string }) {
  return <button type="button" data-testid={testId} onClick={clickable ? onClick : undefined} disabled={!clickable}
    className={`flex min-w-[7.5rem] max-w-[13rem] flex-col items-start rounded-xl border px-3 py-2 text-left shadow-xl backdrop-blur-sm transition-all duration-300 select-none ${
      active ? 'border-emerald-500/60 bg-slate-800/95' : 'border-slate-700/50 bg-slate-900/90'
    } ${clickable ? 'cursor-pointer hover:border-slate-500/70 active:scale-[0.98]' : 'cursor-default'}`}>
    {children}
  </button>;
}

function OptionsCard({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return <div className="absolute bottom-full left-0 z-10 mb-2 animate-[hud-toast-in_0.2s_cubic-bezier(0.16,1,0.3,1)]">
    <div className="min-w-[170px] overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-700/50 px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Opções</span>
        <button type="button" onClick={onClose} className="rounded p-0.5 text-slate-500 transition-colors hover:text-white" aria-label="Fechar opções"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="flex flex-col gap-1.5 p-2">{children}</div>
    </div>
  </div>;
}
const optionButton = 'flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-colors';

function Toast({ bottom = 76, tone = 'border-slate-600/60', children, testId }: { bottom?: number; tone?: string; children: ReactNode; testId?: string }) {
  return <div className="pointer-events-auto fixed left-1/2 z-[220] -translate-x-1/2" style={{ bottom }} data-testid={testId}>
    <div className={`animate-[hud-toast-in_0.3s_cubic-bezier(0.16,1,0.3,1)] flex flex-col items-center gap-2 rounded-2xl border bg-slate-900/95 px-4 py-3 text-center shadow-2xl backdrop-blur-md ${tone}`}>
      {children}
    </div>
  </div>;
}
const primaryButton = 'rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 active:scale-95 transition-all';
const ghostButton = 'rounded-xl border border-slate-600 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 active:scale-95 transition-all';

function BattleStats({ player, elapsed }: { player: BattlePlayerView; elapsed: number }) {
  return <>
    <span className="text-[11px] leading-none text-slate-300">{player.done ? 'Terminou' : `Puzzle nº ${player.index + 1}`}{player.offline ? ' · offline' : ''}</span>
    <div className="mt-1.5 flex items-center gap-2 font-mono text-[13px] font-bold tabular-nums leading-none">
      <span className="text-emerald-400">✓{player.solved}</span>
      <span className="text-red-400">✗{player.failed}</span>
      {player.lives !== undefined && <span className="text-rose-400">{hearts(player.lives)}</span>}
      {player.points !== undefined && <span className="text-amber-300">{player.points} pt</span>}
      {player.clockMs !== undefined && <span className={player.clockMs - elapsed < 10_000 ? 'text-red-400' : 'text-slate-200'}>{clock(player.clockMs - elapsed)}</span>}
    </div>
  </>;
}

export function PuzzleHUD({ onLeaveDaily = leaveDailyTable, onOpenDaily, onForfeit = sendBattleLeave, onDismissBattle = dismissBattle }: {
  onLeaveDaily?: () => void;
  /** Reabre o painel de slots (padrão: seleciona a mesa no gameStore, que abre o BoardModal). */
  onOpenDaily?: (boardId: string) => void;
  onForfeit?: (battleId: string) => void;
  onDismissBattle?: () => void;
}) {
  const table = usePuzzleTable();
  const puzzle = usePuzzleSessionStore((s) => s.puzzle);
  const phase = usePuzzleSessionStore((s) => s.phase);
  const moveNumber = usePuzzleSessionStore((s) => s.moveNumber);
  const feedback = usePuzzleSessionStore((s) => s.feedback);
  const solutionStep = usePuzzleSessionStore((s) => s.solutionStep);
  const daily = usePuzzleStore((s) => s.daily);
  const dailyOpen = usePuzzleStore((s) => s.dailyOpen);
  const receivedAt = useBattleStore((s) => s.receivedAt);
  const myName = useAuthStore((s) => s.profile?.username) ?? 'Você';
  const [showOptions, setShowOptions] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const battle = table?.battle ?? null;
  const now = useNow(200, !!battle && battle.phase !== 'finished');

  useEffect(() => { setShowOptions(false); }, [table?.kind, table?.boardId, battle?.phase]);
  useEffect(() => {
    if (!showOptions) return;
    const onDown = (e: MouseEvent | TouchEvent) => { if (!optionsRef.current?.contains(e.target as Node)) setShowOptions(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('touchstart', onDown);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('touchstart', onDown); };
  }, [showOptions]);

  if (!table || dailyOpen) return null;
  const hasPuzzle = !!puzzle && puzzle.boardId === table.boardId;
  const myColor = table.orientation;
  const oppColor = myColor === 'w' ? 'b' : 'w';
  const status = hasPuzzle ? phaseText(phase, moveNumber, puzzle.solutionLength, feedback?.puzzleOverReason) : null;
  const solution = feedback?.solutionMoves;
  const openDaily = () => {
    if (onOpenDaily) { onOpenDaily(table.boardId); return; }
    // Mesmo formato usado pelo clique na mesa (GameCanvas.onBoardClick): o BoardModal abre o painel de slots.
    useGameStore.getState().setSelectedBoard({
      id: table.boardId, name: 'Puzzle do dia', region: useAuthStore.getState().profile?.current_region ?? '', x: 0, y: 0, status: 'free',
      waiting_user_id: null, current_match_id: null, time_minutes: null, increment_seconds: null, created_at: '', updated_at: '',
    });
  };

  // ── Puzzle do dia ─────────────────────────────────────────────────────────
  if (table.kind === 'daily') {
    const slot = hasPuzzle && puzzle.context.kind === 'daily' ? puzzle.context.slot : null;
    const slotView = slot ? daily?.slots.find((s) => s.slot === slot) : undefined;
    const lives = feedback?.livesLeft ?? puzzle?.livesLeft;
    const finished = phase === 'solved' || (phase === 'solution' && !!solution && solutionStep >= solution.length) || (feedback?.dailyStatus === 'failed' && phase !== 'wrong');
    const inProgress = hasPuzzle && !finished;
    const themes = hasPuzzle && daily?.showThemes !== false ? puzzleMainThemes(puzzle.themes) : [];
    return <>
      <div className="pointer-events-none fixed left-3 top-3 z-[200] flex flex-col items-start gap-1.5" data-testid="puzzle-hud-daily">
        <Chip active={hasPuzzle && (phase === 'reply' || phase === 'setup')}>
          <div className="flex w-full items-center gap-1.5">
            <PieceDot color={oppColor} />
            <span className="truncate text-[11px] font-semibold leading-none text-white">Puzzle do dia</span>
            {slot && <span className="flex-shrink-0 text-[10px] leading-none text-slate-400">· slot {slot}</span>}
          </div>
          <span className="mt-1.5 text-[11px] leading-none text-slate-300">
            {hasPuzzle ? `${puzzleDifficultyLabel(puzzle.rating)} (${puzzle.rating})` : 'Escolha um puzzle'}
          </span>
          {status && <span role="status" className={`mt-1.5 text-[11px] font-semibold leading-none ${status.tone}`}>{status.text}</span>}
        </Chip>
        {themes.length > 0 && <div className="flex max-w-[13rem] flex-wrap gap-1">
          {themes.map((theme) => <span key={theme} className="rounded-md border border-slate-700/60 bg-slate-900/85 px-1.5 py-0.5 text-[10px] text-slate-300">{puzzleThemeLabel(theme)}</span>)}
        </div>}
      </div>

      <div className="pointer-events-auto fixed bottom-4 left-4 z-[200] flex flex-col items-start gap-1.5">
        <div ref={optionsRef} className="relative">
          {showOptions && <OptionsCard onClose={() => setShowOptions(false)}>
            {!inProgress && <button type="button" data-testid="puzzle-another" onClick={() => { setShowOptions(false); openDaily(); }} className={`${optionButton} bg-amber-500 text-slate-950 hover:bg-amber-400`}>
              <Puzzle className="h-4 w-4 flex-shrink-0" />Outro puzzle</button>}
            <button type="button" data-testid="puzzle-leave" onClick={() => { setShowOptions(false); onLeaveDaily(); }} className={`${optionButton} bg-red-600 hover:bg-red-500 active:bg-red-700`}>
              <LogOut className="h-4 w-4 flex-shrink-0" />Levantar</button>
          </OptionsCard>}
          <Chip active={hasPuzzle && phase === 'ready'} clickable onClick={() => setShowOptions((v) => !v)} testId="puzzle-me-chip">
            <div className="flex w-full items-center gap-1.5">
              <PieceDot color={myColor} />
              <span className="truncate text-[11px] font-semibold leading-none text-white">{myName}</span>
              {hasPuzzle && <span className="flex-shrink-0 text-[10px] leading-none text-slate-400">({myColor === 'w' ? 'Brancas' : 'Pretas'})</span>}
            </div>
            <div className="mt-1.5 flex items-center gap-2 font-mono text-[14px] font-bold tabular-nums leading-none">
              <span className="text-rose-400" aria-label={`${lives ?? 0} vidas`}>{hearts(lives ?? 0)}</span>
              {hasPuzzle && <span className={phase === 'ready' ? 'text-emerald-400' : 'text-slate-400'}>{Math.min(moveNumber, puzzle.solutionLength)}/{puzzle.solutionLength}</span>}
            </div>
            {hasPuzzle && slotView && !finished && lives !== undefined && <span className="mt-1.5 text-[10px] leading-none text-amber-300">até {dailyRewardFor(slotView.rewardGambits, lives)} Gambitos</span>}
          </Chip>
        </div>
      </div>

      {hasPuzzle && phase === 'wrong' && <Toast tone="border-red-500/50" testId="puzzle-toast-wrong">
        <p className="text-xs font-semibold text-red-300">Lance errado</p>
        {lives !== undefined && <p className="text-[10px] text-slate-400">{lives > 0 ? `${lives} ${lives === 1 ? 'vida restante' : 'vidas restantes'} · o puzzle recomeça` : 'Sem vidas'}</p>}
      </Toast>}
      {hasPuzzle && phase === 'solved' && <Toast tone="border-emerald-500/50" testId="puzzle-toast-solved">
        <p className="text-sm font-bold text-emerald-300">Resolvido! +{feedback?.rewardGambits ?? 0} Gambitos</p>
        <div className="flex gap-2"><button type="button" onClick={openDaily} className={primaryButton}>Outro puzzle</button>
          <button type="button" onClick={onLeaveDaily} className={ghostButton}>Levantar</button></div>
      </Toast>}
      {hasPuzzle && phase === 'solution' && solution && <Toast tone="border-red-500/40" testId="puzzle-toast-solution">
        <p className="text-xs font-semibold text-red-300">Sem vidas — veja a solução</p>
        <div className="flex items-center gap-2 text-xs text-slate-200">
          <button type="button" aria-label="Lance anterior" disabled={solutionStep === 0} onClick={() => usePuzzleSessionStore.getState().setSolutionStep(solutionStep - 1)} className="rounded-lg border border-slate-600/40 bg-slate-700/50 p-1.5 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <span className="font-mono">Solução {solutionStep}/{solution.length}</span>
          <button type="button" aria-label="Próximo lance" disabled={solutionStep >= solution.length} onClick={() => usePuzzleSessionStore.getState().setSolutionStep(solutionStep + 1)} className="rounded-lg border border-slate-600/40 bg-slate-700/50 p-1.5 disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label="Repetir" onClick={() => usePuzzleSessionStore.getState().setSolutionStep(0)} className="rounded-lg border border-slate-600/40 bg-slate-700/50 p-1.5"><RotateCcw className="h-3.5 w-3.5" /></button>
        </div>
        <div className="flex gap-2"><button type="button" onClick={openDaily} className={primaryButton}>Outro puzzle</button>
          <button type="button" onClick={onLeaveDaily} className={ghostButton}>Levantar</button></div>
      </Toast>}
    </>;
  }

  // ── Batalha ───────────────────────────────────────────────────────────────
  if (!battle) return null;
  const serverTime = battleServerTime({ battle, receivedAt }, now);
  const elapsed = battle.phase === 'running' ? Math.max(0, serverTime - battle.serverNow) : 0;
  const finished = battle.phase === 'finished';
  const timer = battle.endsAt !== undefined ? clock(battle.endsAt - serverTime)
    : battle.bestOf ? `${battle.bestOf.current + 1}/${battle.bestOf.total} · ${clock(battle.bestOf.deadlineAt - serverTime)}` : '';
  const outcome = battle.result?.winnerId === '' ? 'Empate' : battle.result?.winnerId === battle.me.playerId ? 'Você venceu!' : 'Você perdeu';
  return <>
    <div className="pointer-events-none fixed left-3 top-3 z-[200] flex flex-col items-start gap-1.5" data-testid="puzzle-hud-battle">
      <Chip active={!finished && !battle.opponent.done}>
        <div className="flex w-full items-center gap-1.5">
          <PieceDot color={oppColor} />
          <span className="truncate text-[11px] font-semibold leading-none text-white">{battle.opponent.name}</span>
        </div>
        <div className="mt-1.5"><BattleStats player={battle.opponent} elapsed={elapsed} /></div>
      </Chip>
    </div>

    <div className="pointer-events-none fixed left-1/2 top-3 z-[200] -translate-x-1/2">
      <div className="flex flex-col items-center rounded-xl border border-amber-500/40 bg-slate-900/90 px-3 py-1.5 shadow-xl backdrop-blur-sm">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">{BATTLE_MODE_INFO[battle.mode].label} · {PUZZLE_BAND_INFO[battle.band].label}</span>
        {!finished && timer && <span className="font-mono text-lg font-bold tabular-nums leading-none text-amber-200" data-testid="battle-timer">{timer}</span>}
        {status && !finished && <span role="status" className={`mt-1 text-[11px] font-semibold leading-none ${status.tone}`}>{status.text}</span>}
      </div>
    </div>

    <div className="pointer-events-auto fixed bottom-4 left-4 z-[200] flex flex-col items-start gap-1.5">
      <div ref={optionsRef} className="relative">
        {showOptions && <OptionsCard onClose={() => setShowOptions(false)}>
          {!finished && <button type="button" data-testid="battle-forfeit" onClick={() => { setShowOptions(false); if (window.confirm('Desistir desta batalha?')) onForfeit(battle.battleId); }} className={`${optionButton} bg-red-600 hover:bg-red-500 active:bg-red-700`}>
            <Flag className="h-4 w-4 flex-shrink-0" />Desistir</button>}
          {finished && <button type="button" onClick={() => { setShowOptions(false); onDismissBattle(); }} className={`${optionButton} bg-amber-500 text-slate-950 hover:bg-amber-400`}>
            <LogOut className="h-4 w-4 flex-shrink-0" />Levantar</button>}
        </OptionsCard>}
        <Chip active={!finished && hasPuzzle && phase === 'ready'} clickable onClick={() => setShowOptions((v) => !v)} testId="puzzle-me-chip">
          <div className="flex w-full items-center gap-1.5">
            <PieceDot color={myColor} />
            <span className="truncate text-[11px] font-semibold leading-none text-white">{myName}</span>
          </div>
          <div className="mt-1.5"><BattleStats player={battle.me} elapsed={elapsed} /></div>
          {hasPuzzle && !finished && <span className="mt-1.5 text-[10px] leading-none text-slate-400">{puzzleDifficultyLabel(puzzle.rating)} ({puzzle.rating}) · lance {Math.min(moveNumber, puzzle.solutionLength)}/{puzzle.solutionLength}</span>}
        </Chip>
      </div>
    </div>

    {hasPuzzle && battle.showThemes && puzzle.themes.length > 0 && !finished && <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex max-w-[12rem] flex-wrap justify-end gap-1">
      {puzzleMainThemes(puzzle.themes).map((theme) => <span key={theme} className="rounded-md border border-slate-700/60 bg-slate-900/85 px-1.5 py-0.5 text-[10px] text-slate-300">{puzzleThemeLabel(theme)}</span>)}
    </div>}

    {!finished && hasPuzzle && (phase === 'wrong' || phase === 'over' || phase === 'solved') && status && <Toast tone={phase === 'solved' ? 'border-emerald-500/50' : 'border-red-500/50'} testId="battle-toast">
      <p className={`text-xs font-semibold ${status.tone}`}>{status.text}</p>
      {battle.me.done ? <p className="text-[10px] text-slate-400">Você terminou — aguardando o adversário</p> : <p className="text-[10px] text-slate-400">Próximo puzzle…</p>}
    </Toast>}

    {finished && <div className="fixed inset-0 z-[230] flex items-center justify-center p-4 pointer-events-none">
      <section role="dialog" aria-label="Resultado da batalha" data-testid="battle-result" className="pointer-events-auto w-full max-w-sm space-y-3 rounded-2xl border border-amber-500/50 bg-slate-900/95 p-5 text-center text-white shadow-2xl backdrop-blur-md">
        <h3 className="text-3xl font-black text-amber-300">{outcome}</h3>
        <p className="text-xs text-slate-300">Motivo: {REASONS[battle.result?.reason ?? 'aborted']}</p>
        <div className="grid grid-cols-2 gap-2 text-left">
          {[battle.me, battle.opponent].map((player) => <div key={player.playerId} className="rounded-xl border border-slate-700 bg-slate-800/80 p-3">
            <p className="truncate text-xs font-semibold">{player.name}</p>
            <BattleStats player={player} elapsed={0} />
          </div>)}
        </div>
        <p className="text-lg font-bold text-emerald-300">{battle.result?.myRewardGambits ? `+${battle.result.myRewardGambits} Gambitos` : 'Sem recompensa'}</p>
        <button type="button" data-testid="battle-dismiss" onClick={onDismissBattle} className="w-full rounded-xl bg-amber-500 py-2.5 font-bold text-slate-950 hover:bg-amber-400">Fechar</button>
      </section>
    </div>}
  </>;
}
