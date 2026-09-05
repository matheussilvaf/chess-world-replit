/**
 * Editor de badges de um item (chips de texto livre). Enter/vírgula/botão
 * adicionam; × remove; as sugestões com significado no jogo (`food`,
 * `forging`, `smelting`, `potion`) aparecem como atalhos. Cada mudança é
 * salva na hora pelo pai (`onChange`).
 */
import { useState, type KeyboardEvent } from 'react';
import { Plus, Tag, X } from 'lucide-react';
import {
  MAX_CRAFT_BADGES_PER_ITEM,
  MAX_CRAFT_BADGE_LEN,
  SUGGESTED_CRAFT_BADGES,
  normalizeCraftBadge,
} from '../../../shared/craft/CraftBadges';

const BADGE_HINTS: Record<string, string> = {
  food: 'Comida: dá energia ao comer (config em Skills and Character Energy)',
  forging: 'Forjar: XP de Forging ao criar',
  smelting: 'Fundir: XP de Smelting ao criar',
  potion: 'Poção: XP de Alchemy (em breve)',
};

export function badgeChipClass(badge: string): string {
  switch (badge) {
    case 'food':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
    case 'forging':
      return 'bg-orange-500/15 text-orange-300 border-orange-500/40';
    case 'smelting':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
    case 'potion':
      return 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40';
    default:
      return 'bg-slate-700/40 text-slate-300 border-slate-600/50';
  }
}

interface BadgeEditorProps {
  badges: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Badges já usadas por outros itens (autocomplete além das sugeridas). */
  known?: string[];
}

export function BadgeEditor({ badges, onChange, disabled = false, known = [] }: BadgeEditorProps) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const add = (raw: string) => {
    const badge = normalizeCraftBadge(raw);
    if (!badge) {
      if (raw.trim()) setProblem(`Use letras minúsculas, dígitos, _ ou - (até ${MAX_CRAFT_BADGE_LEN} caracteres).`);
      return;
    }
    setProblem(null);
    setDraft('');
    if (badges.includes(badge)) return;
    if (badges.length >= MAX_CRAFT_BADGES_PER_ITEM) {
      setProblem(`No máximo ${MAX_CRAFT_BADGES_PER_ITEM} badges por item.`);
      return;
    }
    onChange([...badges, badge]);
  };
  const remove = (badge: string) => onChange(badges.filter((b) => b !== badge));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && draft === '' && badges.length > 0) {
      remove(badges[badges.length - 1]);
    }
  };

  const shortcuts = [...SUGGESTED_CRAFT_BADGES, ...known.filter((b) => !SUGGESTED_CRAFT_BADGES.includes(b))].filter((b) => !badges.includes(b));

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-950/40 p-2.5" data-testid="badge-editor">
      <div className="flex items-center gap-1.5 mb-2">
        <Tag className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">Badges</span>
        <span className="text-[10px] text-slate-600">· filtros usados por outras telas</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {badges.map((badge) => (
          <span
            key={badge}
            title={BADGE_HINTS[badge]}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono ${badgeChipClass(badge)}`}
          >
            {badge}
            <button
              type="button"
              onClick={() => remove(badge)}
              disabled={disabled}
              aria-label={`Remover badge ${badge}`}
              className="rounded-full hover:text-white disabled:opacity-40"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => { if (draft.trim()) add(draft); }}
            disabled={disabled}
            placeholder={badges.length === 0 ? 'ex.: food, forging…' : 'nova badge'}
            maxLength={MAX_CRAFT_BADGE_LEN + 4}
            className="w-28 rounded-md border border-slate-700/70 bg-slate-900/80 px-2 py-0.5 text-[11px] font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/60 disabled:opacity-40"
            aria-label="Nova badge"
          />
          <button
            type="button"
            onClick={() => add(draft)}
            disabled={disabled || !draft.trim()}
            className="p-1 rounded-md border border-slate-700/60 bg-slate-800/90 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
            title="Adicionar badge"
          >
            <Plus className="w-3 h-3" />
          </button>
        </span>
      </div>
      {shortcuts.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-slate-600 mr-0.5">atalhos:</span>
          {shortcuts.slice(0, 12).map((badge) => (
            <button
              key={badge}
              type="button"
              onClick={() => add(badge)}
              disabled={disabled}
              title={BADGE_HINTS[badge]}
              className="rounded-full border border-dashed border-slate-600/60 px-2 py-0.5 text-[10px] font-mono text-slate-400 hover:border-cyan-500/60 hover:text-cyan-200 disabled:opacity-40"
            >
              + {badge}
            </button>
          ))}
        </div>
      )}
      {problem && <p className="mt-1.5 text-[10px] text-rose-300">{problem}</p>}
    </div>
  );
}
