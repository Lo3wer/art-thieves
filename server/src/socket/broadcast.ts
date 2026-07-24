import type { Server } from 'socket.io';
import { store } from '../data/store';

let io: Server | null = null;

export function setIO(instance: Server): void {
  io = instance;
}

export function broadcastState(gameId: string): void {
  if (!io) return;
  const game = store.getGame(gameId);
  if (!game) return;
  const nsp = io.of('/game');
  const state = {
    ...game,
    teams: store.getTeamsByGame(gameId),
    landmarks: store.getLandmarksByGame(gameId),
    landmarkStates: store.getLandmarkStates(gameId),
  };
  nsp.to(`game:${gameId}`).emit('state_update', { game: state });
}

export function broadcastToGame(gameId: string, event: string, data: unknown): void {
  if (!io) return;
  const nsp = io.of('/game');
  nsp.to(`game:${gameId}`).emit(event, data);
}
