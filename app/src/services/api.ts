import type { Game, GameMap, Team, GameConfig } from '../types';
import { API_BASE } from '../../api';

const USE_MOCKS = true;

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

export const api = USE_MOCKS
  ? require('./__mocks__/api').mockApi
  : {
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
      joinGame: (joinCode: string, name: string, color: string) =>
        request<{ game: Game; team: Team }>(`/api/games/${joinCode}/join`, {
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
        request<void>(`/api/games/${gameId}/end`, { method: 'PUT' }),
      claimLandmark: (gameId: string, landmarkId: string) =>
        request<void>(`/api/games/${gameId}/claim`, {
          method: 'POST',
          body: JSON.stringify({ landmarkId }),
        }),
      completeChallenge: (gameId: string, landmarkId: string) =>
        request<void>(`/api/games/${gameId}/challenge`, {
          method: 'POST',
          body: JSON.stringify({ landmarkId, outcome: 'complete' }),
        }),
      failChallenge: (gameId: string, landmarkId: string) =>
        request<void>(`/api/games/${gameId}/challenge`, {
          method: 'POST',
          body: JSON.stringify({ landmarkId, outcome: 'fail' }),
        }),
      vetoChallenge: (gameId: string, landmarkId: string) =>
        request<void>(`/api/games/${gameId}/challenge`, {
          method: 'POST',
          body: JSON.stringify({ landmarkId, outcome: 'veto' }),
        }),
      tagTeam: (gameId: string, targetTeamId: string) =>
        request<void>(`/api/games/${gameId}/tag`, {
          method: 'POST',
          body: JSON.stringify({ targetTeamId }),
        }),
      disputeTag: (gameId: string) =>
        request<void>(`/api/games/${gameId}/dispute`, { method: 'POST' }),
      registerPushToken: (gameId: string, token: string) =>
        request<void>(`/api/games/${gameId}/push-token`, {
          method: 'POST',
          body: JSON.stringify({ token }),
        }),
      getScoreboard: (gameId: string) =>
        request<unknown[]>(`/api/games/${gameId}/scoreboard`),
      getLog: (gameId: string, teamId?: string) => {
        const params = teamId ? `?teamId=${teamId}` : '';
        return request<unknown[]>(`/api/games/${gameId}/log${params}`);
      },
    };
