import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useGameStore } from '../stores/useGameStore';
import LobbyScreen from '../screens/LobbyScreen';
import GameScreen from '../screens/GameScreen';
import MapScreen from '../screens/MapScreen';
import ClaimScreen from '../screens/ClaimScreen';
import TagScreen from '../screens/TagScreen';
import LogScreen from '../screens/LogScreen';

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, string> = {
  Lobby: '🏠',
  Game: '🏆',
  Map: '🗺️',
  Claim: '📸',
  Tag: '🏷️',
  Log: '📋',
};

export default function AppNavigator() {
  const game = useGameStore((s) => s.game);
  const hasActiveGame = game !== null && game.status !== 'ended' && game.status !== 'lobby';

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: () => (
            <Text style={{ fontSize: 20 }}>{TAB_ICONS[route.name] ?? '•'}</Text>
          ),
          tabBarActiveTintColor: '#1a1a2e',
          tabBarInactiveTintColor: '#999',
          headerShown: false,
        })}
      >
        {hasActiveGame ? (
          <>
            <Tab.Screen name="Game" component={GameScreen} />
            <Tab.Screen name="Map" component={MapScreen} />
            <Tab.Screen name="Claim" component={ClaimScreen} />
            <Tab.Screen name="Tag" component={TagScreen} />
            <Tab.Screen name="Log" component={LogScreen} />
          </>
        ) : (
          <Tab.Screen
            name="Lobby"
            component={LobbyScreen}
            options={{ tabBarStyle: { display: 'none' } }}
          />
        )}
      </Tab.Navigator>
    </NavigationContainer>
  );
}
