import { create } from 'zustand';
import type { GameMap } from '../types';

interface LobbyStore {
  joinCode: string | null;
  availableMaps: GameMap[];
  selectedMapId: string | null;
  setJoinCode: (code: string | null) => void;
  setAvailableMaps: (maps: GameMap[]) => void;
  selectMap: (id: string) => void;
  clear: () => void;
}

export const useLobbyStore = create<LobbyStore>((set) => ({
  joinCode: null,
  availableMaps: [],
  selectedMapId: null,
  setJoinCode: (joinCode) => set({ joinCode }),
  setAvailableMaps: (availableMaps) => set({ availableMaps }),
  selectMap: (selectedMapId) => set({ selectedMapId }),
  clear: () => set({ joinCode: null, availableMaps: [], selectedMapId: null }),
}));
