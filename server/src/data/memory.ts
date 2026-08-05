import { v4 as uuid } from 'uuid';
import type {
  GameMap,
  Game,
  Team,
  Landmark,
  LandmarkState,
  ChallengeAttempt,
  LocationPing,
  TagEvent,
  PushToken,
  LogEntry,
  Photo,
} from './types';
import { generateJoinCode, createDefaultMap } from './helpers';

const maps: GameMap[] = [];
const games: Game[] = [];
const teams: Team[] = [];
const landmarks: Landmark[] = [];
const landmarkStates: LandmarkState[] = [];
const challengeAttempts: ChallengeAttempt[] = [];
const locationPings: LocationPing[] = [];
const tagEvents: TagEvent[] = [];
const pushTokens: PushToken[] = [];
const photos: Photo[] = [];
const eventLog: LogEntry[] = [];

function seedDefaultMap(): void {
  if (maps.length > 0) return;
  maps.push(createDefaultMap());
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
    let joinCode = generateJoinCode();
    while (games.some((g) => g.joinCode === joinCode)) {
      joinCode = generateJoinCode();
    }
    const game: Game = {
      id: uuid(),
      joinCode,
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
  getTeam: (teamId: string) => teams.find((t) => t.id === teamId) ?? null,
  isTeamNameTaken: (gameId: string, name: string) =>
    teams.some((t) => t.gameId === gameId && t.name.toLowerCase() === name.toLowerCase()),
  isTeamColorTaken: (gameId: string, color: string) =>
    teams.some((t) => t.gameId === gameId && t.color === color),
  addTeam: (gameId: string, name: string, color: string) => {
    if (store.isTeamNameTaken(gameId, name)) throw new Error('Team name already taken');
    if (store.isTeamColorTaken(gameId, color)) throw new Error('Team color already taken');
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
  upsertLandmarkState: (
    gameId: string,
    landmarkId: string,
    teamId: string,
    locked: boolean,
    claimPhotoId?: string
  ): LandmarkState => {
    const existing = landmarkStates.find(
      (s) => s.gameId === gameId && s.landmarkId === landmarkId
    );
    if (existing) {
      existing.teamId = teamId;
      existing.locked = locked;
      if (!existing.claimedAt) existing.claimedAt = new Date().toISOString();
      if (claimPhotoId !== undefined) existing.claimPhotoId = claimPhotoId;
      return existing;
    }
    const state: LandmarkState = {
      id: uuid(), gameId, landmarkId, teamId, locked,
      claimedAt: new Date().toISOString(),
      ...(claimPhotoId !== undefined ? { claimPhotoId } : {}),
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
  getLocationPings: (gameId: string) =>
    locationPings
      .filter((p) => p.gameId === gameId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),

  // Tags
  getTagsByGame: (gameId: string) => tagEvents.filter((t) => t.gameId === gameId),
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

  // Photos
  addPhoto: (photo: Omit<Photo, 'id' | 'createdAt'>): Photo => {
    const newPhoto: Photo = { ...photo, id: uuid(), createdAt: new Date().toISOString() };
    photos.push(newPhoto);
    return newPhoto;
  },
  getPhoto: (id: string) => photos.find((p) => p.id === id) ?? null,
  getPhotosByGame: (gameId: string) => photos.filter((p) => p.gameId === gameId),

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
