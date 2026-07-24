import type { Game, GameMap, Team, Landmark, GameConfig } from '../../types';

let nextId = 1;
function uid() {
  return String(nextId++);
}

const vancouverMap: GameMap = {
  id: 'default-vancouver',
  name: 'Vancouver Downtown',
  center: { lat: 49.2827, lng: -123.1207 },
  defaultZoom: 14,
  defaultVicinityRadius: 30,
  winThreshold: 20,
  data: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { type: 'boundary', name: 'Vancouver Boundary' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-123.224, 49.319],
            [-123.005, 49.319],
            [-123.005, 49.215],
            [-123.224, 49.215],
            [-123.224, 49.319],
          ]],
        },
      },
      ...Array.from({ length: 40 }, (_, i) => ({
        type: 'Feature' as const,
        properties: {
          type: 'landmark',
          name: `Landmark ${i + 1}`,
          challengeText: i < 20 ? `Find the hidden detail on Landmark ${i + 1}` : undefined,
          imageUrl: undefined,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [
            -123.1207 + (i % 8) * 0.012 - 0.048,
            49.2827 + Math.floor(i / 8) * 0.012 - 0.024,
          ] as [number, number],
        },
      })),
    ],
  },
};

const maps: GameMap[] = [vancouverMap];
const games: Record<string, { game: Game; teams: Team[] }> = {};

function createLandmarksFromMap(map: GameMap, gameId: string): Landmark[] {
  return map.data.features
    .filter((f) => f.properties?.type === 'landmark')
    .map((f, i) => {
      const coords = f.geometry.coordinates as [number, number];
      return {
        id: uid(),
        gameId,
        name: (f.properties?.name as string) ?? `Landmark ${i + 1}`,
        latitude: coords[1],
        longitude: coords[0],
        imageUrl: f.properties?.imageUrl as string | undefined,
        challengeText: f.properties?.challengeText as string | undefined,
        mapLandmarkIndex: i,
      };
    });
}

export const mockApi = {
  fetchMaps: async () => [...maps],
  getMap: async (id: string) => {
    const map = maps.find((m) => m.id === id);
    if (!map) throw new Error('Map not found');
    return map;
  },
  importMap: async (data: unknown) => {
    const map = data as GameMap;
    map.id = uid();
    maps.push(map);
    return map;
  },
  createGame: async (mapId: string, config: GameConfig) => {
    const map = maps.find((m) => m.id === mapId);
    if (!map) throw new Error('Map not found');
    const gameId = uid();
    const game: Game = {
      id: gameId,
      joinCode: uid().slice(0, 6).toUpperCase(),
      mapId,
      status: 'lobby',
      config,
      teams: [],
      landmarks: createLandmarksFromMap(map, gameId),
      landmarkStates: [],
    };
    games[gameId] = { game, teams: [] };
    return game;
  },
  joinGame: async (joinCode: string, name: string, color: string) => {
    const entry = Object.values(games).find(
      (g) => g.game.joinCode === joinCode
    );
    if (!entry) throw new Error('Game not found');
    const team: Team = {
      id: uid(),
      gameId: entry.game.id,
      name,
      color,
    };
    entry.teams.push(team);
    entry.game.teams = [...entry.teams];
    return { game: entry.game, team };
  },
  getGame: async (gameId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    return entry.game;
  },
  startGame: async (gameId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    entry.game.status = 'active';
    entry.game.startedAt = new Date().toISOString();
  },
  pauseGame: async (gameId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    entry.game.status = 'paused';
  },
  resumeGame: async (gameId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    entry.game.status = 'active';
  },
  endGame: async (gameId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    entry.game.status = 'ended';
  },
  claimLandmark: async (gameId: string, landmarkId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    const existing = entry.game.landmarkStates.find(
      (s) => s.landmarkId === landmarkId
    );
    if (existing?.status === 'locked') throw new Error('Landmark is locked');
    const states = entry.game.landmarkStates.filter(
      (s) => s.landmarkId !== landmarkId
    );
    states.push({
      landmarkId,
      status: 'claimed',
      teamId: entry.teams[0]?.id,
    });
    entry.game.landmarkStates = states;
  },
  completeChallenge: async (gameId: string, landmarkId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    const states = entry.game.landmarkStates.filter(
      (s) => s.landmarkId !== landmarkId
    );
    states.push({ landmarkId, status: 'locked', teamId: entry.teams[0]?.id });
    entry.game.landmarkStates = states;
  },
  tagTeam: async (gameId: string, _targetTeamId: string) => {},
  disputeTag: async (_gameId: string) => {},
  registerPushToken: async () => {},
  getScoreboard: async (gameId: string) => {
    const entry = games[gameId];
    if (!entry) return [];
    return entry.teams.map((t) => {
      const claimed = entry.game.landmarkStates.filter(
        (s) => s.teamId === t.id && (s.status === 'claimed' || s.status === 'locked')
      ).length;
      const locked = entry.game.landmarkStates.filter(
        (s) => s.teamId === t.id && s.status === 'locked'
      ).length;
      return { team: t, claimed, locked };
    });
  },
  getLog: async () => [],
};
