import { BOT_LEVEL_COLORS, BOT_LEVEL_LABELS, type BotLevel } from '../../shared/academy/AcademyShapes';

export function LevelBars({ level }: { level: BotLevel }) {
  return <span className="inline-flex items-end gap-2" aria-label={`Nível ${BOT_LEVEL_LABELS[level]}`}>
    <span className="inline-flex items-end gap-0.5 h-5">
      {[1, 2, 3, 4].map((bar) => <span key={bar} className="w-1.5 rounded-sm"
        style={{ height: `${7 + bar * 3}px`, backgroundColor: bar <= level ? BOT_LEVEL_COLORS[level] : '#475569' }} />)}
    </span>
    <span className="text-sm text-slate-300">{BOT_LEVEL_LABELS[level]}</span>
  </span>;
}