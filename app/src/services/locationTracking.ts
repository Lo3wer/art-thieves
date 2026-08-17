import * as Location from 'expo-location';
import { useGameStore } from '../stores/useGameStore';
import { useLocationStore } from '../stores/useLocationStore';
import { emitLocation } from './socket';
import {
  isMockLocationEnabled,
  startMockLocation,
  stopMockLocation,
  type MockRoutePoint,
} from './mockLocation';

const WATCH_ACCURACY = Location.Accuracy.High;
const WATCH_DISTANCE_INTERVAL = 5;
const WATCH_TIME_INTERVAL = 5000;
const HEARTBEAT_MS = 20000;

let realWatcher: Location.LocationSubscription | null = null;
let trackingGameId: string | null = null;
let heartbeatId: ReturnType<typeof setInterval> | null = null;

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

function handlePosition(loc: Location.LocationObject): void {
  const { latitude, longitude } = loc.coords;
  useLocationStore.getState().setOwnLocation(latitude, longitude);
  emitLocation(latitude, longitude);
}

function startWatcher(): void {
  if (realWatcher) return;
  Location.watchPositionAsync(
    {
      accuracy: WATCH_ACCURACY,
      distanceInterval: WATCH_DISTANCE_INTERVAL,
      timeInterval: WATCH_TIME_INTERVAL,
    },
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
      emitLocation(latitude, longitude);
    })
    .catch(() => {});
  startWatcher();
}

function stopRealTracking(): void {
  if (realWatcher) {
    realWatcher.remove();
    realWatcher = null;
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatId = setInterval(() => {
    const own = useLocationStore.getState().ownLocation;
    if (own) emitLocation(own.latitude, own.longitude);
  }, HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (heartbeatId) {
    clearInterval(heartbeatId);
    heartbeatId = null;
  }
}

export function syncLocationTracking(): void {
  if (!gameIsUp()) {
    trackingGameId = null;
    stopRealTracking();
    stopMockLocation();
    stopHeartbeat();
    return;
  }
  const gameId = useGameStore.getState().game!.id;
  if (trackingGameId === gameId) return;
  trackingGameId = gameId;
  if (isMockLocationEnabled()) {
    stopRealTracking();
    startMockLocation(routeFromGame(), (lat, lng) => {
      useLocationStore.getState().setOwnLocation(lat, lng);
      emitLocation(lat, lng);
    });
    startHeartbeat();
  } else {
    stopMockLocation();
    startRealTracking();
    startHeartbeat();
  }
}

export function pauseTracking(): void {
  if (!trackingGameId) return;
  stopRealTracking();
  stopMockLocation();
  stopHeartbeat();
}

export function resumeTracking(): void {
  if (!trackingGameId) return;
  if (isMockLocationEnabled()) {
    startMockLocation(routeFromGame(), (lat, lng) => {
      useLocationStore.getState().setOwnLocation(lat, lng);
      emitLocation(lat, lng);
    });
  } else {
    startRealTracking();
  }
  startHeartbeat();
}