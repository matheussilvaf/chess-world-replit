/**
 * Store do personagem do jogador.
 *
 * Fontes de verdade:
 *  - `character`      → banco (GET/PUT /api/me/character): existe? qual classe?
 *  - `liveAppearance` / `liveWeapon` → estado Colyseus AO VIVO do próprio
 *    jogador (o servidor é quem manda no que está renderizado no mundo).
 *  - `worldReady`     → cena Phaser terminou o create() (player existe).
 *
 * O GameCanvas escuta [liveAppearance, liveWeapon, worldReady] e aplica na
 * cena via setLocalAppearance — criação, login e equipar passam TODOS pelo
 * mesmo caminho servidor → estado → cena.
 */
import { create } from 'zustand';
import { findClassWeaponRef, type PlayerCharacterConfigV1 } from '../shared/characters/PlayerCharacterShapes';
import { fetchMyCharacter, fetchPublicAssetCategories } from '../lib/playerCharacterApi';

interface PlayerCharacterStore {
  /** GET /api/me/character já respondeu com sucesso. */
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
  character: PlayerCharacterConfigV1 | null;
  tableMissing: boolean;
  tableSql: string | null;
  /** Espelho do estado Colyseus do PRÓPRIO jogador ('' = sem personagem). */
  liveAppearance: string;
  liveWeapon: string;
  worldReady: boolean;
  /**
   * Ref da arma padrão da classe (assets-controller → default-weapons), só
   * para a UI mostrar o ícone/estado; quem decide o que equipa é o servidor.
   * undefined = ainda não consultado; null = classe sem arma liberada.
   */
  classWeaponRef: string | null | undefined;
  /** Última recusa do servidor ao equipar (mostrada na hotbar). */
  equipError: string | null;
  /**
   * Envia equipar/desequipar. Sem `ref` o servidor equipa a arma da classe;
   * com `ref` de ferramenta (gen:crafttools/…) equipa a ferramenta do inventário.
   */
  equipSender: ((equip: boolean, ref?: string) => void) | null;
  characterReadySender: (() => void) | null;

  load: () => Promise<void>;
  loadClassWeapon: () => Promise<void>;
  setCharacter: (c: PlayerCharacterConfigV1) => void;
  setLive: (appearance: string, weapon: string) => void;
  setWorldReady: (ready: boolean) => void;
  setEquipError: (message: string | null) => void;
  setSenders: (equip: ((equip: boolean, ref?: string) => void) | null, ready: (() => void) | null) => void;
  reset: () => void;
}

const initial = {
  loaded: false,
  loading: false,
  loadError: null as string | null,
  character: null as PlayerCharacterConfigV1 | null,
  tableMissing: false,
  tableSql: null as string | null,
  liveAppearance: '',
  liveWeapon: '',
  worldReady: false,
  classWeaponRef: undefined as string | null | undefined,
  equipError: null as string | null,
  equipSender: null as ((equip: boolean, ref?: string) => void) | null,
  characterReadySender: null as (() => void) | null,
};

export const usePlayerCharacterStore = create<PlayerCharacterStore>((set, get) => ({
  ...initial,

  async load() {
    if (get().loading) return;
    set({ loading: true, loadError: null });
    try {
      const res = await fetchMyCharacter();
      set({
        loading: false,
        loaded: true,
        character: res.character,
        tableMissing: !!res.tableMissing,
        tableSql: res.tableSql ?? null,
      });
    } catch (e) {
      // loaded continua false: o modal não abre sem saber a resposta real
      // (evita pedir criação para quem JÁ tem personagem numa falha de rede).
      set({ loading: false, loadError: e instanceof Error ? e.message : String(e) });
    }
  },

  async loadClassWeapon() {
    const character = get().character;
    if (!character) return;
    try {
      const categories = await fetchPublicAssetCategories();
      const current = get().character;
      if (current?.classId !== character.classId) return; // trocou de personagem no meio
      set({ classWeaponRef: findClassWeaponRef(categories, character.classId) });
    } catch (e) {
      console.warn('[personagem] arma da classe indisponível:', e instanceof Error ? e.message : e);
    }
  },

  setCharacter(c) {
    const previous = get().character;
    set({
      character: c,
      loaded: true,
      loadError: null,
      ...(previous?.classId !== c.classId ? { classWeaponRef: undefined } : {}),
    });
  },

  setLive(appearance, weapon) {
    const s = get();
    if (s.liveAppearance === appearance && s.liveWeapon === weapon) return;
    set({ liveAppearance: appearance, liveWeapon: weapon });
  },

  setWorldReady(ready) {
    if (get().worldReady !== ready) set({ worldReady: ready });
  },

  setEquipError(message) {
    set({ equipError: message });
  },

  setSenders(equip, ready) {
    set({ equipSender: equip, characterReadySender: ready });
  },

  reset() {
    set({ ...initial });
  },
}));
