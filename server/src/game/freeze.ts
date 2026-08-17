import { store } from '../data/store';

export const FREEZE_DURATION_MS = 10 * 60 * 1000;

export function getFrozenUntil(from: string | number | Date = new Date()): string {
  const t = typeof from === 'number' ? from : new Date(from).getTime();
  return new Date(t + FREEZE_DURATION_MS).toISOString();
}

export function isTeamFrozen(gameId: string, teamId: string): boolean {
  const activeTag = store.getActiveTag(gameId, teamId);
  if (!activeTag) return false;
  const elapsed = Date.now() - new Date(activeTag.timestamp).getTime();
  return elapsed < FREEZE_DURATION_MS;
}

export function getFrozenTeams(gameId: string): { teamId: string; frozenUntil: string }[] {
  const teams = store.getTeamsByGame(gameId);
  const frozen: { teamId: string; frozenUntil: string }[] = [];
  for (const team of teams) {
    const tag = store.getActiveTag(gameId, team.id);
    if (!tag) continue;
    const elapsed = Date.now() - new Date(tag.timestamp).getTime();
    if (elapsed < FREEZE_DURATION_MS) {
      frozen.push({ teamId: team.id, frozenUntil: getFrozenUntil(tag.timestamp) });
    }
  }
  return frozen;
}