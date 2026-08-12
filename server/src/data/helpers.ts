import type { GameMap } from './types';

export function generateJoinCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function createDefaultMap(): GameMap {
  const landmarks_data = Array.from({ length: 40 }, (_, i) => ({
    type: 'Feature' as const,
    properties: {
      type: 'landmark',
      name: `Landmark ${i + 1}`,
      challengeText: i < 20 ? `Find the hidden detail on Landmark ${i + 1}` : undefined,
      ...(i === 0
        ? {
            challenge: {
              text: 'You may instantly lock this landmark, but you lose access to your tracker for 30 minutes. Alternatively, you may veto to avoid the tracker penalty, but you will not lock this landmark.',
              mode: 'instant',
              instant: {
                completeLabel: 'Lock now (lose tracker 30 min)',
                completeNote: 'You will lose access to your tracker for 30 minutes.',
                vetoLabel: 'Veto (don\u2019t lock)',
                vetoNote: 'No tracker penalty, but this landmark is not locked.',
                penalty: {
                  type: 'tracker',
                  minutes: 30,
                  note: 'Your team has lost access to its tracker for 30 minutes.',
                },
              },
            },
          }
        : {}),
      ...(i === 1
        ? {
            challenge: {
              text: 'Return to this landmark at least 1 hour from now to lock it. You may leave and return freely, but this challenge fails if another team locks it before you.',
              mode: 'delayed',
              delayed: {
                delayMinutes: 60,
                returnToLandmark: true,
                failsIfLockedByOtherTeam: true,
              },
            },
          }
        : {}),
    },
    geometry: {
      type: 'Point' as const,
      coordinates: [
        -123.1207 + (i % 8) * 0.012 - 0.048,
        49.2827 + Math.floor(i / 8) * 0.012 - 0.024,
      ] as [number, number],
    },
  }));
  return {
    id: 'default-vancouver',
    name: 'Vancouver Downtown',
    centerLat: 49.2827,
    centerLng: -123.1207,
    defaultZoom: 14,
    defaultVicinityRadius: 30,
    winThreshold: 20,
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { type: 'boundary', name: 'Vancouver Boundary' },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-123.224, 49.319],
              [-123.005, 49.319],
              [-123.005, 49.215],
              [-123.224, 49.215],
              [-123.224, 49.319],
            ]],
          },
        },
        ...landmarks_data,
      ],
    },
    createdAt: new Date().toISOString(),
  };
}
