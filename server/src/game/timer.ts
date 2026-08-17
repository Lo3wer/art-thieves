import { store } from '../data/store';
import { computeScoreboard, computeWinner, getActiveElapsedMs } from './logic';
import { broadcastState, broadcastToGame } from '../socket/broadcast';

const timers = new Map<string, NodeJS.Timeout>();

export function scheduleGameEnd(gameId: string): void {
  const game = store.getGame(gameId);
  if (!game || game.status !== 'active') return;
  const elapsed = getActiveElapsedMs(game.startedAt, game.totalPausedMs, game.pausedAt, game.status);
  const remainingMs = Math.max(0, game.config.duration * 1000 - elapsed);
  cancelGameEnd(gameId);
  const t = setTimeout(() => {
    timers.delete(gameId);
    endGame(gameId);
  }, remainingMs);
  timers.set(gameId, t);
}

export function cancelGameEnd(gameId: string): void {
  const t = timers.get(gameId);
  if (t) {
    clearTimeout(t);
    timers.delete(gameId);
  }
}

function endGame(gameId: string): void {
  const game = store.getGame(gameId);
  if (!game || game.status === 'ended' || game.status === 'paused') return;
  const teams = store.getTeamsByGame(gameId);
  const states = store.getLandmarkStates(gameId);
  const scores = computeScoreboard(teams, states);
  const result = computeWinner(scores);
  store.updateGame(gameId, { status: 'ended' });
  store.addLogEntry(gameId, 'game_ended', result);
  broadcastState(gameId);
  broadcastToGame(gameId, 'game_ended', { ...result, scores });
}

export function rescheduleAllActiveGames(): void {
  for (const game of store.getGames()) {
    if (game.status === 'active') scheduleGameEnd(game.id);
  }
}