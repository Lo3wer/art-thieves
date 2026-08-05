import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { useGameStore } from '../stores/useGameStore';
import { useTeamStore } from '../stores/useTeamStore';
import LobbyScreen from '../screens/LobbyScreen';
import GameScreen from '../screens/GameScreen';
import MapScreen from '../screens/MapScreen';
import ClaimScreen from '../screens/ClaimScreen';
import TagScreen from '../screens/TagScreen';
import LogScreen from '../screens/LogScreen';

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, React.ComponentProps<typeof MaterialIcons>['name']> = {
  Lobby: 'home',
  Game: 'emoji-events',
  Map: 'map',
  Claim: 'photo-camera',
  Tag: 'label',
  Log: 'receipt-long',
};

export default function AppNavigator() {
  const game = useGameStore((s) => s.game);
  const myTeamColor = useTeamStore((s) => s.myTeamColor);
  const teamColor = myTeamColor ?? '#1a1a2e';
  const hasActiveGame = game !== null && game.status !== 'ended' && game.status !== 'lobby';

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused }) => (
            <MaterialIcons
              name={TAB_ICONS[route.name] ?? 'circle'}
              size={24}
              color={focused ? teamColor : `${teamColor}88`}
            />
          ),
          tabBarActiveTintColor: teamColor,
          tabBarInactiveTintColor: '#888',
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
