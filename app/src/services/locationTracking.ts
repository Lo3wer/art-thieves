import * as Location from 'expo-location';
import { useGameStore } from '../stores/useGameStore';
import { useLocationStore } from '../stores/useLocationStore';
import { emitLocation } from './socket';
import { haversineDistance } from '../utils/distance';
import {
  isMockLocationEnabled,
  startMockLocation,
  stopMockLocation,
  type MockRoutePoint,
} from './mockLocation';

const EMIT_MIN_DISTANCE_M = 15;
const EMIT_MIN_INTERVAL_MS = 10000;
const HIGH_ACCURACY_RADIUS_MULTIPLIER = 2;

let realWatcher: Location.LocationSubscription | null = null;
let trackingGameId: string | null = null;
let lastEmitted: { lat: number; lng: number; at: number } | null = null;
let accuracyRegime: Location.Accuracy = Location.Accuracy.Balanced;

export async function requestLocationPermission(): Promise<boolean> {
  if (isMockLocationEnabled()) return true;
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

function gameIsUp(): boolean {
  const game = useGameStore.getState().game;
  return !!game && (game.status === 'active' || game.status === 'paused');
}

function routeFromGame(): MockRoutePoint[] {
  const game = useGameStore.getState().game;
  if (!game) return [];
  return game.landmarks.map((lm) => ({ latitude: lm.latitude, longitude: lm.longitude }));
}

function targetAccuracyForPosition(lat: number, lng: number): Location.Accuracy {
  const game = useGameStore.getState().game;
  if (!game || !game.landmarks || game.landmarks.length === 0) return Location.Accuracy.Balanced;
  let nearest = Infinity;
  for (const lm of game.landmarks) {
    const d = haversineDistance(lat, lng, lm.latitude, lm.longitude);
    if (d < nearest) nearest = d;
  }
  const threshold = (game.config.vicinityRadius ?? 30) * HIGH_ACCURACY_RADIUS_MULTIPLIER;
  return nearest <= threshold ? Location.Accuracy.High : Location.Accuracy.Balanced;
}

export function maybeEmitLocation(lat: number, lng: number): void {
  const at = Date.now();
  if (lastEmitted) {
    const dist = haversineDistance(lastEmitted.lat, lastEmitted.lng, lat, lng);
    if (dist < EMIT_MIN_DISTANCE_M && at - lastEmitted.at < EMIT_MIN_INTERVAL_MS) {
      return;
    }
  }
  lastEmitted = { lat, lng, at };
  emitLocation(lat, lng);
}

function handlePosition(loc: Location.LocationObject): void {
  const { latitude, longitude } = loc.coords;
  useLocationStore.getState().setOwnLocation(latitude, longitude);
  maybeEmitLocation(latitude, longitude);
  const target = targetAccuracyForPosition(latitude, longitude);
  if (target !== accuracyRegime) {
    accuracyRegime = target;
    stopRealTracking();
    startWatcher();
  }
}

function startWatcher(): void {
  if (realWatcher) return;
  Location.watchPositionAsync(
    { accuracy: accuracyRegime, distanceInterval: 10, timeInterval: 10000 },
    handlePosition
  )
    .then((sub) => {
      if (!gameIsUp()) {
        sub.remove();
        return;
      }
      realWatcher = sub;
    })
    .catch(() => {});
}

function startRealTracking(): void {
  if (realWatcher) return;
  Location.getCurrentPositionAsync({})
    .then((loc) => {
      const { latitude, longitude } = loc.coords;
      useLocationStore.getState().setOwnLocation(latitude, longitude);
      maybeEmitLocation(latitude, longitude);
    })
    .catch(() => {});
  startWatcher();
}

function stopRealTracking(): void {
  if (realWatcher) {
    realWatcher.remove();
    realWatcher = null;
  }
  lastEmitted = null;
}

export function syncLocationTracking(): void {
  if (!gameIsUp()) {
    trackingGameId = null;
    stopRealTracking();
    stopMockLocation();
    return;
  }
  const gameId = useGameStore.getState().game!.id;
  if (trackingGameId === gameId) return;
  trackingGameId = gameId;
  if (isMockLocationEnabled()) {
    stopRealTracking();
    startMockLocation(routeFromGame(), (lat, lng) => {
      useLocationStore.getState().setOwnLocation(lat, lng);
      maybeEmitLocation(lat, lng);
    });
  } else {
    stopMockLocation();
    startRealTracking();
  }
}

export function pauseTracking(): void {
  if (!trackingGameId) return;
  stopRealTracking();
  stopMockLocation();
}

export function resumeTracking(): void {
  if (!trackingGameId) return;
  if (isMockLocationEnabled()) {
    startMockLocation(routeFromGame(), (lat, lng) => {
      useLocationStore.getState().setOwnLocation(lat, lng);
      maybeEmitLocation(lat, lng);
    });
  } else {
    startRealTracking();
  }
}