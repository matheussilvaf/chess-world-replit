import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { BATTLE_MODES, BATTLE_MODE_INFO, PUZZLE_BANDS, PUZZLE_BAND_INFO, type BattleMode, type PuzzleBand } from '../../../shared/academy/PuzzleShapes';
import { sendBattleAccept, sendBattleCancel, sendBattleCreate } from '../../../game/network/battleHandlers';
import { useAuthStore } from '../../../stores/authStore';
import { useGameStore } from '../../../stores/gameStore';

export function BattleChallengeModal({ boardId, onCreate = sendBattleCreate, onCancel = sendBattleCancel, onAccept = sendBattleAccept, onClose, myId, initialMode = 'race', initialBand = 'beginner' }: {
  boardId: string;
  onCreate?: typeof sendBattleCreate;
  onCancel?: typeof sendBattleCancel;
  onAccept?: typeof sendBattleAccept;
  onClose?: () => void;
  myId?: string;
  initialMode?: BattleMode;
  initialBand?: PuzzleBand;
}) {
  const board = useGameStore((s) => s.colyseusBoards.find((b) => b.id === boardId));
  const userId = useAuthStore((s) => s.user?.id);
  const [mode, setMode] = useState<BattleMode>(initialMode);
  const [band, setBand] = useState<PuzzleBand>(initialBand);
  const [showThemes, setShowThemes] = useState(true);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const close = () => { useGameStore.getState().setSelectedBoard(null); useGameStore.getState().setBoardLocked(false); onClose?.(); };
  const waiting = board?.status === 'waiting';
  const mine = !!(myId ?? userId) && board?.waitingPlayerId === (myId ?? userId);
  const remaining = Math.max(0, Math.ceil(((board?.battleExpiresAt ?? now) - now) / 1000));
  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-label="Desafio de puzzles">
    <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-amber-500/40 bg-slate-900 p-5 text-slate-100 shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-amber-300">Batalha de puzzles</h2>
        <button onClick={close} aria-label="Fechar" className="text-slate-400 hover:text-white"><X size={20} /></button>
      </div>
      {board?.status === 'playing' ? <p className="py-8 text-center">Mesa ocupada — batalha em andamento</p>
        : waiting ? <div className="space-y-4">
          <p className="text-lg font-semibold">{mine ? 'Aguardando adversário…' : `Desafio de ${board.waitingPlayerName}`}</p>
          <p>{BATTLE_MODE_INFO[board.battleMode ?? 'race'].label} · {PUZZLE_BAND_INFO[board.battleBand ?? 'beginner'].label}</p>
          <p className="text-sm text-slate-300">Temas {board.battleShowThemes ? 'visíveis' : 'ocultos'}</p>
          {mine && <p className="text-amber-300">Expira em {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</p>}
          <button data-testid={mine ? 'battle-cancel' : 'battle-accept'} className="w-full rounded-xl bg-amber-500 py-3 font-bold text-slate-950"
            onClick={() => { mine ? onCancel(boardId) : onAccept(boardId); if (!myId) close(); }}>
            {mine ? 'Cancelar desafio' : 'Aceitar desafio'}
          </button>
        </div> : <div className="space-y-5">
          <fieldset><legend className="mb-2 font-semibold">Modo</legend><div className="grid grid-cols-1 gap-2">
            {BATTLE_MODES.map((item) => <button key={item} type="button" data-testid={`battle-mode-${item}`} onClick={() => setMode(item)}
              className={`rounded-lg border p-2 text-left ${mode === item ? 'border-amber-400 bg-amber-500/20' : 'border-slate-700 bg-slate-800'}`}>
              <span className="font-semibold">{BATTLE_MODE_INFO[item].label}</span><span className="ml-2 text-xs text-slate-300">{BATTLE_MODE_INFO[item].description}</span>
            </button>)}
          </div></fieldset>
          <fieldset><legend className="mb-2 font-semibold">Faixa</legend><div className="grid grid-cols-2 gap-2">
            {PUZZLE_BANDS.map((item) => <button key={item} type="button" data-testid={`battle-band-${item}`} onClick={() => setBand(item)}
              className={`rounded-lg border p-2 text-sm ${band === item ? 'border-amber-400 bg-amber-500/20' : 'border-slate-700 bg-slate-800'}`}>
              {PUZZLE_BAND_INFO[item].label} · {PUZZLE_BAND_INFO[item].min}–{PUZZLE_BAND_INFO[item].max}
            </button>)}
          </div></fieldset>
          <label className="flex items-center gap-2 text-sm"><input data-testid="battle-themes" type="checkbox" checked={showThemes} onChange={(e) => setShowThemes(e.target.checked)} />Mostrar o tema dos puzzles</label>
          <button data-testid="battle-create" className="w-full rounded-xl bg-amber-500 py-3 font-bold text-slate-950"
            onClick={() => { onCreate({ boardId, mode, band, showThemes }); if (!myId) close(); }}>Abrir desafio</button>
        </div>}
    </div>
  </div>;
}