import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Flag, LogOut, Pause, Play, Puzzle, RotateCcw, X } from 'lucide-react';
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

/**
 * Cartão de jogador: UMA linha (cor · nome · números), largura fluida.
 * Os dois cartões da batalha dividem a base da tela lado a lado (`flex-1` +
 * `min-w-0`), então nunca se sobrepõem — no celular o nome é truncado e os
 * números continuam inteiros.
 */
function PlayerCard({ active, clickable, onClick, children, testId, color, name, tag }: {
  active?: boolean; clickable?: boolean; onClick?: () => void; children?: ReactNode; testId?: string; color: 'w' | 'b'; name: string; tag?: string;
}) {
  return <button type="button" data-testid={testId} onClick={clickable ? onClick : undefined} disabled={!clickable}
    className={`flex w-full min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left shadow-xl backdrop-blur-sm transition-all duration-300 select-none ${
      active ? 'border-emerald-500/60 bg-slate-800/95' : 'border-slate-700/50 bg-slate-900/90'
    } ${clickable ? 'cursor-pointer hover:border-slate-500/70 active:scale-[0.98]' : 'cursor-default'}`}>
    <PieceDot color={color} />
    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-none text-white">{name}{tag && <span className="ml-1 font-normal text-slate-400">{tag}</span>}</span>
    {children && <span className="flex flex-shrink-0 items-center gap-1.5 font-mono text-[12px] font-bold tabular-nums leading-none">{children}</span>}
  </button>;
}

/** Linha da base: meu cartão à esquerda, adversário à direita, cada um com no máximo metade da largura. */
function BottomRow({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[200] flex items-end justify-between gap-2 sm:inset-x-4 sm:bottom-4">
    <div className="pointer-events-auto flex min-w-0 flex-1 basis-0 justify-start sm:max-w-[18rem]">{left}</div>
    {right && <div className="pointer-events-auto flex min-w-0 flex-1 basis-0 justify-end sm:max-w-[18rem]">{right}</div>}
  </div>;
}

/** Substitui o cartão inferior durante solução/conclusão, sem ocupar o tabuleiro. */
function BottomStrip({ children, testId, tone = 'border-slate-600/60' }: { children: ReactNode; testId: string; tone?: string }) {
  return <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[220] flex justify-center" data-testid={testId}>
    <div className={`pointer-events-auto flex min-h-10 w-full items-center justify-between gap-1 border-t bg-slate-900/95 px-2 py-1 text-xs text-white shadow-2xl backdrop-blur-md sm:px-4 ${tone}`}>
      {children}
    </div>
  </div>;
}
const stripButton = 'flex h-7 flex-shrink-0 items-center justify-center rounded-md border border-slate-600/60 bg-slate-800 px-1.5 font-semibold text-slate-100 disabled:opacity-40 hover:bg-slate-700';

/** Cartão central do topo: o único elemento lá em cima (modo, tempo, nível/tema e status). */
function TopCard({ title, timer, meta, status, testId }: { title: string; timer?: string; meta?: string; status?: { text: string; tone: string } | null; testId?: string }) {
  return <div className="pointer-events-none fixed inset-x-3 top-3 z-[200] flex justify-center" data-testid={testId}>
    <div className="flex max-w-full flex-col items-center rounded-xl border border-amber-500/40 bg-slate-900/90 px-3 py-1.5 text-center shadow-xl backdrop-blur-sm">
      <span className="max-w-full truncate text-[10px] font-semibold uppercase tracking-wide text-amber-300">{title}</span>
      {timer && <span className="font-mono text-lg font-bold tabular-nums leading-none text-amber-200" data-testid="battle-timer">{timer}</span>}
      {meta && <span className="mt-1 max-w-full truncate text-[10px] leading-none text-slate-300" data-testid="puzzle-top-meta">{meta}</span>}
      {status && <span role="status" className={`mt-1 text-[11px] font-semibold leading-none ${status.tone}`}>{status.text}</span>}
    </div>
  </div>;
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
const ghostButton = 'rounded-xl border border-slate-600 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 active:scale-95 transition-all';

/** Números do jogador na batalha, numa linha só (sem "Puzzle nº": o índice já aparece no cartão do topo). */
function BattleStats({ player, elapsed }: { player: BattlePlayerView; elapsed: number }) {
  return <>
    <span className="text-emerald-400">✓{player.solved}</span>
    <span className="text-red-400">✗{player.failed}</span>
    {player.lives !== undefined && <span className="text-rose-400">{hearts(player.lives)}</span>}
    {player.points !== undefined && <span className="text-amber-300">{player.points}pt</span>}
    {player.clockMs !== undefined && <span className={player.clockMs - elapsed < 10_000 ? 'text-red-400' : 'text-slate-200'}>{clock(player.clockMs - elapsed)}</span>}
    {player.done && <span className="text-[10px] font-normal text-slate-400">fim</span>}
    {player.offline && <span className="text-[10px] font-normal text-amber-300">off</span>}
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
  const manualSolution = usePuzzleSessionStore((s) => s.manualSolution);
  const setupFen = usePuzzleSessionStore((s) => s.setupFen);
  const daily = usePuzzleStore((s) => s.daily);
  const dailyOpen = usePuzzleStore((s) => s.dailyOpen);
  const receivedAt = useBattleStore((s) => s.receivedAt);
  const myName = useAuthStore((s) => s.profile?.username) ?? 'Você';
  const [showOptions, setShowOptions] = useState(false);
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const battle = table?.battle ?? null;
  const now = useNow(200, !!battle && battle.phase !== 'finished');

  useEffect(() => { setShowOptions(false); setConfirmForfeit(false); }, [table?.kind, table?.boardId, battle?.phase]);
  useEffect(() => {
    if (!showOptions) return;
    const onDown = (e: MouseEvent | TouchEvent) => { if (!optionsRef.current?.contains(e.target as Node)) setShowOptions(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('touchstart', onDown);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('touchstart', onDown); };
  }, [showOptions]);

  if (!table || table.kind === 'lesson' || dailyOpen) return null;
  const hasPuzzle = !!puzzle && puzzle.boardId === table.boardId;
  const myColor = table.orientation;
  const dailyColor = hasPuzzle ? (setupFen.split(' ')[1] === 'b' ? 'b' : 'w') : myColor;
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
    const meta = hasPuzzle
      ? [`${puzzleDifficultyLabel(puzzle.rating)} (${puzzle.rating})`, ...(themes.length ? [themes.map(puzzleThemeLabel).join(', ')] : [])].join(' · ')
      : 'Escolha um puzzle';
    const showingStrip = hasPuzzle && (phase === 'solved' || (phase === 'solution' && !!solution));
    return <>
      <TopCard testId="puzzle-hud-daily" title={`Puzzle do dia${slot ? ` · slot ${slot}` : ''}`} meta={meta} status={status} />

       {!showingStrip && <BottomRow left={<div ref={optionsRef} className="relative w-full">
        {showOptions && <OptionsCard onClose={() => setShowOptions(false)}>
          {!inProgress && <button type="button" data-testid="puzzle-another" onClick={() => { setShowOptions(false); openDaily(); }} className={`${optionButton} bg-amber-500 text-slate-950 hover:bg-amber-400`}>
            <Puzzle className="h-4 w-4 flex-shrink-0" />Outro puzzle</button>}
          <button type="button" data-testid="puzzle-leave" onClick={() => { setShowOptions(false); onLeaveDaily(); }} className={`${optionButton} bg-red-600 hover:bg-red-500 active:bg-red-700`}>
            <LogOut className="h-4 w-4 flex-shrink-0" />Levantar</button>
        </OptionsCard>}
        <PlayerCard active={hasPuzzle && phase === 'ready'} clickable onClick={() => setShowOptions((v) => !v)} testId="puzzle-me-chip"
           color={dailyColor} name={myName} tag={hasPuzzle ? (dailyColor === 'w' ? '(Brancas)' : '(Pretas)') : undefined}>
          <span className="text-rose-400" aria-label={`${lives ?? 0} vidas`}>{hearts(lives ?? 0)}</span>
          {hasPuzzle && <span className={phase === 'ready' ? 'text-emerald-400' : 'text-slate-400'}>{Math.min(moveNumber, puzzle.solutionLength)}/{puzzle.solutionLength}</span>}
          {hasPuzzle && slotView && !finished && lives !== undefined && <span className="text-[10px] font-normal text-amber-300">até {dailyRewardFor(slotView.rewardGambits, lives)} G</span>}
        </PlayerCard>
       </div>} />}

      {hasPuzzle && phase === 'wrong' && <Toast tone="border-red-500/50" testId="puzzle-toast-wrong">
        <p className="text-xs font-semibold text-red-300">Lance errado</p>
        {lives !== undefined && <p className="text-[10px] text-slate-400">{lives > 0 ? `${lives} ${lives === 1 ? 'vida restante' : 'vidas restantes'} · o puzzle recomeça` : 'Sem vidas'}</p>}
      </Toast>}
       {hasPuzzle && phase === 'solved' && <BottomStrip tone="border-emerald-500/50" testId="puzzle-toast-solved">
         <span className="min-w-0 truncate font-bold text-emerald-300">Resolvido! +{feedback?.rewardGambits ?? 0} G</span>
         <div className="flex flex-shrink-0 gap-1"><button type="button" onClick={openDaily} className={stripButton}>Outro puzzle</button>
           <button type="button" onClick={onLeaveDaily} className={stripButton}>Levantar</button></div>
       </BottomStrip>}
       {hasPuzzle && phase === 'solution' && solution && <BottomStrip tone="border-red-500/40" testId="puzzle-toast-solution">
         <span className="flex-shrink-0 font-mono text-[11px] text-red-300">Solução {solutionStep}/{solution.length}</span>
         <div className="flex items-center gap-0.5">
           <button type="button" aria-label="Repetir" onClick={() => { usePuzzleSessionStore.getState().setSolutionStep(0); usePuzzleSessionStore.getState().setSolutionAutoplay(true); }} className={stripButton}><RotateCcw className="h-3.5 w-3.5" /></button>
           <button type="button" aria-label="Lance anterior" disabled={solutionStep === 0} onClick={() => usePuzzleSessionStore.getState().navigateSolution(solutionStep - 1)} className={stripButton}><ChevronLeft className="h-3.5 w-3.5" /></button>
           <button type="button" aria-label="Próximo lance" disabled={solutionStep >= solution.length} onClick={() => usePuzzleSessionStore.getState().navigateSolution(solutionStep + 1)} className={stripButton}><ChevronRight className="h-3.5 w-3.5" /></button>
           <button type="button" aria-label={manualSolution || solutionStep >= solution.length ? 'Reproduzir solução' : 'Pausar solução'} onClick={() => {
             if (solutionStep >= solution.length) usePuzzleSessionStore.getState().setSolutionStep(0);
             usePuzzleSessionStore.getState().setSolutionAutoplay(manualSolution || solutionStep >= solution.length);
           }} className={stripButton}>
             {manualSolution || solutionStep >= solution.length ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
           </button>
         </div>
         <div className="flex flex-shrink-0 gap-0.5"><button type="button" onClick={openDaily} className={stripButton}>Outro puzzle</button>
           <button type="button" onClick={onLeaveDaily} className={stripButton}>Levantar</button></div>
       </BottomStrip>}
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
  const themes = hasPuzzle && battle.showThemes ? puzzleMainThemes(puzzle.themes) : [];
   const requestedTheme = hasPuzzle && puzzle.themeFallback
     ? `Tema: ${themes.length ? themes.map(puzzleThemeLabel).join(', ') : 'variado'}`
     : battle.theme ? puzzleThemeLabel(battle.theme) : '';
   const title = [BATTLE_MODE_INFO[battle.mode].label, PUZZLE_BAND_INFO[battle.band].label, requestedTheme].filter(Boolean).join(' · ');
  const meta = hasPuzzle && !finished
    ? [`Puzzle ${battle.me.index + 1}`, `${puzzleDifficultyLabel(puzzle.rating)} (${puzzle.rating})`, ...(themes.length ? [themes.map(puzzleThemeLabel).join(', ')] : [])].join(' · ')
    : undefined;
  return <>
    <TopCard testId="puzzle-hud-battle" title={title} timer={!finished && timer ? timer : undefined} meta={meta} status={!finished ? status : null} />

     <BottomRow
      left={<div ref={optionsRef} className="relative w-full">
        {showOptions && <OptionsCard onClose={() => setShowOptions(false)}>
           {!finished && <button type="button" data-testid="battle-forfeit" onClick={() => { setShowOptions(false); setConfirmForfeit(true); }} className={`${optionButton} bg-red-600 hover:bg-red-500 active:bg-red-700`}>
            <Flag className="h-4 w-4 flex-shrink-0" />Desistir</button>}
          {finished && <button type="button" onClick={() => { setShowOptions(false); onDismissBattle(); }} className={`${optionButton} bg-amber-500 text-slate-950 hover:bg-amber-400`}>
            <LogOut className="h-4 w-4 flex-shrink-0" />Levantar</button>}
        </OptionsCard>}
         <PlayerCard active={!finished && hasPuzzle && phase === 'ready'} clickable onClick={() => setShowOptions((v) => !v)} testId="puzzle-me-chip" color={battle.me.color} name={myName} tag={battle.me.color === 'w' ? '(Brancas)' : '(Pretas)'}>
          <BattleStats player={battle.me} elapsed={elapsed} />
        </PlayerCard>
      </div>}
       right={<PlayerCard active={!finished && !battle.opponent.done} testId="battle-opponent-chip" color={battle.opponent.color} name={battle.opponent.name} tag={battle.opponent.color === 'w' ? '(Brancas)' : '(Pretas)'}>
        <BattleStats player={battle.opponent} elapsed={elapsed} />
      </PlayerCard>}
    />

     {confirmForfeit && !finished && <div className="pointer-events-auto fixed inset-0 z-[240] flex items-center justify-center bg-black/40 p-4">
       <section role="dialog" aria-modal="true" aria-label="Desistir da batalha?" className="w-full max-w-sm space-y-3 rounded-2xl border border-red-500/50 bg-slate-900 p-5 text-center text-white shadow-2xl">
         <h3 className="text-xl font-bold">Desistir da batalha?</h3>
         <p className="text-sm text-slate-300">Você perderá esta batalha.</p>
         <div className="flex gap-2"><button type="button" onClick={() => setConfirmForfeit(false)} className={`${ghostButton} flex-1`}>Cancelar</button>
           <button type="button" onClick={() => { setConfirmForfeit(false); onForfeit(battle.battleId); }} className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500">Desistir</button></div>
       </section>
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
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[13px] font-bold tabular-nums leading-none"><BattleStats player={player} elapsed={0} /></div>
          </div>)}
        </div>
        <p className="text-lg font-bold text-emerald-300">{battle.result?.myRewardGambits ? `+${battle.result.myRewardGambits} Gambitos` : 'Sem recompensa'}</p>
        <button type="button" data-testid="battle-dismiss" onClick={onDismissBattle} className="w-full rounded-xl bg-amber-500 py-2.5 font-bold text-slate-950 hover:bg-amber-400">Fechar</button>
      </section>
    </div>}
  </>;
}
