import type { Landmark, LandmarkState } from '../types';

export function getLandmarkStatus(
  landmarkId: string,
  states: LandmarkState[]
): LandmarkState {
  return (
    states.find((s) => s.landmarkId === landmarkId) ?? {
      landmarkId,
      status: 'unclaimed',
    }
  );
}

export function getMarkerColor(
  status: LandmarkState,
  teamColors: Record<string, string>
): string {
  if (status.status === 'locked') return '#888';
  if (status.status === 'claimed' && status.teamId && teamColors[status.teamId]) {
    return teamColors[status.teamId];
  }
  return '#999';
}
