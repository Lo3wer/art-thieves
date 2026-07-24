import { v4 as uuid } from 'uuid';

export interface GameMap {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  defaultZoom: number;
  defaultVicinityRadius: number;
  winThreshold: number;
  data: unknown;
  createdAt: string;
}

export interface Team {
  id: string;
  gameId: string;
  name: string;
  color: string;
}

export interface Landmark {
  id: string;
  gameId: string;
  name: string;
  latitude: number;
  longitude: number;
  imageUrl?: string;
  challengeText?: string;
  mapLandmarkIndex: number;
}

export interface LandmarkState {
  id: string;
  gameId: string;
  landmarkId: string;
  teamId?: string;
  locked: boolean;
  claimedAt?: string;
}

export interface ChallengeAttempt {
  id: string;
  gameId: string;
  landmarkId: string;
  teamId: string;
  outcome: 'complete' | 'fail' | 'veto';
  createdAt: string;
}

export interface LocationPing {
  id: string;
  gameId: string;
  teamId: string;
  latitude: number;
  longitude: number;
  timestamp: string;
}

export interface TagEvent {
  id: string;
  gameId: string;
  taggerTeamId: string;
  targetTeamId: string;
  timestamp: string;
  disputed: boolean;
  voided: boolean;
}

export interface PushToken {
  id: string;
  gameId: string;
  teamId: string;
  token: string;
}

export interface LogEntry {
  id: string;
  gameId: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface Game {
  id: string;
  joinCode: string;
  mapId: string;
  status: 'lobby' | 'active' | 'paused' | 'ended';
  config: {
    duration: number;
    vicinityRadius: number;
    winThreshold: number;
    reTagCooldown: number;
    disputeWindow: number;
  };
  startedAt?: string;
  pausedAt?: string;
  totalPausedMs: number;
  createdAt: string;
}

const maps: GameMap[] = [];
const games: Game[] = [];
const teams: Team[] = [];
const landmarks: Landmark[] = [];
const landmarkStates: LandmarkState[] = [];
const challengeAttempts: ChallengeAttempt[] = [];
const locationPings: LocationPing[] = [];
const tagEvents: TagEvent[] = [];
const pushTokens: PushToken[] = [];
const eventLog: LogEntry[] = [];

function generateJoinCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function seedDefaultMap(): void {
  if (maps.length > 0) return;
  const landmarks_data = Array.from({ length: 40 }, (_, i) => ({
    type: 'Feature' as const,
    properties: {
      type: 'landmark',
      name: `Landmark ${i + 1}`,
      challengeText: i < 20 ? `Find the hidden detail on Landmark ${i + 1}` : undefined,
    },
    geometry: {
      type: 'Point' as const,
      coordinates: [
        -123.1207 + (i % 8) * 0.012 - 0.048,
        49.2827 + Math.floor(i / 8) * 0.012 - 0.024,
      ] as [number, number],
    },
  }));
  maps.push({
    id: 'default-vancouver',
    name: 'Vancouver Downtown',
    centerLat: 49.2827,
    centerLng: -123.1207,
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
        ...landmarks_data,
      ],
    },
    createdAt: new Date().toISOString(),
  });
}

seedDefaultMap();

export const store = {
  // Maps
  getMaps: () => [...maps],
  getMap: (id: string) => maps.find((m) => m.id === id) ?? null,
  addMap: (map: Omit<GameMap, 'id' | 'createdAt'>) => {
    const newMap: GameMap = { ...map, id: uuid(), createdAt: new Date().toISOString() };
    maps.push(newMap);
    return newMap;
  },

  // Games
  getGame: (id: string) => games.find((g) => g.id === id) ?? null,
  getGameByJoinCode: (code: string) => games.find((g) => g.joinCode === code) ?? null,
  createGame: (mapId: string, config: Game['config']) => {
    const game: Game = {
      id: uuid(),
      joinCode: generateJoinCode(),
      mapId,
      status: 'lobby',
      config,
      totalPausedMs: 0,
      createdAt: new Date().toISOString(),
    };
    games.push(game);
    return game;
  },
  updateGame: (id: string, updates: Partial<Game>) => {
    const idx = games.findIndex((g) => g.id === id);
    if (idx === -1) return null;
    games[idx] = { ...games[idx], ...updates };
    return games[idx];
  },

  // Teams
  getTeamsByGame: (gameId: string) => teams.filter((t) => t.gameId === gameId),
  addTeam: (gameId: string, name: string, color: string) => {
    const team: Team = { id: uuid(), gameId, name, color };
    teams.push(team);
    return team;
  },

  // Landmarks
  getLandmarksByGame: (gameId: string) => landmarks.filter((l) => l.gameId === gameId),
  addLandmarks: (gameId: string, list: Omit<Landmark, 'id' | 'gameId'>[]) => {
    const inserted = list.map((l) => ({ ...l, id: uuid(), gameId }));
    landmarks.push(...inserted);
    return inserted;
  },

  // Landmark state
  getLandmarkStates: (gameId: string) => landmarkStates.filter((s) => s.gameId === gameId),
  upsertLandmarkState: (gameId: string, landmarkId: string, teamId: string, locked: boolean) => {
    const existing = landmarkStates.find(
      (s) => s.gameId === gameId && s.landmarkId === landmarkId
    );
    if (existing) {
      existing.teamId = teamId;
      existing.locked = locked;
      if (!existing.claimedAt) existing.claimedAt = new Date().toISOString();
      return existing;
    }
    const state: LandmarkState = {
      id: uuid(), gameId, landmarkId, teamId, locked,
      claimedAt: new Date().toISOString(),
    };
    landmarkStates.push(state);
    return state;
  },

  // Challenge attempts
  getChallengeAttempt: (gameId: string, landmarkId: string, teamId: string) =>
    challengeAttempts.find(
      (a) => a.gameId === gameId && a.landmarkId === landmarkId && a.teamId === teamId
    ) ?? null,
  addChallengeAttempt: (gameId: string, landmarkId: string, teamId: string, outcome: ChallengeAttempt['outcome']) => {
    const attempt: ChallengeAttempt = {
      id: uuid(), gameId, landmarkId, teamId, outcome,
      createdAt: new Date().toISOString(),
    };
    challengeAttempts.push(attempt);
    return attempt;
  },

  // Location pings
  addLocationPing: (gameId: string, teamId: string, latitude: number, longitude: number) => {
    const ping: LocationPing = {
      id: uuid(), gameId, teamId, latitude, longitude,
      timestamp: new Date().toISOString(),
    };
    locationPings.push(ping);
    return ping;
  },

  // Tags
  addTagEvent: (gameId: string, taggerTeamId: string, targetTeamId: string) => {
    const tag: TagEvent = {
      id: uuid(), gameId, taggerTeamId, targetTeamId,
      timestamp: new Date().toISOString(),
      disputed: false, voided: false,
    };
    tagEvents.push(tag);
    return tag;
  },
  getActiveTag: (gameId: string, targetTeamId: string) =>
    tagEvents.find(
      (t) => t.gameId === gameId && t.targetTeamId === targetTeamId && !t.voided
    ) ?? null,
  updateTagEvent: (id: string, updates: Partial<TagEvent>) => {
    const idx = tagEvents.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    tagEvents[idx] = { ...tagEvents[idx], ...updates };
    return tagEvents[idx];
  },

  // Push tokens
  getPushTokens: (gameId: string, teamId?: string) => {
    if (teamId) return pushTokens.filter((t) => t.gameId === gameId && t.teamId === teamId);
    return pushTokens.filter((t) => t.gameId === gameId);
  },
  addPushToken: (gameId: string, teamId: string, token: string) => {
    const existing = pushTokens.find(
      (t) => t.gameId === gameId && t.teamId === teamId && t.token === token
    );
    if (existing) return existing;
    const pt: PushToken = { id: uuid(), gameId, teamId, token };
    pushTokens.push(pt);
    return pt;
  },
  removePushToken: (id: string) => {
    const idx = pushTokens.findIndex((t) => t.id === id);
    if (idx !== -1) pushTokens.splice(idx, 1);
  },

  // Event log
  addLogEntry: (gameId: string, type: string, data: Record<string, unknown> = {}) => {
    const entry: LogEntry = {
      id: uuid(), gameId, type, data,
      timestamp: new Date().toISOString(),
    };
    eventLog.push(entry);
    return entry;
  },
  getLog: (gameId: string, teamId?: string) => {
    let entries = eventLog.filter((e) => e.gameId === gameId);
    if (teamId) {
      entries = entries.filter((e) => e.data?.teamId === teamId || e.data?.targetTeamId === teamId);
    }
    return [...entries].reverse();
  },
};
