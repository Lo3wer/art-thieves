import { create } from 'zustand';
import type { LocationPing } from '../types';
import { useTeamStore } from './useTeamStore';

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
  setOwnLocation: (latitude, longitude) =>
    set((s) => {
      const myTeamId = useTeamStore.getState().myTeamId;
      const ping: LocationPing = {
        teamId: myTeamId ?? '',
        latitude,
        longitude,
        timestamp: new Date().toISOString(),
      };
      const filtered = s.teamLocations.filter((t) => t.teamId !== myTeamId);
      return { ownLocation: { latitude, longitude }, teamLocations: [...filtered, ping] };
    }),
  updateTeamLocation: (ping) =>
    set((s) => {
      const filtered = s.teamLocations.filter((t) => t.teamId !== ping.teamId);
      return { teamLocations: [...filtered, ping] };
    }),
  clearLocations: () => set({ ownLocation: null, teamLocations: [] }),
}));
