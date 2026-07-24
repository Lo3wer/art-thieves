import { create } from 'zustand';
import type { LocationPing } from '../types';

interface LocationStore {
  ownLocation: { latitude: number; longitude: number } | null;
  teamLocations: LocationPing[];
  setOwnLocation: (lat: number, lng: number) => void;
  updateTeamLocation: (ping: LocationPing) => void;
  clearLocations: () => void;
}

export const useLocationStore = create<LocationStore>((set) => ({
  ownLocation: null,
  teamLocations: [],
  setOwnLocation: (latitude, longitude) => set({ ownLocation: { latitude, longitude } }),
  updateTeamLocation: (ping) =>
    set((s) => {
      const filtered = s.teamLocations.filter((t) => t.teamId !== ping.teamId);
      return { teamLocations: [...filtered, ping] };
    }),
  clearLocations: () => set({ ownLocation: null, teamLocations: [] }),
}));
