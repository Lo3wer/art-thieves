import { create } from 'zustand';
import type { Game, Landmark, LandmarkState, GameStatus, GameConfig } from '../types';

interface GameStore {
  game: Game | null;
  setGame: (game: Game) => void;
  updateStatus: (status: GameStatus) => void;
  updateLandmarkState: (state: LandmarkState) => void;
  clearGame: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  game: null,
  setGame: (game) => set({ game }),
  updateStatus: (status) =>
    set((s) => {
      if (!s.game) return s;
      return { game: { ...s.game, status } };
    }),
  updateLandmarkState: (newState) =>
    set((s) => {
      if (!s.game) return s;
      const states = s.game.landmarkStates.filter(
        (ls) => ls.landmarkId !== newState.landmarkId
      );
      return {
        game: { ...s.game, landmarkStates: [...states, newState] },
      };
    }),
  clearGame: () => set({ game: null }),
}));
