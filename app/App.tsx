import { useEffect, useState } from 'react';
import { AppState, View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { api } from './src/services/api';
import { requestNotificationPermission } from './src/services/notifications';
import { requestLocationPermission, syncLocationTracking, pauseTracking, resumeTracking } from './src/services/locationTracking';
import { connectSocket } from './src/services/socket';
import { loadSession, clearSession } from './src/services/session';
import { useGameStore } from './src/stores/useGameStore';
import { useTeamStore } from './src/stores/useTeamStore';

export default function App() {
  const gameId = useGameStore((s) => s.game?.id);
  const gameStatus = useGameStore((s) => s.game?.status);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const session = await loadSession();
        if (session) {
          const { game, team, isHost } = await api.rejoin(session.gameId, session.teamId);
          useGameStore.getState().setGame(game);
          useTeamStore.getState().setMyTeam(team.id, team.name, team.color);
          useTeamStore.getState().setHost(isHost);
          connectSocket(game.id, team.id);
        }
      } catch {
        await clearSession();
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

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

  if (restoring) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5' }}>
          <ActivityIndicator size="large" color="#1a1a2e" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AppNavigator />
    </SafeAreaProvider>
  );
}