import { create } from 'zustand';
import { academyApi } from '../game/network/academyApi';
import { DEFAULT_ACADEMY_BOTS, mergeAcademyBots, type AcademyBot } from '../shared/academy/AcademyShapes';

interface AcademyState {
  bots: AcademyBot[];
  loaded: boolean;
  inAcademy: boolean;
  setInAcademy: (value: boolean) => void;
  loadBots: () => Promise<void>;
  botById: (id: string) => AcademyBot | undefined;
}

export const useAcademyStore = create<AcademyState>((set, get) => ({
  bots: DEFAULT_ACADEMY_BOTS,
  loaded: false,
  inAcademy: false,
  setInAcademy: (value) => set({ inAcademy: value }),
  botById: (id) => get().bots.find((bot) => bot.id === id),
  loadBots: async () => {
    try {
      const response = await academyApi.getBots();
      set({ bots: mergeAcademyBots(response.bots), loaded: true });
      if (response.schemaMissing) console.warn('[Academia] Tabela academy_bots ausente; usando configurações padrão.');
    } catch (error) {
      console.warn('[Academia] Falha ao carregar bots; usando configurações padrão:', error);
      set({ bots: DEFAULT_ACADEMY_BOTS, loaded: true });
    }
  },
}));