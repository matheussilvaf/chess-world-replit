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
import type { PlayerCharacterConfigV1 } from '../shared/characters/PlayerCharacterShapes';
import { fetchMyCharacter } from '../lib/playerCharacterApi';

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
  panelOpen: boolean;
  /** Envia equipar/desequipar; `ref` opcional escolhe a ARMA (itens de teste). */
  equipSender: ((equip: boolean, ref?: string) => void) | null;
  characterReadySender: (() => void) | null;

  load: () => Promise<void>;
  setCharacter: (c: PlayerCharacterConfigV1) => void;
  setLive: (appearance: string, weapon: string) => void;
  setWorldReady: (ready: boolean) => void;
  setPanelOpen: (open: boolean) => void;
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
  panelOpen: false,
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

  setCharacter(c) {
    set({ character: c, loaded: true, loadError: null });
  },

  setLive(appearance, weapon) {
    const s = get();
    if (s.liveAppearance === appearance && s.liveWeapon === weapon) return;
    set({ liveAppearance: appearance, liveWeapon: weapon });
  },

  setWorldReady(ready) {
    if (get().worldReady !== ready) set({ worldReady: ready });
  },

  setPanelOpen(open) {
    set({ panelOpen: open });
  },

  setSenders(equip, ready) {
    set({ equipSender: equip, characterReadySender: ready });
  },

  reset() {
    set({ ...initial });
  },
}));
