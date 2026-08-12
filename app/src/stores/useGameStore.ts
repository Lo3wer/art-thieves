import { create } from 'zustand';
import type { Game, Landmark, LandmarkState, GameStatus, GameConfig, Penalty } from '../types';

function hasStatus(s: any): s is LandmarkState {
  return typeof s?.status === 'string';
}

function normalizeState(raw: any): LandmarkState {
  if (hasStatus(raw)) {
    return {
      landmarkId: raw.landmarkId,
      status: raw.status,
      teamId: raw.teamId,
      claimedAt: raw.claimedAt,
      challenge: raw.challenge,
    };
  }
  return {
    landmarkId: raw?.landmarkId,
    status: raw?.locked ? 'locked' : raw?.teamId ? 'claimed' : 'unclaimed',
    teamId: raw?.teamId,
    claimedAt: raw?.claimedAt,
    challenge: raw?.challenge,
  };
}

export function normalizeGame(game: Game): Game {
  if (!game || !Array.isArray(game.landmarkStates)) return game;
  return { ...game, landmarkStates: game.landmarkStates.map(normalizeState) };
}

interface GameStore {
  game: Game | null;
  setGame: (game: Game) => void;
  applyDiff: (diff: any) => void;
  updateStatus: (status: GameStatus) => void;
  updateLandmarkState: (state: LandmarkState) => void;
  clearGame: () => void;
}

function normalizePenalties(penalties?: Penalty[]): Penalty[] | undefined {
  return penalties ?? undefined;
}

export const useGameStore = create<GameStore>((set) => ({
  game: null,
  setGame: (game) => set({ game: normalizeGame(game) }),
  applyDiff: (diff) =>
    set((s) => {
      if (!s.game) return s;
      const game = s.game;
      const next: Game = { ...game };
      if (diff.status !== undefined) next.status = diff.status;
      if (diff.startedAt !== undefined) next.startedAt = diff.startedAt;
      if (diff.pausedAt !== undefined) next.pausedAt = diff.pausedAt;
      if (diff.totalPausedMs !== undefined) next.totalPausedMs = diff.totalPausedMs;
      if (diff.config) next.config = diff.config;
      if (diff.addedTeams) next.teams = [...game.teams, ...diff.addedTeams];
      if (diff.landmarkStates) {
        const map = new Map(game.landmarkStates.map((x) => [x.landmarkId, x]));
        diff.landmarkStates.forEach((raw: any) => {
          const normalized = normalizeState(raw);
          map.set(normalized.landmarkId, normalized);
        });
        next.landmarkStates = [...map.values()];
      }
      if (diff.penalties !== undefined) next.penalties = normalizePenalties(diff.penalties);
      return { game: next };
    }),
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
