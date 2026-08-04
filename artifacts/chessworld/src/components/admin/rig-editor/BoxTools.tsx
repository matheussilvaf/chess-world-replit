/**
 * Rig editor toolbox: tool switcher, per-frame group toggles, selection
 * inspector (numeric editing) and the copy/mirror/clear helpers (spec §12-13).
 * All mutations are delegated to the page (which owns undo/dirty state).
 */
import {
  MousePointer2,
  Square,
  Zap,
  Copy,
  ClipboardPaste,
  ClipboardCopy,
  Trash2,
  ArrowLeftRight,
  ArrowLeft,
  ArrowRight,
  Eraser,
  Layers,
  Compass,
} from 'lucide-react';
import type { LocalRectangle, RigDirection, RigFrameConfig } from '../../../shared/combat/RigShapes';
import type { BoxKind, BoxSelection, EditorTool } from './types';

export const DIRECTION_LABELS: Record<RigDirection, string> = {
  south: 'Sul (South)',
  west: 'Oeste (West)',
  east: 'Leste (East)',
  north: 'Norte (North)',
};

interface BoxToolsProps {
  frame: RigFrameConfig;
  selection: BoxSelection | null;
  tool: EditorTool;
  snap1px: boolean;
  context: { animation: string; direction: RigDirection; localFrame: number; frameCount: number };
  canCopyPrev: boolean;
  canCopyNext: boolean;
  canPaste: boolean;
  mirrorTarget: RigDirection | null;
  onToolChange: (t: EditorTool) => void;
  onSnapChange: (v: boolean) => void;
  onToggleGroup: (kind: BoxKind, enabled: boolean) => void;
  onRectEdit: (kind: BoxKind, index: number, patch: Partial<LocalRectangle>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCopyFrom: (offset: -1 | 1) => void;
  onCopyFrameBoxes: () => void;
  onPasteFrameBoxes: () => void;
  onCopyHurtboxToDirection: () => void;
  onCopyHurtboxToAllDirections: () => void;
  onMirrorHitboxToOpposite: () => void;
  onClearFrame: () => void;
  onClearAnimation: () => void;
}

const sectionCls = 'border border-slate-800 rounded-lg p-3 bg-slate-900/60';
const titleCls = 'text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2';
const btnCls =
  'inline-flex items-center gap-1.5 px-2 py-1.5 rounded border text-xs font-medium transition-colors disabled:opacity-30 disabled:pointer-events-none';
const neutralBtn = `${btnCls} border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white`;
const numCls =
  'w-full bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-xs text-white font-mono';

export function BoxTools(props: BoxToolsProps) {
  const { frame, selection, tool, snap1px, context } = props;

  const selRect: LocalRectangle | null =
    selection ? (frame[selection.kind].rectangles[selection.index] ?? null) : null;

  const toolBtn = (t: EditorTool, label: string, icon: React.ReactNode, activeColor: string) => (
    <button
      type="button"
      onClick={() => props.onToolChange(t)}
      className={`${btnCls} ${
        tool === t
          ? `${activeColor} text-white`
          : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  const numField = (label: string, value: number, apply: (v: number) => void, min?: number) => (
    <label className="block">
      <span className="text-[10px] text-slate-500 font-mono">{label}</span>
      <input
        type="number"
        step={snap1px ? 1 : 0.1}
        min={min}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) apply(min !== undefined ? Math.max(min, v) : v);
        }}
        className={numCls}
      />
    </label>
  );

  return (
    <div className="space-y-3">
      {/* Tools */}
      <div className={sectionCls}>
        <div className={titleCls}>Ferramentas</div>
        <div className="flex flex-wrap gap-1.5">
          {toolBtn('select', 'Selecionar', <MousePointer2 size={13} />, 'border-sky-500 bg-sky-600/30')}
          {toolBtn('draw-hurtbox', 'Hurtbox', <Square size={13} />, 'border-emerald-500 bg-emerald-600/30')}
          {toolBtn('draw-hitbox', 'Hitbox', <Zap size={13} />, 'border-fuchsia-500 bg-fuchsia-600/30')}
        </div>
        <label className="flex items-center gap-2 mt-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={snap1px}
            onChange={(e) => props.onSnapChange(e.target.checked)}
            className="accent-sky-500"
          />
          Snap de 1px
        </label>
      </div>

      {/* Per-frame group toggles */}
      <div className={sectionCls}>
        <div className={titleCls}>Grupos neste frame</div>
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={frame.hurtbox.enabled}
            onChange={(e) => props.onToggleGroup('hurtbox', e.target.checked)}
            className="accent-emerald-500"
          />
          <span className="text-emerald-400 font-medium">Hurtboxes ativas</span>
          <span className="text-slate-500 font-mono">({frame.hurtbox.rectangles.length})</span>
        </label>
        <label className="flex items-center gap-2 mt-1.5 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={frame.hitbox.enabled}
            onChange={(e) => props.onToggleGroup('hitbox', e.target.checked)}
            className="accent-fuchsia-500"
          />
          <span className="text-fuchsia-400 font-medium">Hitboxes ativas</span>
          <span className="text-slate-500 font-mono">({frame.hitbox.rectangles.length})</span>
        </label>
      </div>

      {/* Selection inspector */}
      <div className={sectionCls}>
        <div className={titleCls}>Seleção</div>
        {selection && selRect ? (
          <div className="space-y-2">
            <div className="text-xs">
              <span
                className={`font-semibold ${
                  selection.kind === 'hurtbox' ? 'text-emerald-400' : 'text-fuchsia-400'
                }`}
              >
                {selection.kind === 'hurtbox' ? 'Hurtbox' : 'Hitbox'}
              </span>{' '}
              <span className="text-slate-400 font-mono">{selRect.id}</span>
            </div>
            <div className="text-[10px] text-slate-500 font-mono leading-relaxed">
              {context.animation} · {DIRECTION_LABELS[context.direction]} · frame{' '}
              {context.localFrame + 1}/{context.frameCount}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {numField('X (rel. origin)', selRect.x, (v) => props.onRectEdit(selection.kind, selection.index, { x: v }))}
              {numField('Y (rel. origin)', selRect.y, (v) => props.onRectEdit(selection.kind, selection.index, { y: v }))}
              {numField('Largura', selRect.width, (v) => props.onRectEdit(selection.kind, selection.index, { width: v }), 1)}
              {numField('Altura', selRect.height, (v) => props.onRectEdit(selection.kind, selection.index, { height: v }), 1)}
            </div>
            <div className="flex gap-1.5">
              <button type="button" onClick={props.onDuplicate} className={neutralBtn}>
                <Copy size={12} /> Duplicar
              </button>
              <button
                type="button"
                onClick={props.onDelete}
                className={`${btnCls} border-red-800 bg-red-950/60 text-red-300 hover:bg-red-900/60`}
              >
                <Trash2 size={12} /> Excluir
              </button>
            </div>
            <p className="text-[10px] text-slate-600">
              Setas movem 1px · Shift+setas 5px · Delete remove
            </p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Nenhuma caixa selecionada. Clique numa caixa no canvas ou desenhe uma nova.
          </p>
        )}
      </div>

      {/* Copy helpers */}
      <div className={sectionCls}>
        <div className={titleCls}>Copiar</div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => props.onCopyFrom(-1)}
            disabled={!props.canCopyPrev}
            className={neutralBtn}
            title="Copiar todas as caixas do frame anterior para este frame"
          >
            <ArrowLeft size={12} /> Do frame anterior
          </button>
          <button
            type="button"
            onClick={() => props.onCopyFrom(1)}
            disabled={!props.canCopyNext}
            className={neutralBtn}
            title="Copiar todas as caixas do próximo frame para este frame"
          >
            <ArrowRight size={12} /> Do próximo frame
          </button>
          <button
            type="button"
            onClick={props.onCopyFrameBoxes}
            className={neutralBtn}
            title="Copiar as caixas deste frame (Ctrl+C)"
          >
            <ClipboardCopy size={12} /> Copiar frame
          </button>
          <button
            type="button"
            onClick={props.onPasteFrameBoxes}
            disabled={!props.canPaste}
            className={neutralBtn}
            title="Colar as caixas copiadas neste frame (Ctrl+V)"
          >
            <ClipboardPaste size={12} /> Colar frame
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <button
            type="button"
            onClick={props.onCopyHurtboxToDirection}
            className={`${btnCls} border-emerald-800 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50`}
            title="Copiar a hurtbox deste frame para TODOS os frames desta direção nesta animação"
          >
            <Layers size={12} /> Hurtbox → todos os frames
          </button>
          <button
            type="button"
            onClick={props.onCopyHurtboxToAllDirections}
            className={`${btnCls} border-emerald-800 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50`}
            title="Copiar a hurtbox deste frame para todas as direções desta animação (mesmos frames locais)"
          >
            <Compass size={12} /> Hurtbox → todas as direções
          </button>
          <button
            type="button"
            onClick={props.onMirrorHitboxToOpposite}
            disabled={!props.mirrorTarget}
            className={`${btnCls} border-fuchsia-800 bg-fuchsia-950/50 text-fuchsia-300 hover:bg-fuchsia-900/50`}
            title={
              props.mirrorTarget
                ? `Copiar as hitboxes desta animação para ${DIRECTION_LABELS[props.mirrorTarget]}, espelhadas no eixo do origin`
                : 'Disponível apenas para Oeste/Leste'
            }
          >
            <ArrowLeftRight size={12} /> Hitbox → direção oposta (espelhado)
          </button>
        </div>
      </div>

      {/* Clear */}
      <div className={sectionCls}>
        <div className={titleCls}>Limpar</div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={props.onClearFrame}
            className={`${btnCls} border-amber-800 bg-amber-950/50 text-amber-300 hover:bg-amber-900/50`}
          >
            <Eraser size={12} /> Limpar frame
          </button>
          <button
            type="button"
            onClick={props.onClearAnimation}
            className={`${btnCls} border-red-800 bg-red-950/60 text-red-300 hover:bg-red-900/60`}
          >
            <Trash2 size={12} /> Limpar animação
          </button>
        </div>
      </div>
    </div>
  );
}
