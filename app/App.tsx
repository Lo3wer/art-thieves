import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { requestNotificationPermission } from './src/services/notifications';
import { requestLocationPermission, syncLocationTracking } from './src/services/locationTracking';
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

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AppNavigator />
    </SafeAreaProvider>
  );
}