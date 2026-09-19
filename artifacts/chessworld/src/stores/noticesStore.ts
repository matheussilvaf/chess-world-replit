import { create } from 'zustand';

export interface HudNotice {
  id: string;
  title: string;
  body?: string;
  onClick?: () => void;
  actions?: Array<{ label: string; onClick: () => void; variant?: 'primary' | 'danger' | 'secondary' }>;
}

interface NoticesState {
  notices: HudNotice[];
  pushNotice: (notice: Omit<HudNotice, 'id'>) => string;
  dismiss: (id: string) => void;
}

export const useNoticesStore = create<NoticesState>((set) => ({
  notices: [],
  pushNotice: (notice) => {
    const id = crypto.randomUUID();
    set((state) => ({ notices: [...state.notices, { ...notice, id }].slice(-4) }));
    window.setTimeout(() => set((state) => ({ notices: state.notices.filter((item) => item.id !== id) })), 6_000);
    return id;
  },
  dismiss: (id) => set((state) => ({ notices: state.notices.filter((item) => item.id !== id) })),
}));

export const pushNotice = (notice: Omit<HudNotice, 'id'>) => useNoticesStore.getState().pushNotice(notice);