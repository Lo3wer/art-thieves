export function getActiveElapsedMs(
  startedAt?: string,
  totalPausedMs: number = 0,
  pausedAt?: string,
  status?: string,
  now: number = Date.now()
): number {
  if (!startedAt) return 0;
  const started = new Date(startedAt).getTime();
  let pausedMs = totalPausedMs || 0;
  if (status === 'paused' && pausedAt) {
    pausedMs += now - new Date(pausedAt).getTime();
  }
  return Math.max(0, now - started - pausedMs);
}