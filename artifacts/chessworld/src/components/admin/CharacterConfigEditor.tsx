/**
 * Thin re-export: the character editor was rewritten as a module under
 * ./character-editor (auto-discovery + combat boxes). This file keeps the
 * import path used by main.tsx stable.
 */
export { CharacterConfigEditor } from './character-editor';
