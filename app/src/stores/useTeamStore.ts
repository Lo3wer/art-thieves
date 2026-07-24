import { create } from 'zustand';

interface TeamStore {
  myTeamId: string | null;
  myTeamName: string | null;
  myTeamColor: string | null;
  isHost: boolean;
  isFrozen: boolean;
  freezeEndsAt: string | null;
  disputeAvailableUntil: string | null;
  setMyTeam: (id: string, name: string, color: string) => void;
  setHost: (host: boolean) => void;
  setFrozen: (frozen: boolean, endsAt?: string | null) => void;
  setDisputeWindow: (until: string | null) => void;
  clear: () => void;
}

export const useTeamStore = create<TeamStore>((set) => ({
  myTeamId: null,
  myTeamName: null,
  myTeamColor: null,
  isHost: false,
  isFrozen: false,
  freezeEndsAt: null,
  disputeAvailableUntil: null,
  setMyTeam: (id, name, color) => set({ myTeamId: id, myTeamName: name, myTeamColor: color }),
  setHost: (isHost) => set({ isHost }),
  setFrozen: (isFrozen, freezeEndsAt) => set({ isFrozen, freezeEndsAt }),
  setDisputeWindow: (disputeAvailableUntil) => set({ disputeAvailableUntil }),
  clear: () =>
    set({
      myTeamId: null,
      myTeamName: null,
      myTeamColor: null,
      isHost: false,
      isFrozen: false,
      freezeEndsAt: null,
      disputeAvailableUntil: null,
    }),
}));
