import type { Server } from 'socket.io';
import { store } from '../data/store';

let io: Server | null = null;

interface RoomState {
  game: any;
}

const lastSnapshots: Record<string, RoomState> = {};
const lastLogSent: Record<string, string> = {};

export function setIO(instance: Server): void {
  io = instance;
}

function cloneState(state: any): any {
  return JSON.parse(JSON.stringify(state));
}

function room(gameId: string): { nsp: ReturnType<Server['of']>; state: any } | null {
  if (!io) return null;
  const game = store.getGame(gameId);
  if (!game) return null;
  return {
    nsp: io.of('/game'),
    state: {
      ...game,
      teams: store.getTeamsByGame(gameId),
      landmarks: store.getLandmarksByGame(gameId),
      landmarkStates: store.getLandmarkStates(gameId),
    },
  };
}

export function sendFullState(gameId: string): void {
  const r = room(gameId);
  if (!r) return;
  lastSnapshots[gameId] = { game: cloneState(r.state) };
  r.nsp.to(`game:${gameId}`).emit('state_update', { game: r.state });
}

export function seedSnapshot(gameId: string): void {
  const r = room(gameId);
  if (r) lastSnapshots[gameId] = { game: cloneState(r.state) };
}

function diffLandmarkStates(prev: any[] | undefined, curr: any[] | undefined): any[] {
  const prevMap = new Map((prev ?? []).map((s) => [s.landmarkId, s]));
  const changed: any[] = [];
  for (const s of curr ?? []) {
    const p = prevMap.get(s.landmarkId);
    if (!p || p.teamId !== s.teamId || p.locked !== s.locked || p.claimedAt !== s.claimedAt || p.claimPhotoId !== s.claimPhotoId) {
      changed.push(s);
    }
  }
  return changed;
}

export function broadcastState(gameId: string): void {
  const r = room(gameId);
  if (!r) return;
  const region = r.state;
  const prev = lastSnapshots[gameId]?.game;

  // Push newest log entry as a discrete realtime event (drives the Log screen).
  const newest = store.getLog(gameId)[0];
  if (newest && lastLogSent[gameId] !== newest.id) {
    lastLogSent[gameId] = newest.id;
    r.nsp.to(`game:${gameId}`).emit('log_entry', newest);
  }

  if (!prev) {
    sendFullState(gameId);
    return;
  }

  const diff: any = {};
  if (prev.status !== region.status) diff.status = region.status;
  if (prev.startedAt !== region.startedAt) diff.startedAt = region.startedAt;
  if (prev.pausedAt !== region.pausedAt) diff.pausedAt = region.pausedAt;
  if (prev.totalPausedMs !== region.totalPausedMs) diff.totalPausedMs = region.totalPausedMs;
  if (prev.config && JSON.stringify(prev.config) !== JSON.stringify(region.config)) diff.config = region.config;

  const changedStates = diffLandmarkStates(prev.landmarkStates, region.landmarkStates);
  if (changedStates.length) diff.landmarkStates = changedStates;

  if (prev.teams && region.teams) {
    const prevTeamIds = new Set(prev.teams.map((t: any) => t.id));
    const addedTeams = region.teams.filter((t: any) => !prevTeamIds.has(t.id));
    if (addedTeams.length) diff.addedTeams = addedTeams;
  }

  if (Object.keys(diff).length === 0) return;

  lastSnapshots[gameId] = { game: cloneState(region) };
  r.nsp.to(`game:${gameId}`).emit('state_update', { diff });
}

export function broadcastToGame(gameId: string, event: string, data: unknown): void {
  if (!io) return;
  const nsp = io.of('/game');
  nsp.to(`game:${gameId}`).emit(event, data);
}