import { create } from 'zustand';
import type { Game, Landmark, LandmarkState, GameStatus, GameConfig } from '../types';

function hasStatus(s: any): s is LandmarkState {
  return typeof s?.status === 'string';
}

function normalizeState(raw: any): LandmarkState {
  if (hasStatus(raw)) {
    return { landmarkId: raw.landmarkId, status: raw.status, teamId: raw.teamId };
  }
  return {
    landmarkId: raw?.landmarkId,
    status: raw?.locked ? 'locked' : raw?.teamId ? 'claimed' : 'unclaimed',
    teamId: raw?.teamId,
  };
}

export function normalizeGame(game: Game): Game {
  if (!game || !Array.isArray(game.landmarkStates)) return game;
  return { ...game, landmarkStates: game.landmarkStates.map(normalizeState) };
}

interface GameStore {
  game: Game | null;
  setGame: (game: Game) => void;
  updateStatus: (status: GameStatus) => void;
  updateLandmarkState: (state: LandmarkState) => void;
  clearGame: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  game: null,
  setGame: (game) => set({ game: normalizeGame(game) }),
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
