import { useEffect, useState } from 'react';
import { BATTLE_MODE_INFO, PUZZLE_BAND_INFO, type BattlePlayerView, type BattleEndReason } from '../../../shared/academy/PuzzleShapes';
import { sendBattleDismiss, sendBattleLeave, sendBattleMove } from '../../../game/network/battleHandlers';
import { useBattleStore } from '../../../stores/battleStore';
import { PuzzleBoard } from './PuzzleBoard';

const reasons: Record<BattleEndReason, string> = {
  time: 'Tempo esgotado', score: 'Pontuação', lives: 'Vidas', clock: 'Relógio',
  both_done: 'Ambos terminaram', forfeit: 'Desistência', all_puzzles: 'Todos os puzzles concluídos', aborted: 'Batalha interrompida',
};
function time(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function PlayerPanel({ player, clock }: { player: BattlePlayerView; clock?: number }) {
  return <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-4">
    <div className="flex justify-between gap-2"><strong>{player.name}</strong><span>{player.offline ? 'Desconectado' : player.done ? 'Terminou' : `Puzzle nº ${player.index + 1}`}</span></div>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
      <span>Acertos: {player.solved}</span><span>Erros: {player.failed}</span>
      {player.lives !== undefined && <span>Vidas: {'♥'.repeat(Math.max(0, player.lives))}</span>}
      {player.points !== undefined && <span>Pontos: {player.points}</span>}
      {clock !== undefined && <span>Relógio: {time(clock)}</span>}
    </div>
  </div>;
}

export function BattleScreen({ onMove = sendBattleMove, onDismiss = sendBattleDismiss, onLeave = sendBattleLeave }: {
  onMove?: (sessionId: string, uci: string) => void;
  onDismiss?: () => void;
  onLeave?: (battleId: string) => void;
}) {
  const { battle, puzzle, feedback, screenOpen, clear } = useBattleStore();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!screenOpen) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [screenOpen]);
  if (!screenOpen || !battle) return null;
  const serverTime = now + (battle.serverNow - (battleReceivedAt.get(battle) ?? now));
  const elapsed = battle.phase === 'running' ? Math.max(0, serverTime - battle.serverNow) : 0;
  const countdown = Math.max(0, Math.ceil((battle.startsAt - serverTime) / 1000));
  const finished = battle.phase === 'finished';
  const outcome = battle.result?.winnerId === '' ? 'Empate' : battle.result?.winnerId === battle.me.playerId ? 'Você venceu!' : 'Você perdeu';
  return <div className="fixed inset-0 z-[1100] overflow-y-auto bg-slate-950/95 p-3 text-white" role="dialog" aria-label="Batalha de puzzles">
    <div className="mx-auto max-w-5xl space-y-4 py-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-800 p-4">
        <div><h2 className="text-2xl font-bold text-amber-300">{BATTLE_MODE_INFO[battle.mode].label}</h2><p>{PUZZLE_BAND_INFO[battle.band].label}</p></div>
        {!finished && <div className="text-xl font-mono text-amber-200">
          {battle.endsAt !== undefined ? `Restante: ${time(battle.endsAt - serverTime)}` : battle.bestOf ? `Puzzle ${battle.bestOf.current + 1}/${battle.bestOf.total} · ${time(battle.bestOf.deadlineAt - serverTime)}` : ''}
        </div>}
      </header>
      {battle.phase === 'countdown' && <p className="py-14 text-center text-8xl font-black text-amber-400" data-testid="battle-countdown">{countdown || 'Vai!'}</p>}
      {finished ? <section className="space-y-4 rounded-xl bg-slate-800 p-6 text-center">
        <h3 className="text-4xl font-black text-amber-300">{outcome}</h3>
        <p>Motivo: {reasons[battle.result?.reason ?? 'aborted']}</p>
        <div className="grid gap-3 sm:grid-cols-2"><PlayerPanel player={battle.me} /><PlayerPanel player={battle.opponent} /></div>
        <p className="text-2xl text-emerald-300">{battle.result?.myRewardGambits ? `+${battle.result.myRewardGambits} Gambitos` : 'Sem recompensa'}</p>
        <button data-testid="battle-dismiss" onClick={() => { onDismiss(); clear(); }} className="rounded-xl bg-amber-500 px-8 py-3 font-bold text-slate-950">Fechar</button>
      </section> : battle.phase === 'running' && <>
        <div className="grid gap-3 sm:grid-cols-2">
          <PlayerPanel player={battle.me} clock={battle.me.clockMs === undefined ? undefined : Math.max(0, battle.me.clockMs - elapsed)} />
          <PlayerPanel player={battle.opponent} clock={battle.opponent.clockMs === undefined ? undefined : Math.max(0, battle.opponent.clockMs - elapsed)} />
        </div>
        <div className="flex justify-center rounded-xl bg-slate-900 p-3">
          <PuzzleBoard puzzle={puzzle?.context.kind === 'battle' && puzzle.context.battleId === battle.battleId ? puzzle : null}
            feedback={feedback} compact showThemes={battle.showThemes}
            onMove={(uci) => { if (puzzle) onMove(puzzle.sessionId, uci); }} size="auto" />
        </div>
        <button data-testid="battle-forfeit" className="rounded-xl border border-red-500 px-5 py-2 text-red-200"
          onClick={() => { if (window.confirm('Desistir desta batalha?')) onLeave(battle.battleId); }}>Desistir</button>
      </>}
    </div>
  </div>;
}

// Snapshot arrival time is recorded by the store rather than recalculating
// the offset on each render (which would freeze a local countdown).
const battleReceivedAt = new WeakMap<object, number>();
useBattleStore.subscribe((state, previous) => {
  if (state.battle && state.battle !== previous.battle) battleReceivedAt.set(state.battle, Date.now());
});