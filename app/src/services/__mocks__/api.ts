import type { Game, GameMap, Team, Landmark, GameConfig, LandmarkState, LogEntry, TagEvent } from '../../types';

let nextId = 1;
function uid() {
  return String(nextId++);
}

function now() {
  return new Date().toISOString();
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
          ...(i === 0
            ? {
                challenge: {
                  text: 'You may instantly lock this landmark, but you lose access to your tracker for 30 minutes. Alternatively, you may veto to avoid the tracker penalty, but you will not lock this landmark.',
                  mode: 'instant',
                  instant: {
                    completeLabel: 'Lock now (lose tracker 30 min)',
                    completeNote: 'You will lose access to your tracker for 30 minutes.',
                    vetoLabel: 'Veto (don\u2019t lock)',
                    vetoNote: 'No tracker penalty, but this landmark is not locked.',
                    penalty: {
                      type: 'tracker',
                      minutes: 30,
                      note: 'Your team has lost access to its tracker for 30 minutes.',
                    },
                  },
                },
              }
            : {}),
          ...(i === 1
            ? {
                challenge: {
                  text: 'Return to this landmark at least 1 hour from now to lock it. You may leave and return freely, but this challenge fails if another team locks it before you.',
                  mode: 'delayed',
                  delayed: {
                    delayMinutes: 60,
                    returnToLandmark: true,
                    failsIfLockedByOtherTeam: true,
                  },
                },
              }
            : {}),
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

interface GameEntry {
  game: Game;
  teams: Team[];
  log: LogEntry[];
  tagEvents: TagEvent[];
  challengeAttempts: { landmarkId: string; teamId: string }[];
  nextTagAvailableAt: Record<string, string>;
  hostTeamId: string | null;
}

const games: Record<string, GameEntry> = {};

function addLog(entry: GameEntry, type: string, data: Record<string, unknown>) {
  entry.log.push({
    id: uid(),
    gameId: entry.game.id,
    type,
    data,
    timestamp: now(),
  });
}

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
        challenge: f.properties?.challenge as Landmark['challenge'],
        mapLandmarkIndex: i,
      };
    });
}

function randomJoinCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export let currentTeamId: string | null = null;

export function setCurrentTeam(teamId: string | null) {
  currentTeamId = teamId;
}

function getTeamColor(teamId: string): string {
  const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];
  return colors[parseInt(teamId) % colors.length];
}

const TASK_COLORS: Record<string, string> = {};

export const mockApi = {
  fetchMaps: async () => [...maps],

  getMap: async (id: string) => {
    const map = maps.find((m) => m.id === id);
    if (!map) throw new Error('Map not found');
    return map;
  },

  importMapFile: async () => {
    throw new Error('KML/KMZ map import is not supported in mock mode');
  },

  createGame: async (mapId: string, config: GameConfig) => {
    const map = maps.find((m) => m.id === mapId);
    if (!map) throw new Error('Map not found');
    const gameId = uid();
    const landmarks = createLandmarksFromMap(map, gameId);
    const game: Game = {
      id: gameId,
      joinCode: randomJoinCode(),
      mapId,
      status: 'lobby',
      config,
      totalPausedMs: 0,
      teams: [],
      landmarks,
      landmarkStates: landmarks.map((l) => ({
        landmarkId: l.id,
        status: 'unclaimed' as const,
      })),
    };
    games[gameId] = {
      game,
      teams: [],
      log: [],
      tagEvents: [],
      challengeAttempts: [],
      nextTagAvailableAt: {},
      hostTeamId: currentTeamId,
    };
    addLog(games[gameId], 'game_created', { mapName: map.name });
    return game;
  },

  joinGame: async (joinCode: string, name: string, color: string) => {
    const entry = Object.values(games).find(
      (g) => g.game.joinCode === joinCode
    );
    if (!entry) throw new Error('Game not found');
    if (entry.game.status !== 'lobby') throw new Error('Game already started');
    const team: Team = {
      id: uid(),
      gameId: entry.game.id,
      name,
      color,
    };
    entry.teams.push(team);
    entry.game.teams = [...entry.teams];
    TASK_COLORS[team.id] = color;
    addLog(entry, 'team_joined', { teamName: name, teamColor: color });
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
    entry.game.startedAt = now();
    addLog(entry, 'game_started', {});
  },

  pauseGame: async (gameId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    entry.game.status = 'paused';
    addLog(entry, 'game_paused', {});
  },

  resumeGame: async (gameId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    entry.game.status = 'active';
    addLog(entry, 'game_resumed', {});
  },

  endGame: async (gameId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    entry.game.status = 'ended';
    addLog(entry, 'game_ended', {});
  },

  claimLandmark: async (gameId: string, landmarkId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    if (!currentTeamId) throw new Error('No current team');
    if (entry.game.status !== 'active') throw new Error('Game not active');

    const existing = entry.game.landmarkStates.find(
      (s) => s.landmarkId === landmarkId
    );
    if (existing?.status === 'locked') throw new Error('Landmark is locked');
    if (existing?.teamId === currentTeamId) throw new Error('Already claimed by your team');

    const prevTeamId = existing?.teamId;
    const isSteal = prevTeamId != null && prevTeamId !== currentTeamId;

    const states = entry.game.landmarkStates.filter(
      (s) => s.landmarkId !== landmarkId
    );
    states.push({
      landmarkId,
      status: 'claimed',
      teamId: currentTeamId,
    });
    entry.game.landmarkStates = states;

    const landmark = entry.game.landmarks.find((l) => l.id === landmarkId);
    const team = entry.teams.find((t) => t.id === currentTeamId);

    if (isSteal) {
      const prevTeam = entry.teams.find((t) => t.id === prevTeamId);
      addLog(entry, 'landmark_stolen', {
        landmarkName: landmark?.name ?? '',
        teamName: team?.name ?? '',
        fromTeamName: prevTeam?.name ?? '',
      });
    } else {
      addLog(entry, 'landmark_claimed', {
        landmarkName: landmark?.name ?? '',
        teamName: team?.name ?? '',
      });
    }
  },

  completeChallenge: async (gameId: string, landmarkId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    if (!currentTeamId) throw new Error('No current team');
    if (entry.game.status !== 'active') throw new Error('Game not active');

    const existing = entry.game.landmarkStates.find(
      (s) => s.landmarkId === landmarkId
    );
    if (existing?.status === 'locked') throw new Error('Landmark is already locked');
    if (existing?.teamId !== currentTeamId) throw new Error('Landmark not claimed by your team');

    const attempted = entry.challengeAttempts.some(
      (a) => a.landmarkId === landmarkId && a.teamId === currentTeamId
    );
    if (attempted) throw new Error('Your team already attempted this challenge');

    const states = entry.game.landmarkStates.filter(
      (s) => s.landmarkId !== landmarkId
    );
    states.push({ landmarkId, status: 'locked', teamId: currentTeamId });
    entry.game.landmarkStates = states;
    entry.challengeAttempts.push({ landmarkId, teamId: currentTeamId });

    const landmark = entry.game.landmarks.find((l) => l.id === landmarkId);
    const team = entry.teams.find((t) => t.id === currentTeamId);
    addLog(entry, 'challenge_completed', {
      landmarkName: landmark?.name ?? '',
      teamName: team?.name ?? '',
    });
  },

  failChallenge: async (gameId: string, landmarkId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    if (!currentTeamId) throw new Error('No current team');
    if (entry.game.status !== 'active') throw new Error('Game not active');

    entry.challengeAttempts.push({ landmarkId, teamId: currentTeamId });

    const landmark = entry.game.landmarks.find((l) => l.id === landmarkId);
    const team = entry.teams.find((t) => t.id === currentTeamId);
    addLog(entry, 'challenge_failed', {
      landmarkName: landmark?.name ?? '',
      teamName: team?.name ?? '',
    });
  },

  passChallenge: async (gameId: string, landmarkId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    if (!currentTeamId) throw new Error('No current team');
    if (entry.game.status !== 'active') throw new Error('Game not active');

    entry.challengeAttempts.push({ landmarkId, teamId: currentTeamId });

    const landmark = entry.game.landmarks.find((l) => l.id === landmarkId);
    const team = entry.teams.find((t) => t.id === currentTeamId);
    addLog(entry, 'challenge_pass', {
      landmarkName: landmark?.name ?? '',
      teamName: team?.name ?? '',
    });
  },

  tagTeam: async (gameId: string, targetTeamId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    if (!currentTeamId) throw new Error('No current team');
    if (entry.game.status !== 'active') throw new Error('Game not active');
    if (currentTeamId === targetTeamId) throw new Error('Cannot tag yourself');

    const tagEvent: TagEvent = {
      id: uid(),
      gameId,
      taggerTeamId: currentTeamId,
      targetTeamId,
      timestamp: now(),
      disputed: false,
      voided: false,
    };
    entry.tagEvents.push(tagEvent);

    const tagger = entry.teams.find((t) => t.id === currentTeamId);
    const target = entry.teams.find((t) => t.id === targetTeamId);
    addLog(entry, 'tag_created', {
      taggerName: tagger?.name ?? '',
      targetName: target?.name ?? '',
    });
    return tagEvent;
  },

  disputeTag: async (gameId: string) => {
    const entry = games[gameId];
    if (!entry) throw new Error('Game not found');
    if (!currentTeamId) throw new Error('No current team');

    const activeTag = entry.tagEvents.find(
      (t) => t.targetTeamId === currentTeamId && !t.disputed && !t.voided
    );
    if (!activeTag) throw new Error('No active tag to dispute');

    activeTag.disputed = true;
    activeTag.voided = true;

    const target = entry.teams.find((t) => t.id === currentTeamId);
    addLog(entry, 'tag_disputed', {
      targetName: target?.name ?? '',
    });
  },

  getActiveTag: async (gameId: string, teamId: string) => {
    const entry = games[gameId];
    if (!entry) return null;
    return (
      entry.tagEvents.find(
        (t) => t.targetTeamId === teamId && !t.voided
      ) ?? null
    );
  },

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

  getLog: async (gameId: string, teamId?: string) => {
    const entry = games[gameId];
    if (!entry) return [];
    let log = entry.log;
    if (teamId) {
      log = log.filter((l) => {
        const data = l.data as Record<string, string>;
        return data.teamName === teamId || data.targetName === teamId;
      });
    }
    return [...log].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  },

  setCurrentTeam,
};
