import { SimpleChessBoard } from '../../chess/SimpleChessBoard';
import { puzzleThemeLabel, type PuzzlePreviewResponse } from '../../../shared/academy/PuzzleShapes';

type PreviewPuzzle = NonNullable<PuzzlePreviewResponse['puzzle']>;

export function PuzzlePreviewCard({ puzzle, onPin, pinning, pinLabel = 'Fixar este puzzle' }: { puzzle: PreviewPuzzle; onPin?: () => void; pinning?: boolean; pinLabel?: string }) {
  return <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm">
    <div className="mx-auto max-w-[230px]"><SimpleChessBoard fen={puzzle.fen} orientation={puzzle.playerColor} interactive={false} /></div>
    <div className="mt-3 space-y-1">
      <p><strong>{puzzle.puzzleId}</strong> · Rating {puzzle.rating} · Joga de {puzzle.playerColor === 'w' ? 'Brancas' : 'Pretas'}</p>
      <p className="text-slate-400">{puzzle.themes.map(puzzleThemeLabel).join(', ') || 'Sem temas'} · {puzzle.solutionLength} lance(s) do jogador</p>
      <div className="flex flex-wrap items-center gap-3">
        {puzzle.gameUrl && <a href={puzzle.gameUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">Ver no Lichess ↗</a>}
        {onPin && <button type="button" disabled={pinning} onClick={onPin} className="rounded bg-cyan-700 px-3 py-1.5 font-medium hover:bg-cyan-600 disabled:opacity-50">
          {pinning ? 'Fixando…' : pinLabel}
        </button>}
      </div>
    </div>
  </div>;
}