import { store } from '../data/store';

export const FREEZE_DURATION_MS = 10 * 60 * 1000;

export function getFrozenUntil(from: string | number | Date = new Date()): string {
  const t = typeof from === 'number' ? from : new Date(from).getTime();
  return new Date(t + FREEZE_DURATION_MS).toISOString();
}

export async function isTeamFrozen(gameId: string, teamId: string): Promise<boolean> {
  const activeTag = await store.getActiveTag(gameId, teamId);
  if (!activeTag) return false;
  const elapsed = Date.now() - new Date(activeTag.timestamp).getTime();
  return elapsed < FREEZE_DURATION_MS;
}

export async function getFrozenTeams(gameId: string): Promise<{ teamId: string; frozenUntil: string }[]> {
  const teams = await store.getTeamsByGame(gameId);
  const frozen: { teamId: string; frozenUntil: string }[] = [];
  for (const team of teams) {
    const tag = await store.getActiveTag(gameId, team.id);
    if (!tag) continue;
    const elapsed = Date.now() - new Date(tag.timestamp).getTime();
    if (elapsed < FREEZE_DURATION_MS) {
      frozen.push({ teamId: team.id, frozenUntil: getFrozenUntil(tag.timestamp) });
    }
  }
  return frozen;
}
