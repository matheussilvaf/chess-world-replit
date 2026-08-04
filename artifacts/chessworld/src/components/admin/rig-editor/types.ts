export type BoxKind = 'hurtbox' | 'hitbox';

export type EditorTool = 'select' | 'draw-hurtbox' | 'draw-hitbox';

export interface BoxSelection {
  kind: BoxKind;
  index: number;
}
