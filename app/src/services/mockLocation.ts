import { haversineDistance } from '../utils/distance';

export interface MockRoutePoint {
  latitude: number;
  longitude: number;
}

const STEP_MS = 1000;
const DEFAULT_SPEED_MPS = 12;

let intervalId: ReturnType<typeof setInterval> | null = null;
let route: MockRoutePoint[] = [];
let routeIndex = 0;
let current: MockRoutePoint | null = null;
let speedMps = DEFAULT_SPEED_MPS;
let onUpdate: ((lat: number, lng: number) => void) | null = null;

export function isMockLocationEnabled(): boolean {
  return process.env.EXPO_PUBLIC_USE_MOCK_LOCATION === 'true';
}

function moveAlong(lat: number, lng: number, bearingRad: number, distMeters: number): MockRoutePoint {
  const R = 6371000;
  const phi1 = (lat * Math.PI) / 180;
  const lambda1 = (lng * Math.PI) / 180;
  const delta = distMeters / R;

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) +
      Math.cos(phi1) * Math.sin(delta) * Math.cos(bearingRad)
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
    );

  return {
    latitude: (phi2 * 180) / Math.PI,
    longitude: (lambda2 * 180) / Math.PI,
  };
}

function bearingRad(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const phi1 = (fromLat * Math.PI) / 180;
  const phi2 = (toLat * Math.PI) / 180;
  const deltaLambda = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return Math.atan2(y, x);
}

function step() {
  if (!current || route.length === 0 || !onUpdate) return;

  const target = route[routeIndex % route.length];
  const distToTarget = haversineDistance(
    current.latitude,
    current.longitude,
    target.latitude,
    target.longitude
  );
  const stepDist = speedMps * (STEP_MS / 1000);

  if (distToTarget <= stepDist) {
    routeIndex = (routeIndex + 1) % route.length;
    current = { ...target };
  } else {
    const bearing = bearingRad(
      current.latitude,
      current.longitude,
      target.latitude,
      target.longitude
    );
    current = moveAlong(current.latitude, current.longitude, bearing, stepDist);
  }

  onUpdate(current.latitude, current.longitude);
}

export function startMockLocation(
  points: MockRoutePoint[],
  callback: (lat: number, lng: number) => void,
  opts?: { speedMps?: number }
): void {
  stopMockLocation();
  if (points.length === 0) return;

  route = [...points];
  routeIndex = 0;
  current = { ...route[0] };
  onUpdate = callback;
  speedMps = opts?.speedMps ?? DEFAULT_SPEED_MPS;

  onUpdate(current.latitude, current.longitude);
  intervalId = setInterval(step, STEP_MS);
}

export function jumpTo(point: MockRoutePoint): void {
  if (!current || !onUpdate || route.length === 0) return;

  current = { ...point };

  let bestIndex = 0;
  let bestDist = Infinity;
  route.forEach((p, i) => {
    const d = haversineDistance(
      point.latitude,
      point.longitude,
      p.latitude,
      p.longitude
    );
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  });
  routeIndex = bestIndex;

  onUpdate(point.latitude, point.longitude);
}

export function stopMockLocation(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function isMockLocationActive(): boolean {
  return intervalId !== null;
}
