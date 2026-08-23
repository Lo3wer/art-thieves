import { store } from '../data/store';
import { computeScoreboard, computeWinner, getActiveElapsedMs } from './logic';
import { broadcastState, broadcastToGame } from '../socket/broadcast';

const timers = new Map<string, NodeJS.Timeout>();

export async function scheduleGameEnd(gameId: string): Promise<void> {
  const game = await store.getGame(gameId);
  if (!game || game.status !== 'active') return;
  const elapsed = getActiveElapsedMs(game.startedAt, game.totalPausedMs, game.pausedAt, game.status);
  const remainingMs = Math.max(0, game.config.duration * 1000 - elapsed);
  cancelGameEnd(gameId);
  const t = setTimeout(() => {
    timers.delete(gameId);
    void endGame(gameId);
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

async function endGame(gameId: string): Promise<void> {
  const game = await store.getGame(gameId);
  if (!game || game.status === 'ended' || game.status === 'paused') return;
  const teams = await store.getTeamsByGame(gameId);
  const states = await store.getLandmarkStates(gameId);
  const scores = computeScoreboard(teams, states);
  const result = computeWinner(scores);
  await store.updateGame(gameId, { status: 'ended' });
  await store.addLogEntry(gameId, 'game_ended', result);
  await broadcastState(gameId);
  broadcastToGame(gameId, 'game_ended', { ...result, scores });
}

export async function rescheduleAllActiveGames(): Promise<void> {
  for (const game of await store.getGames()) {
    if (game.status === 'active') await scheduleGameEnd(game.id);
  }
}
