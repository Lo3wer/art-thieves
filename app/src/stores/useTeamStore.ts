import { create } from 'zustand';

interface TeamStore {
  myTeamId: string | null;
  myTeamName: string | null;
  myTeamColor: string | null;
  isHost: boolean;
  isFrozen: boolean;
  freezeEndsAt: string | null;
  disputeAvailableUntil: string | null;
  frozenTeams: Record<string, string>;
  tagCooldowns: Record<string, string>;
  setMyTeam: (id: string, name: string, color: string) => void;
  setHost: (host: boolean) => void;
  setFrozen: (frozen: boolean, endsAt?: string | null) => void;
  setDisputeWindow: (until: string | null) => void;
  setFrozenTeams: (teams: Record<string, string>) => void;
  addFrozenTeam: (teamId: string, frozenUntil: string) => void;
  removeFrozenTeam: (teamId: string) => void;
  setTagCooldown: (teamId: string, endsAt: string) => void;
  removeTagCooldown: (teamId: string) => void;
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
  frozenTeams: {},
  tagCooldowns: {},
  setMyTeam: (id, name, color) => set({ myTeamId: id, myTeamName: name, myTeamColor: color }),
  setHost: (isHost) => set({ isHost }),
  setFrozen: (isFrozen, freezeEndsAt) => set({ isFrozen, freezeEndsAt }),
  setDisputeWindow: (disputeAvailableUntil) => set({ disputeAvailableUntil }),
  setFrozenTeams: (frozenTeams) => set({ frozenTeams }),
  addFrozenTeam: (teamId, frozenUntil) =>
    set((s) => ({ frozenTeams: { ...s.frozenTeams, [teamId]: frozenUntil } })),
  removeFrozenTeam: (teamId) =>
    set((s) => {
      const { [teamId]: _, ...rest } = s.frozenTeams;
      return { frozenTeams: rest };
    }),
  setTagCooldown: (teamId, endsAt) =>
    set((s) => ({ tagCooldowns: { ...s.tagCooldowns, [teamId]: endsAt } })),
  removeTagCooldown: (teamId) =>
    set((s) => {
      const { [teamId]: _, ...rest } = s.tagCooldowns;
      return { tagCooldowns: rest };
    }),
  clear: () =>
    set({
      myTeamId: null,
      myTeamName: null,
      myTeamColor: null,
      isHost: false,
      isFrozen: false,
      freezeEndsAt: null,
      disputeAvailableUntil: null,
      frozenTeams: {},
      tagCooldowns: {},
    }),
}));
