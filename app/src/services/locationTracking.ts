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

let realWatcher: Location.LocationSubscription | null = null;
let trackingGameId: string | null = null;

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

function startRealTracking(): void {
  if (realWatcher) return;
  Location.getCurrentPositionAsync({})
    .then((loc) => {
      useLocationStore.getState().setOwnLocation(loc.coords.latitude, loc.coords.longitude);
      emitLocation(loc.coords.latitude, loc.coords.longitude);
    })
    .catch(() => {});
  Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 5000 },
    (loc) => {
      useLocationStore.getState().setOwnLocation(loc.coords.latitude, loc.coords.longitude);
      emitLocation(loc.coords.latitude, loc.coords.longitude);
    }
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

function stopRealTracking(): void {
  if (realWatcher) {
    realWatcher.remove();
    realWatcher = null;
  }
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
      emitLocation(lat, lng);
    });
  } else {
    stopMockLocation();
    startRealTracking();
  }
}