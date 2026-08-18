import { v4 as uuid } from 'uuid';
import { eq, and, desc, asc, sql, gt } from 'drizzle-orm';
import { getDb } from './db';
import * as s from './schema';
import type {
  GameMap,
  Game,
  Team,
  Landmark,
  LandmarkState,
  ChallengeAttempt,
  ChallengeOutcome,
  LocationPing,
  TagEvent,
  PushToken,
  LogEntry,
  Photo,
  Penalty,
} from './types';
import { generateJoinCode } from './helpers';
import { mapsDirectory, seedMapsFromDirectory } from './kml';

export const store = {
  // Maps
  getMaps: (): GameMap[] => getDb().select().from(s.maps).all() as GameMap[],
  getMap: (id: string): GameMap | null =>
    (getDb().select().from(s.maps).where(eq(s.maps.id, id)).get() as GameMap | undefined) ?? null,
  addMap: (map: Omit<GameMap, 'id' | 'createdAt'>): GameMap => {
    const newMap: GameMap = { ...map, id: uuid(), createdAt: new Date().toISOString() };
    getDb().insert(s.maps).values(newMap).run();
    return newMap;
  },
  deleteMap: (name: string): void => {
    getDb().delete(s.maps).where(eq(s.maps.name, name)).run();
  },

  // Games
  getGames: (): Game[] => getDb().select().from(s.games).all() as Game[],
  getGame: (id: string): Game | null =>
    (getDb().select().from(s.games).where(eq(s.games.id, id)).get() as Game | undefined) ?? null,
  getGameByJoinCode: (code: string): Game | null =>
    (getDb().select().from(s.games).where(eq(s.games.joinCode, code)).get() as Game | undefined) ?? null,
  createGame: (mapId: string, config: Game['config']): Game => {
    let joinCode = generateJoinCode();
    while (store.getGameByJoinCode(joinCode)) {
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
    getDb().insert(s.games).values(game).run();
    return game;
  },
  updateGame: (id: string, updates: Partial<Game>): Game | null => {
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      set[k] = v === undefined ? null : v;
    }
    getDb().update(s.games).set(set).where(eq(s.games.id, id)).run();
    return store.getGame(id);
  },

  // Teams
  getTeamsByGame: (gameId: string): Team[] =>
    getDb().select().from(s.teams).where(eq(s.teams.gameId, gameId)).all() as Team[],
  getTeam: (teamId: string): Team | null =>
    (getDb().select().from(s.teams).where(eq(s.teams.id, teamId)).get() as Team | undefined) ?? null,
  isTeamNameTaken: (gameId: string, name: string): boolean =>
    getDb()
      .select({ id: s.teams.id })
      .from(s.teams)
      .where(and(
        eq(s.teams.gameId, gameId),
        sql`lower(${s.teams.name}) = lower(${name})`
      ))
      .get() != null,
  isTeamColorTaken: (gameId: string, color: string): boolean =>
    getDb()
      .select({ id: s.teams.id })
      .from(s.teams)
      .where(and(eq(s.teams.gameId, gameId), eq(s.teams.color, color)))
      .get() != null,
  addTeam: (gameId: string, name: string, color: string): Team => {
    if (store.isTeamNameTaken(gameId, name)) throw new Error('Team name already taken');
    if (store.isTeamColorTaken(gameId, color)) throw new Error('Team color already taken');
    const team: Team = { id: uuid(), gameId, name, color };
    getDb().insert(s.teams).values(team).run();
    return team;
  },

  // Landmarks
  getLandmarksByGame: (gameId: string): Landmark[] =>
    getDb().select().from(s.landmarks).where(eq(s.landmarks.gameId, gameId)).all() as Landmark[],
  addLandmarks: (gameId: string, list: Omit<Landmark, 'id' | 'gameId'>[]): Landmark[] => {
    const inserted = list.map((l) => ({ ...l, id: uuid(), gameId }));
    if (inserted.length) getDb().insert(s.landmarks).values(inserted).run();
    return inserted;
  },

  // Landmark state
  getLandmarkStates: (gameId: string): LandmarkState[] =>
    getDb().select().from(s.landmarkStates).where(eq(s.landmarkStates.gameId, gameId)).all() as LandmarkState[],
  clearLandmarkState: (gameId: string, landmarkId: string): boolean => {
    const result = getDb()
      .delete(s.landmarkStates)
      .where(and(eq(s.landmarkStates.gameId, gameId), eq(s.landmarkStates.landmarkId, landmarkId)))
      .run();
    return result.changes > 0;
  },
  upsertLandmarkState: (
    gameId: string,
    landmarkId: string,
    teamId: string,
    locked: boolean,
    claimPhotoId?: string
  ): LandmarkState => {
    const existing = getDb()
      .select()
      .from(s.landmarkStates)
      .where(and(eq(s.landmarkStates.gameId, gameId), eq(s.landmarkStates.landmarkId, landmarkId)))
      .get() as LandmarkState | undefined;
    if (existing) {
      const claimedAt = existing.claimedAt ?? new Date().toISOString();
      const set: Record<string, unknown> = { teamId, locked, claimedAt };
      if (claimPhotoId !== undefined) set.claimPhotoId = claimPhotoId;
      getDb().update(s.landmarkStates).set(set).where(eq(s.landmarkStates.id, existing.id)).run();
      return { ...existing, teamId, locked, claimedAt, ...(claimPhotoId !== undefined ? { claimPhotoId } : {}) };
    }
    const state: LandmarkState = {
      id: uuid(),
      gameId,
      landmarkId,
      teamId,
      locked,
      claimedAt: new Date().toISOString(),
      ...(claimPhotoId !== undefined ? { claimPhotoId } : {}),
    };
    getDb().insert(s.landmarkStates).values(state).run();
    return state;
  },

  // Challenge sessions
  getChallengeSession: (gameId: string, landmarkId: string, teamId: string): ChallengeAttempt | null =>
    (getDb()
      .select()
      .from(s.challengeAttempts)
      .where(and(
        eq(s.challengeAttempts.gameId, gameId),
        eq(s.challengeAttempts.landmarkId, landmarkId),
        eq(s.challengeAttempts.teamId, teamId)
      ))
      .get() as ChallengeAttempt | undefined) ?? null,
  getChallengeSessionsByGame: (gameId: string): ChallengeAttempt[] =>
    getDb().select().from(s.challengeAttempts).where(eq(s.challengeAttempts.gameId, gameId)).all() as ChallengeAttempt[],
  getChallengeSessionsForLandmark: (gameId: string, landmarkId: string): ChallengeAttempt[] =>
    getDb()
      .select()
      .from(s.challengeAttempts)
      .where(and(eq(s.challengeAttempts.gameId, gameId), eq(s.challengeAttempts.landmarkId, landmarkId)))
      .all() as ChallengeAttempt[],
  deleteChallengeSession: (gameId: string, landmarkId: string, teamId: string): boolean => {
    const result = getDb()
      .delete(s.challengeAttempts)
      .where(and(
        eq(s.challengeAttempts.gameId, gameId),
        eq(s.challengeAttempts.landmarkId, landmarkId),
        eq(s.challengeAttempts.teamId, teamId)
      ))
      .run();
    return result.changes > 0;
  },
  startChallengeSession: (
    gameId: string,
    landmarkId: string,
    teamId: string,
    delayMinutes?: number
  ): ChallengeAttempt => {
    const existing = store.getChallengeSession(gameId, landmarkId, teamId);
    if (existing) return existing;
    const startedAt = new Date().toISOString();
    const readyAt = delayMinutes
      ? new Date(Date.now() + delayMinutes * 60 * 1000).toISOString()
      : undefined;
    const attempt: ChallengeAttempt = {
      id: uuid(), gameId, landmarkId, teamId,
      status: delayMinutes ? 'pending' : 'ready',
      startedAt,
      ...(readyAt ? { readyAt } : {}),
    };
    getDb().insert(s.challengeAttempts).values(attempt).run();
    return attempt;
  },
  resolveChallengeSession: (
    gameId: string,
    landmarkId: string,
    teamId: string,
    outcome: ChallengeOutcome,
    penaltyUntil?: string
  ): ChallengeAttempt => {
    let session = store.getChallengeSession(gameId, landmarkId, teamId);
    if (!session) {
      session = store.startChallengeSession(gameId, landmarkId, teamId);
    }
    if (session.status === 'complete' || session.status === 'fail' || session.status === 'pass') {
      return session;
    }
    const completedAt = new Date().toISOString();
    getDb().update(s.challengeAttempts).set({
      status: outcome,
      outcome,
      completedAt,
      ...(penaltyUntil ? { penaltyUntil } : {}),
    }).where(eq(s.challengeAttempts.id, session.id)).run();
    return store.getChallengeSession(gameId, landmarkId, teamId) as ChallengeAttempt;
  },
  voidPendingChallenges: (gameId: string, landmarkId: string, exceptTeamId?: string): string[] => {
    const pending = store
      .getChallengeSessionsForLandmark(gameId, landmarkId)
      .filter((a) => a.status === 'pending' && a.teamId !== exceptTeamId);
    const voided: string[] = [];
    const completedAt = new Date().toISOString();
    for (const a of pending) {
      getDb().update(s.challengeAttempts).set({ status: 'voided', completedAt }).where(eq(s.challengeAttempts.id, a.id)).run();
      voided.push(a.teamId);
    }
    return voided;
  },

  // Penalties
  setPenalty: (gameId: string, teamId: string, type: Penalty['type'], until: string): Penalty => {
    const existing = getDb()
      .select()
      .from(s.penalties)
      .where(and(eq(s.penalties.gameId, gameId), eq(s.penalties.teamId, teamId), eq(s.penalties.type, type)))
      .get() as Penalty | undefined;
    if (existing) {
      getDb().update(s.penalties).set({ until }).where(eq(s.penalties.id, existing.id)).run();
      return { ...existing, until };
    }
    const penalty: Penalty = { id: uuid(), gameId, teamId, type, until };
    getDb().insert(s.penalties).values(penalty).run();
    return penalty;
  },
  getPenalty: (gameId: string, teamId: string, type: Penalty['type']): Penalty | null =>
    (getDb()
      .select()
      .from(s.penalties)
      .where(and(
        eq(s.penalties.gameId, gameId),
        eq(s.penalties.teamId, teamId),
        eq(s.penalties.type, type),
        gt(s.penalties.until, new Date().toISOString())
      ))
      .get() as Penalty | undefined) ?? null,
  getPenaltiesByGame: (gameId: string): Penalty[] =>
    getDb()
      .select()
      .from(s.penalties)
      .where(and(eq(s.penalties.gameId, gameId), gt(s.penalties.until, new Date().toISOString())))
      .all() as Penalty[],

  // Location pings
  addLocationPing: (gameId: string, teamId: string, latitude: number, longitude: number): LocationPing => {
    const ping: LocationPing = {
      id: uuid(), gameId, teamId, latitude, longitude,
      timestamp: new Date().toISOString(),
    };
    getDb().insert(s.locationPings).values(ping).run();
    return ping;
  },
  getLocationPings: (gameId: string): LocationPing[] =>
    getDb()
      .select()
      .from(s.locationPings)
      .where(eq(s.locationPings.gameId, gameId))
      .orderBy(asc(s.locationPings.timestamp))
      .all() as LocationPing[],

  // Tags
  getTagsByGame: (gameId: string): TagEvent[] =>
    getDb().select().from(s.tagEvents).where(eq(s.tagEvents.gameId, gameId)).all() as TagEvent[],
  addTagEvent: (gameId: string, taggerTeamId: string, targetTeamId: string): TagEvent => {
    const tag: TagEvent = {
      id: uuid(), gameId, taggerTeamId, targetTeamId,
      timestamp: new Date().toISOString(),
      disputed: false, voided: false,
    };
    getDb().insert(s.tagEvents).values(tag).run();
    return tag;
  },
  getActiveTag: (gameId: string, targetTeamId: string): TagEvent | null =>
    (getDb()
      .select()
      .from(s.tagEvents)
      .where(and(
        eq(s.tagEvents.gameId, gameId),
        eq(s.tagEvents.targetTeamId, targetTeamId),
        eq(s.tagEvents.voided, false)
      ))
      .orderBy(asc(s.tagEvents.timestamp))
      .get() as TagEvent | undefined) ?? null,
  updateTagEvent: (id: string, updates: Partial<TagEvent>): TagEvent | null => {
    getDb().update(s.tagEvents).set(updates).where(eq(s.tagEvents.id, id)).run();
    return (getDb().select().from(s.tagEvents).where(eq(s.tagEvents.id, id)).get() as TagEvent | undefined) ?? null;
  },

  // Push tokens
  getPushTokens: (gameId: string, teamId?: string): PushToken[] => {
    if (teamId) {
      return getDb()
        .select().from(s.pushTokens)
        .where(and(eq(s.pushTokens.gameId, gameId), eq(s.pushTokens.teamId, teamId)))
        .all() as PushToken[];
    }
    return getDb().select().from(s.pushTokens).where(eq(s.pushTokens.gameId, gameId)).all() as PushToken[];
  },
  addPushToken: (gameId: string, teamId: string, token: string): PushToken => {
    const existing = getDb()
      .select()
      .from(s.pushTokens)
      .where(and(
        eq(s.pushTokens.gameId, gameId),
        eq(s.pushTokens.teamId, teamId),
        eq(s.pushTokens.token, token)
      ))
      .get() as PushToken | undefined;
    if (existing) return existing;
    const pt: PushToken = { id: uuid(), gameId, teamId, token };
    getDb().insert(s.pushTokens).values(pt).run();
    return pt;
  },
  removePushToken: (id: string): void => {
    getDb().delete(s.pushTokens).where(eq(s.pushTokens.id, id)).run();
  },

  // Photos
  addPhoto: (photo: Omit<Photo, 'id' | 'createdAt'>): Photo => {
    const newPhoto: Photo = { ...photo, id: uuid(), createdAt: new Date().toISOString() };
    getDb().insert(s.photos).values(newPhoto).run();
    return newPhoto;
  },
  getPhoto: (id: string): Photo | null =>
    (getDb().select().from(s.photos).where(eq(s.photos.id, id)).get() as Photo | undefined) ?? null,
  getPhotosByGame: (gameId: string): Photo[] =>
    getDb().select().from(s.photos).where(eq(s.photos.gameId, gameId)).all() as Photo[],

  // Event log
  addLogEntry: (gameId: string, type: string, data: Record<string, unknown> = {}): LogEntry => {
    const entry: LogEntry = {
      id: uuid(), gameId, type, data,
      timestamp: new Date().toISOString(),
    };
    getDb().insert(s.eventLog).values(entry).run();
    return entry;
  },
  getLog: (gameId: string, teamId?: string): LogEntry[] => {
    let entries = getDb()
      .select()
      .from(s.eventLog)
      .where(eq(s.eventLog.gameId, gameId))
      .orderBy(desc(s.eventLog.timestamp), sql`rowid desc`)
      .all() as LogEntry[];
    if (teamId) {
      entries = entries.filter((e) => e.data?.teamId === teamId || e.data?.targetTeamId === teamId);
    }
    return entries;
  },
};

seedMapsFromDirectory(mapsDirectory(), store);
