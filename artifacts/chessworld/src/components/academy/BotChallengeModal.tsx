import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { botEngine } from '../../game/bots/botEngine';
import type { EngineStatus } from '../../game/bots/StockfishBot';
import { getActiveRoom, getActiveRoomType } from '../../game/network/colyseusClient';
import { ACADEMY_MSG, type AcademyBotId, type CreateBotChallengePayload } from '../../shared/academy/AcademyShapes';
import { useAcademyStore } from '../../stores/academyStore';
import { useGameStore } from '../../stores/gameStore';
import { pushNotice } from '../../stores/noticesStore';
import { TIME_CONTROLS, type TimeControl } from '../game/BoardModal';
import { LevelBars } from './LevelBars';

export function BotChallengeModal({ botId, boardId }: { botId: AcademyBotId; boardId: string }) {
  const bot = useAcademyStore((s) => s.bots.find((b) => b.id === botId));
  const board = useGameStore((s) => s.colyseusBoards.find((b) => b.id === boardId));
  const close = () => { useGameStore.getState().setSelectedBoard(null); useGameStore.getState().setBoardLocked(false); };
  const [time, setTime] = useState<TimeControl>(TIME_CONTROLS[2].controls[0]);
  const [side, setSide] = useState<CreateBotChallengePayload['side']>('w');
  const [status, setStatus] = useState<EngineStatus>(botEngine.status());
  const [detail, setDetail] = useState('');
  useEffect(() => botEngine.subscribe((next, message) => { setStatus(next); setDetail(message ?? ''); }), []);
  const occupied = board?.status === 'playing';
  const play = () => {
    const room = getActiveRoomType() === 'academy' ? getActiveRoom() : null;
    if (!room) { pushNotice({ title: 'A Academia ainda não está disponível neste servidor.' }); return; }
    room.send(ACADEMY_MSG.createBotChallenge, {
      boardId, timeCategory: time.category, baseMinutes: time.time,
      incrementSeconds: time.increment, timeLabel: time.label, side,
    } satisfies CreateBotChallengePayload);
    close();
  };
  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4">
    <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-2xl">
      <div className="flex items-start justify-between border-b border-slate-700 p-5">
        <div><h3 className="text-lg font-bold">{bot?.name ?? 'Bot'}</h3>{bot && <LevelBars level={bot.level} />}</div>
        <button type="button" onClick={close} aria-label="Fechar" className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
      </div>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
        <p className="text-xs text-slate-300">Partida de treino — não altera seu rating nem dá Gambitos</p>
        {occupied ? <p className="text-center font-semibold text-amber-300">Mesa ocupada</p> : <>
          {TIME_CONTROLS.map((group) => <div key={group.category}>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">{group.icon}{group.category}</div>
            <div className="grid grid-cols-3 gap-2">{group.controls.map((option) =>
              <button type="button" key={option.label} onClick={() => setTime(option)}
                className={`rounded-lg border px-2 py-2 text-sm ${option === time ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>{option.label}</button>)}</div>
          </div>)}
          <div><div className="mb-2 text-sm font-semibold">Sua cor</div><div className="grid grid-cols-3 gap-2">
            {([{ id: 'w', label: 'Brancas' }, { id: 'random', label: 'Aleatório' }, { id: 'b', label: 'Pretas' }] as const).map((option) =>
              <button type="button" key={option.id} onClick={() => setSide(option.id)}
                className={`rounded-lg border px-2 py-2 text-sm ${side === option.id ? 'border-blue-500 bg-blue-500/20 text-blue-300' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>{option.label}</button>)}
          </div></div>
          {status !== 'ready' && <p role="status" className="text-xs text-amber-300">{status === 'error' ? detail || 'Falha ao carregar engine.' : 'Carregando engine…'}</p>}
          <button type="button" onClick={play} disabled={status !== 'ready'}
            className="w-full rounded-xl bg-amber-500 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
            Jogar contra {bot?.name ?? 'bot'}</button>
        </>}
      </div>
    </div>
  </div>;
}