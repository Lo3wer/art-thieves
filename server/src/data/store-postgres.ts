import { v4 as uuid } from 'uuid';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { getPostgresDb, postgresReady } from './db-postgres';
import * as s from './schema-postgres';
import type { GameMap, Game, Team, Landmark, LandmarkState, ChallengeAttempt, ChallengeOutcome, LocationPing, TagEvent, PushToken, LogEntry, Photo, Penalty } from './types';
import { generateJoinCode } from './helpers';
import { mapsDirectory } from './kml';
import fs from 'fs';
import path from 'path';
import { buildMapFromFile } from './kml';

// pg is asynchronous; this is the same store operation set as the synchronous backends.
const db = getPostgresDb();
const ready = postgresReady();
const wait = async () => { await ready; };
const one = async <T>(promise: PromiseLike<unknown[]>): Promise<T | null> => (await promise)[0] as T ?? null;

export const store = {
  getMaps: async () => { await wait(); return (await db.select().from(s.maps)) as GameMap[]; },
  getMap: async (id: string) => { await wait(); return one<GameMap>(db.select().from(s.maps).where(eq(s.maps.id, id))); },
  addMap: async (map: Omit<GameMap, 'id' | 'createdAt'>) => { await wait(); const v = { ...map, id: uuid(), createdAt: new Date().toISOString() }; await db.insert(s.maps).values(v); return v; },
  deleteMap: async (name: string) => { await wait(); await db.delete(s.maps).where(eq(s.maps.name, name)); },

  getGames: async () => { await wait(); return (await db.select().from(s.games)) as Game[]; },
  deleteGame: async (id: string) => { await wait(); const result = await db.delete(s.games).where(eq(s.games.id, id)); return (result.rowCount ?? 0) > 0; },
  clearGames: async () => { await wait(); for (const table of [s.teams, s.landmarks, s.landmarkStates, s.challengeAttempts, s.penalties, s.locationPings, s.tagEvents, s.pushTokens, s.eventLog, s.photos]) await db.delete(table); await db.delete(s.games); },
  getGame: async (id: string) => { await wait(); return one<Game>(db.select().from(s.games).where(eq(s.games.id, id))); },
  getGameByJoinCode: async (code: string) => { await wait(); return one<Game>(db.select().from(s.games).where(eq(s.games.joinCode, code))); },
  createGame: async (mapId: string, config: Game['config']) => { await wait(); let joinCode = generateJoinCode(); while (await store.getGameByJoinCode(joinCode)) joinCode = generateJoinCode(); const game: Game = { id: uuid(), joinCode, mapId, status: 'lobby', config, totalPausedMs: 0, createdAt: new Date().toISOString() }; await db.insert(s.games).values(game); return game; },
  updateGame: async (id: string, updates: Partial<Game>) => { await wait(); await db.update(s.games).set(updates as never).where(eq(s.games.id, id)); return await store.getGame(id); },

  getTeamsByGame: async (gameId: string) => { await wait(); return (await db.select().from(s.teams).where(eq(s.teams.gameId, gameId))) as Team[]; },
  getTeam: async (id: string) => { await wait(); return one<Team>(db.select().from(s.teams).where(eq(s.teams.id, id))); },
  isTeamNameTaken: async (gameId: string, name: string) => { await wait(); return (await db.select({ id: s.teams.id }).from(s.teams).where(and(eq(s.teams.gameId, gameId), sql`lower(${s.teams.name}) = lower(${name})`))).length > 0; },
  isTeamColorTaken: async (gameId: string, color: string) => { await wait(); return (await db.select({ id: s.teams.id }).from(s.teams).where(and(eq(s.teams.gameId, gameId), eq(s.teams.color, color)))).length > 0; },
  addTeam: async (gameId: string, name: string, color: string) => { await wait(); if (await store.isTeamNameTaken(gameId, name)) throw new Error('Team name already taken'); if (await store.isTeamColorTaken(gameId, color)) throw new Error('Team color already taken'); const team = { id: uuid(), gameId, name, color }; await db.insert(s.teams).values(team); return team; },

  getLandmarksByGame: async (gameId: string) => { await wait(); return (await db.select().from(s.landmarks).where(eq(s.landmarks.gameId, gameId))) as Landmark[]; },
  addLandmarks: async (gameId: string, list: Omit<Landmark, 'id' | 'gameId'>[]) => { await wait(); const values = list.map((l) => ({ ...l, id: uuid(), gameId })); if (values.length) await db.insert(s.landmarks).values(values); return values; },
  getLandmarkStates: async (gameId: string) => { await wait(); return (await db.select().from(s.landmarkStates).where(eq(s.landmarkStates.gameId, gameId))) as LandmarkState[]; },
  clearLandmarkState: async (gameId: string, landmarkId: string) => { await wait(); const r = await db.delete(s.landmarkStates).where(and(eq(s.landmarkStates.gameId, gameId), eq(s.landmarkStates.landmarkId, landmarkId))); return (r.rowCount ?? 0) > 0; },
  upsertLandmarkState: async (gameId: string, landmarkId: string, teamId: string, locked: boolean, claimPhotoId?: string) => { await wait(); const existing = await one<LandmarkState>(db.select().from(s.landmarkStates).where(and(eq(s.landmarkStates.gameId, gameId), eq(s.landmarkStates.landmarkId, landmarkId)))); if (existing) { const claimedAt = existing.claimedAt ?? new Date().toISOString(); await db.update(s.landmarkStates).set({ teamId, locked, claimedAt, ...(claimPhotoId !== undefined ? { claimPhotoId } : {}) }).where(eq(s.landmarkStates.id, existing.id)); return { ...existing, teamId, locked, claimedAt, ...(claimPhotoId !== undefined ? { claimPhotoId } : {}) }; } const state = { id: uuid(), gameId, landmarkId, teamId, locked, claimedAt: new Date().toISOString(), ...(claimPhotoId !== undefined ? { claimPhotoId } : {}) }; await db.insert(s.landmarkStates).values(state); return state; },

  getChallengeSession: async (gameId: string, landmarkId: string, teamId: string) => { await wait(); return one<ChallengeAttempt>(db.select().from(s.challengeAttempts).where(and(eq(s.challengeAttempts.gameId, gameId), eq(s.challengeAttempts.landmarkId, landmarkId), eq(s.challengeAttempts.teamId, teamId)))); },
  getChallengeSessionsByGame: async (gameId: string) => { await wait(); return (await db.select().from(s.challengeAttempts).where(eq(s.challengeAttempts.gameId, gameId))) as ChallengeAttempt[]; },
  getChallengeSessionsForLandmark: async (gameId: string, landmarkId: string) => { await wait(); return (await db.select().from(s.challengeAttempts).where(and(eq(s.challengeAttempts.gameId, gameId), eq(s.challengeAttempts.landmarkId, landmarkId)))) as ChallengeAttempt[]; },
  deleteChallengeSession: async (gameId: string, landmarkId: string, teamId: string) => { await wait(); const r = await db.delete(s.challengeAttempts).where(and(eq(s.challengeAttempts.gameId, gameId), eq(s.challengeAttempts.landmarkId, landmarkId), eq(s.challengeAttempts.teamId, teamId))); return (r.rowCount ?? 0) > 0; },
  startChallengeSession: async (gameId: string, landmarkId: string, teamId: string, delayMinutes?: number) => { await wait(); const existing = await store.getChallengeSession(gameId, landmarkId, teamId); if (existing) return existing; const attempt = { id: uuid(), gameId, landmarkId, teamId, status: delayMinutes ? 'pending' as const : 'ready' as const, startedAt: new Date().toISOString(), ...(delayMinutes ? { readyAt: new Date(Date.now() + delayMinutes * 60000).toISOString() } : {}) }; await db.insert(s.challengeAttempts).values(attempt); return attempt; },
  resolveChallengeSession: async (gameId: string, landmarkId: string, teamId: string, outcome: ChallengeOutcome, penaltyUntil?: string) => { let session = await store.getChallengeSession(gameId, landmarkId, teamId); if (!session) session = await store.startChallengeSession(gameId, landmarkId, teamId); if (session.status === 'complete' || session.status === 'fail' || session.status === 'pass') return session; await db.update(s.challengeAttempts).set({ status: outcome, outcome, completedAt: new Date().toISOString(), ...(penaltyUntil ? { penaltyUntil } : {}) }).where(eq(s.challengeAttempts.id, session.id)); return await store.getChallengeSession(gameId, landmarkId, teamId); },
  voidPendingChallenges: async (gameId: string, landmarkId: string, exceptTeamId?: string) => { await wait(); const pending = (await store.getChallengeSessionsForLandmark(gameId, landmarkId)).filter((a) => a.status === 'pending' && a.teamId !== exceptTeamId); for (const a of pending) await db.update(s.challengeAttempts).set({ status: 'voided', completedAt: new Date().toISOString() }).where(eq(s.challengeAttempts.id, a.id)); return pending.map((a) => a.teamId); },

  setPenalty: async (gameId: string, teamId: string, type: Penalty['type'], until: string) => { await wait(); const existing = await one<Penalty>(db.select().from(s.penalties).where(and(eq(s.penalties.gameId, gameId), eq(s.penalties.teamId, teamId), eq(s.penalties.type, type)))); if (existing) { await db.update(s.penalties).set({ until }).where(eq(s.penalties.id, existing.id)); return { ...existing, until }; } const p = { id: uuid(), gameId, teamId, type, until }; await db.insert(s.penalties).values(p); return p; },
  getPenalty: async (gameId: string, teamId: string, type: Penalty['type']) => { await wait(); return one<Penalty>(db.select().from(s.penalties).where(and(eq(s.penalties.gameId, gameId), eq(s.penalties.teamId, teamId), eq(s.penalties.type, type), gt(s.penalties.until, new Date().toISOString())))); },
  getPenaltiesByGame: async (gameId: string) => { await wait(); return (await db.select().from(s.penalties).where(and(eq(s.penalties.gameId, gameId), gt(s.penalties.until, new Date().toISOString())))) as Penalty[]; },
  addLocationPing: async (gameId: string, teamId: string, latitude: number, longitude: number) => { await wait(); const p = { id: uuid(), gameId, teamId, latitude, longitude, timestamp: new Date().toISOString() }; await db.insert(s.locationPings).values(p); return p; },
  getLocationPings: async (gameId: string) => { await wait(); return (await db.select().from(s.locationPings).where(eq(s.locationPings.gameId, gameId)).orderBy(asc(s.locationPings.timestamp))) as LocationPing[]; },
  getTagsByGame: async (gameId: string) => { await wait(); return (await db.select().from(s.tagEvents).where(eq(s.tagEvents.gameId, gameId))) as TagEvent[]; },
  addTagEvent: async (gameId: string, taggerTeamId: string, targetTeamId: string) => { await wait(); const t = { id: uuid(), gameId, taggerTeamId, targetTeamId, timestamp: new Date().toISOString(), disputed: false, voided: false }; await db.insert(s.tagEvents).values(t); return t; },
  getActiveTag: async (gameId: string, targetTeamId: string) => { await wait(); return one<TagEvent>(db.select().from(s.tagEvents).where(and(eq(s.tagEvents.gameId, gameId), eq(s.tagEvents.targetTeamId, targetTeamId), eq(s.tagEvents.voided, false))).orderBy(asc(s.tagEvents.timestamp))); },
  updateTagEvent: async (id: string, updates: Partial<TagEvent>) => { await wait(); await db.update(s.tagEvents).set(updates as never).where(eq(s.tagEvents.id, id)); return one<TagEvent>(db.select().from(s.tagEvents).where(eq(s.tagEvents.id, id))); },
  getPushTokens: async (gameId: string, teamId?: string) => { await wait(); return (await db.select().from(s.pushTokens).where(teamId ? and(eq(s.pushTokens.gameId, gameId), eq(s.pushTokens.teamId, teamId)) : eq(s.pushTokens.gameId, gameId))) as PushToken[]; },
  addPushToken: async (gameId: string, teamId: string, token: string) => { await wait(); const existing = await one<PushToken>(db.select().from(s.pushTokens).where(and(eq(s.pushTokens.gameId, gameId), eq(s.pushTokens.teamId, teamId), eq(s.pushTokens.token, token)))); if (existing) return existing; const p = { id: uuid(), gameId, teamId, token }; await db.insert(s.pushTokens).values(p); return p; },
  removePushToken: async (id: string) => { await wait(); await db.delete(s.pushTokens).where(eq(s.pushTokens.id, id)); },
  addPhoto: async (photo: Omit<Photo, 'id' | 'createdAt'>) => { await wait(); const p = { ...photo, id: uuid(), createdAt: new Date().toISOString() }; await db.insert(s.photos).values(p); return p; },
  getPhoto: async (id: string) => { await wait(); return one<Photo>(db.select().from(s.photos).where(eq(s.photos.id, id))); },
  getPhotosByGame: async (gameId: string) => { await wait(); return (await db.select().from(s.photos).where(eq(s.photos.gameId, gameId))) as Photo[]; },
  addLogEntry: async (gameId: string, type: string, data: Record<string, unknown> = {}) => { await wait(); const e = { id: uuid(), gameId, type, data, timestamp: new Date().toISOString() }; await db.insert(s.eventLog).values(e); return e; },
  getLog: async (gameId: string, teamId?: string) => { await wait(); let entries = await db.select().from(s.eventLog).where(eq(s.eventLog.gameId, gameId)).orderBy(desc(s.eventLog.timestamp)) as LogEntry[]; if (teamId) entries = entries.filter((e) => e.data?.teamId === teamId || e.data?.targetTeamId === teamId); return entries; },
};

export async function seedPostgresMaps(): Promise<void> {
  const dir = mapsDirectory();
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const available = new Set<string>();
  for (const entry of entries) {
    if (!['.kml', '.kmz'].includes(path.extname(entry).toLowerCase())) continue;
    try {
      const map = buildMapFromFile(fs.readFileSync(path.join(dir, entry)), entry);
      available.add(map.name);
      if (!(await store.getMaps()).some((m) => m.name === map.name)) await store.addMap(map);
    } catch (err) { console.warn(`[maps] Skipping ${entry}: ${(err as Error).message}`); }
  }
  for (const existing of await store.getMaps()) if (!available.has(existing.name)) await store.deleteMap(existing.name);
}
