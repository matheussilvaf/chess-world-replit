/**
 * Toolbar + inspector for hurtbox/hitbox editing: tool selection, group
 * enable toggles, numeric inspector for the selected rectangle and the
 * productivity actions (copy prev/next frame, copy to direction, clear).
 */
import { ChevronLeft, ChevronRight, Copy, Eraser, MousePointer, Square, Trash2 } from 'lucide-react';
import type { CombatFrameConfig, LocalRectangle } from '../../../shared/combat/CharacterCombatShapes';
import type { BoxKind, BoxSelection, EditorTool } from './types';

interface BoxToolsProps {
  frame: CombatFrameConfig;
  selection: BoxSelection | null;
  tool: EditorTool;
  snap1px: boolean;
  canCopyPrev: boolean;
  canCopyNext: boolean;
  onToolChange: (t: EditorTool) => void;
  onSnapChange: (v: boolean) => void;
  onToggleGroup: (kind: BoxKind, enabled: boolean) => void;
  onRectEdit: (kind: BoxKind, index: number, rect: LocalRectangle) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCopyFrom: (delta: -1 | 1) => void;
  onCopyHurtboxToDirection: () => void;
  onClearFrame: () => void;
  onClearMovement: () => void;
}

const toolBtn = (active: boolean, activeCls: string) =>
  `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
    active ? activeCls : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
  }`;

export function BoxTools(props: BoxToolsProps) {
  const { frame, selection, tool, snap1px } = props;
  const selRect = selection ? frame[selection.kind].rectangles[selection.index] ?? null : null;

  const numInput = (label: string, value: number, apply: (v: number) => void, min?: number) => (
    <div>
      <label className="text-[10px] text-slate-500 mb-0.5 block">{label}</label>
      <input
        type="number"
        step={snap1px ? 1 : 0.1}
        min={min}
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) apply(min !== undefined ? Math.max(min, v) : v);
        }}
        className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs text-white font-mono"
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Tools */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => props.onToolChange('select')} className={toolBtn(tool === 'select', 'bg-cyan-600 text-white')}>
          <MousePointer size={12} /> Selecionar
        </button>
        <button
          onClick={() => props.onToolChange('draw-hurtbox')}
          className={toolBtn(tool === 'draw-hurtbox', 'bg-lime-600 text-white')}
        >
          <Square size={12} /> + Hurtbox
        </button>
        <button
          onClick={() => props.onToolChange('draw-hitbox')}
          className={toolBtn(tool === 'draw-hitbox', 'bg-fuchsia-600 text-white')}
        >
          <Square size={12} /> + Hitbox
        </button>
        <label className="flex items-center gap-1.5 text-xs text-slate-400 ml-auto cursor-pointer">
          <input type="checkbox" checked={snap1px} onChange={(e) => props.onSnapChange(e.target.checked)} className="accent-cyan-500" />
          Snap 1px
        </label>
      </div>

      {/* Group toggles */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/60 cursor-pointer">
          <input
            type="checkbox"
            checked={frame.hurtbox.enabled}
            onChange={(e) => props.onToggleGroup('hurtbox', e.target.checked)}
            className="accent-lime-500"
          />
          <span className="text-xs text-lime-400 font-medium">Hurtbox ({frame.hurtbox.rectangles.length})</span>
        </label>
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/60 cursor-pointer">
          <input
            type="checkbox"
            checked={frame.hitbox.enabled}
            onChange={(e) => props.onToggleGroup('hitbox', e.target.checked)}
            className="accent-fuchsia-500"
          />
          <span className="text-xs text-fuchsia-400 font-medium">Hitbox ({frame.hitbox.rectangles.length})</span>
        </label>
      </div>

      {/* Selected rectangle inspector */}
      {selection && selRect && (
        <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-semibold ${selection.kind === 'hurtbox' ? 'text-lime-400' : 'text-fuchsia-400'}`}>
              {selection.kind === 'hurtbox' ? 'Hurtbox' : 'Hitbox'} #{selection.index + 1}
              <span className="text-slate-500 font-normal ml-1">(px rel. à origem)</span>
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={props.onDuplicate}
                title="Duplicar retângulo"
                className="p-1.5 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                <Copy size={12} />
              </button>
              <button
                onClick={props.onDelete}
                title="Excluir retângulo"
                className="p-1.5 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {numInput('X', selRect.x, (v) => props.onRectEdit(selection.kind, selection.index, { ...selRect, x: v }))}
            {numInput('Y', selRect.y, (v) => props.onRectEdit(selection.kind, selection.index, { ...selRect, y: v }))}
            {numInput('Larg.', selRect.width, (v) => props.onRectEdit(selection.kind, selection.index, { ...selRect, width: v }), 1)}
            {numInput('Alt.', selRect.height, (v) => props.onRectEdit(selection.kind, selection.index, { ...selRect, height: v }), 1)}
          </div>
        </div>
      )}

      {/* Productivity actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => props.onCopyFrom(-1)}
          disabled={!props.canCopyPrev}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
        >
          <ChevronLeft size={12} /> Copiar do frame anterior
        </button>
        <button
          onClick={() => props.onCopyFrom(1)}
          disabled={!props.canCopyNext}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
        >
          Copiar do próximo frame <ChevronRight size={12} />
        </button>
        <button
          onClick={props.onCopyHurtboxToDirection}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs bg-lime-500/10 text-lime-400 hover:bg-lime-500/20"
        >
          <Copy size={12} /> Hurtbox → todos os frames da direção
        </button>
        <button
          onClick={props.onClearFrame}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
        >
          <Eraser size={12} /> Limpar frame
        </button>
        <button
          onClick={props.onClearMovement}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20"
        >
          <Trash2 size={12} /> Limpar movimento
        </button>
      </div>
    </div>
  );
}
