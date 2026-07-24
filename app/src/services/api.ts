import type { Game, GameMap, Team, GameConfig } from '../types';
import { API_BASE } from '../../api';
import { useTeamStore } from '../stores/useTeamStore';

const USE_MOCKS = false;

export class ApiError extends Error {
  status: number;
  data?: any;
  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let body: any;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    throw new ApiError(
      res.status,
      typeof body === 'string' ? body : body.error ?? `HTTP ${res.status}`,
      typeof body === 'object' && body.data ? body.data : undefined
    );
  }
  return res.json();
}

function getTeamId(): string {
  return useTeamStore.getState().myTeamId ?? '';
}

export const api = USE_MOCKS
  ? require('./__mocks__/api').mockApi
  : {
      setCurrentTeam: (_teamId: string | null) => {},

      fetchMaps: () => request<GameMap[]>('/api/maps'),
      getMap: (id: string) => request<GameMap>(`/api/maps/${id}`),
      importMap: (data: unknown) =>
        request<GameMap>('/api/maps', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      createGame: (mapId: string, config: GameConfig) =>
        request<Game>('/api/games', {
          method: 'POST',
          body: JSON.stringify({ mapId, config }),
        }),
      lookupGame: (joinCode: string) =>
        request<{ id: string; status: string; teams: { id: string; name: string; color: string }[] }>(
          `/api/games/lookup/${joinCode}`
        ),
      joinGame: (joinCode: string, name: string, color: string) =>
        request<{ game: Game; team: Team }>(`/api/games/join/${joinCode}`, {
          method: 'POST',
          body: JSON.stringify({ name, color }),
        }),
      getGame: (gameId: string) => request<Game>(`/api/games/${gameId}`),
      updateConfig: (gameId: string, config: Partial<GameConfig>) =>
        request<void>(`/api/games/${gameId}/config`, {
          method: 'PUT',
          body: JSON.stringify(config),
        }),
      startGame: (gameId: string) =>
        request<void>(`/api/games/${gameId}/start`, { method: 'POST' }),
      pauseGame: (gameId: string) =>
        request<void>(`/api/games/${gameId}/pause`, { method: 'PUT' }),
      resumeGame: (gameId: string) =>
        request<void>(`/api/games/${gameId}/resume`, { method: 'PUT' }),
      endGame: (gameId: string) =>
        request<{ winnerId: string | null; isTie: boolean }>(`/api/games/${gameId}/end`, { method: 'PUT' }),
      claimLandmark: (gameId: string, landmarkId: string, latitude: number, longitude: number) =>
        request<void>(`/api/games/${gameId}/claim`, {
          method: 'POST',
          body: JSON.stringify({ landmarkId, teamId: getTeamId(), latitude, longitude }),
        }),
      completeChallenge: (gameId: string, landmarkId: string) =>
        request<void>(`/api/games/${gameId}/challenge`, {
          method: 'POST',
          body: JSON.stringify({ landmarkId, outcome: 'complete', teamId: getTeamId() }),
        }),
      failChallenge: (gameId: string, landmarkId: string) =>
        request<void>(`/api/games/${gameId}/challenge`, {
          method: 'POST',
          body: JSON.stringify({ landmarkId, outcome: 'fail', teamId: getTeamId() }),
        }),
      vetoChallenge: (gameId: string, landmarkId: string) =>
        request<void>(`/api/games/${gameId}/challenge`, {
          method: 'POST',
          body: JSON.stringify({ landmarkId, outcome: 'veto', teamId: getTeamId() }),
        }),
      tagTeam: (gameId: string, targetTeamId: string) =>
        request<void>(`/api/games/${gameId}/tag`, {
          method: 'POST',
          body: JSON.stringify({ targetTeamId, teamId: getTeamId() }),
        }),
      disputeTag: (gameId: string) =>
        request<void>(`/api/games/${gameId}/dispute`, {
          method: 'POST',
          body: JSON.stringify({ teamId: getTeamId() }),
        }),
      registerPushToken: (gameId: string, token: string) =>
        request<void>(`/api/games/${gameId}/push-token`, {
          method: 'POST',
          body: JSON.stringify({ token, teamId: getTeamId() }),
        }),
      getScoreboard: (gameId: string) =>
        request<unknown[]>(`/api/games/${gameId}/scoreboard`),
      getLog: (gameId: string, teamId?: string) => {
        const params = teamId ? `?teamId=${teamId}` : '';
        return request<unknown[]>(`/api/games/${gameId}/log${params}`);
      },
      getActiveTag: async (_gameId: string, _teamId: string) => null,
      getFrozenTeams: (gameId: string) =>
        request<{ teamId: string; frozenUntil: string }[]>(`/api/games/${gameId}/frozen-teams`),
    };
