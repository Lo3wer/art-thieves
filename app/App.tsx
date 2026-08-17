import { useEffect } from 'react';
import { AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { requestNotificationPermission } from './src/services/notifications';
import { requestLocationPermission, syncLocationTracking, pauseTracking, resumeTracking } from './src/services/locationTracking';
import { useGameStore } from './src/stores/useGameStore';

export default function App() {
  const gameId = useGameStore((s) => s.game?.id);
  const gameStatus = useGameStore((s) => s.game?.status);

  useEffect(() => {
    requestNotificationPermission();
    requestLocationPermission();
  }, []);

  useEffect(() => {
    syncLocationTracking();
  }, [gameId, gameStatus]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        resumeTracking();
      } else if (state === 'background') {
        pauseTracking();
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AppNavigator />
    </SafeAreaProvider>
  );
}