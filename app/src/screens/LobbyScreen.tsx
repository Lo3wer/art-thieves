import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { api } from '../services/api';
import { useGameStore } from '../stores/useGameStore';
import { useTeamStore } from '../stores/useTeamStore';
import { useLobbyStore } from '../stores/useLobbyStore';
import type { GameMap, GameConfig } from '../types';

const TEAM_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];

const DEFAULT_CONFIG: GameConfig = {
  duration: 3600,
  vicinityRadius: 30,
  winThreshold: 20,
  reTagCooldown: 300,
  disputeWindow: 60,
};

type LobbyView = 'home' | 'host_map_select' | 'host_settings' | 'join' | 'waiting';

export default function LobbyScreen() {
  const [view, setView] = useState<LobbyView>('home');
  const [loading, setLoading] = useState(false);
  const [maps, setMaps] = useState<GameMap[]>([]);
  const [selectedMap, setSelectedMap] = useState<GameMap | null>(null);
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [joinCode, setJoinCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamColor, setTeamColor] = useState(TEAM_COLORS[0]);
  const [roster, setRoster] = useState<{ name: string; color: string }[]>([]);
  const [gameCode, setGameCode] = useState('');

  const setGame = useGameStore((s) => s.setGame);
  const setMyTeam = useTeamStore((s) => s.setMyTeam);
  const setHost = useTeamStore((s) => s.setHost);
  const clearTeam = useTeamStore((s) => s.clear);
  const clearGame = useGameStore((s) => s.clearGame);
  const availableMaps = useLobbyStore((s) => s.availableMaps);
  const setAvailableMaps = useLobbyStore((s) => s.setAvailableMaps);

  const loadMaps = useCallback(async () => {
    try {
      const result = await api.fetchMaps();
      setMaps(result);
      setAvailableMaps(result);
    } catch (e) {
      Alert.alert('Error', 'Failed to load maps');
    }
  }, [setAvailableMaps]);

  useEffect(() => {
    if (availableMaps.length === 0) {
      loadMaps();
    } else {
      setMaps(availableMaps);
    }
  }, [availableMaps, loadMaps]);

  const handleImportMap = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/geo+json', 'application/json', '*/*'],
      });
      if (result.canceled) return;
      const file = result.assets[0];
      const content = await FileSystem.readAsStringAsync(file.uri);
      const parsed = JSON.parse(content);
      const imported = await api.importMap(parsed);
      setMaps((prev) => [...prev, imported]);
      setAvailableMaps([...maps, imported]);
      Alert.alert('Success', `Imported "${imported.name}"`);
    } catch (e) {
      Alert.alert('Error', 'Failed to import map. Ensure it is valid GeoJSON.');
    }
  };

  const handleCreateGame = async () => {
    if (!selectedMap) return;
    setLoading(true);
    try {
      api.setCurrentTeam(null);
      const game = await api.createGame(selectedMap.id, config);
      const team = await api.joinGame(game.joinCode, teamName || 'Team Alpha', teamColor);
      api.setCurrentTeam(team.team.id);
      setGame(game);
      setMyTeam(team.team.id, team.team.name, team.team.color);
      setHost(true);
      setGameCode(game.joinCode);
      setRoster([{ name: team.team.name, color: team.team.color }]);
      setView('waiting');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to create game');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGame = async () => {
    if (!joinCode.trim() || !teamName.trim()) {
      Alert.alert('Missing', 'Enter a join code and team name');
      return;
    }
    setLoading(true);
    try {
      api.setCurrentTeam(null);
      const { game, team } = await api.joinGame(joinCode.trim().toUpperCase(), teamName.trim(), teamColor);
      api.setCurrentTeam(team.id);
      setGame(game);
      setMyTeam(team.id, team.name, team.color);
      setHost(false);
      setGameCode(game.joinCode);
      const existingTeams = game.teams.filter((t: any) => t.id !== team.id);
      setRoster([
        ...existingTeams.map((t: any) => ({ name: t.name, color: t.color })),
        { name: team.name, color: team.color },
      ]);
      setView('waiting');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to join game');
    } finally {
      setLoading(false);
    }
  };

  const handleStartGame = async () => {
    const game = useGameStore.getState().game;
    if (!game) return;
    setLoading(true);
    try {
      await api.startGame(game.id);
      const updated = await api.getGame(game.id);
      setGame(updated);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to start game');
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveGame = () => {
    clearTeam();
    clearGame();
    setView('home');
    setRoster([]);
    setGameCode('');
  };

  const pollGame = useCallback(async () => {
    const game = useGameStore.getState().game;
    if (!game || game.status !== 'lobby') return;
    try {
      const updated = await api.getGame(game.id);
      setGame(updated);
      setRoster(
        updated.teams.map((t: any) => ({ name: t.name, color: t.color }))
      );
    } catch {}
  }, [setGame]);

  useEffect(() => {
    if (view === 'waiting') {
      const interval = setInterval(pollGame, 2000);
      return () => clearInterval(interval);
    }
  }, [view, pollGame]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1a1a2e" />
        <Text style={styles.loadingText}>Processing...</Text>
      </View>
    );
  }

  if (view === 'waiting') {
    const game = useGameStore.getState().game;
    const isHost = useTeamStore.getState().isHost;
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Game Lobby</Text>
        <View style={styles.codeCard}>
          <View style={styles.codeBox}>
            <Text style={styles.codeValue}>{gameCode}</Text>
          </View>
          <Text style={styles.codeHint}>Share this code for others to join</Text>
        </View>
        <Text style={styles.sectionTitle}>Teams ({roster.length})</Text>
        <FlatList
          data={roster}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => (
            <View style={styles.rosterItem}>
              <View style={[styles.colorDot, { backgroundColor: item.color }]} />
              <Text style={styles.rosterName}>{item.name}</Text>
            </View>
          )}
          style={styles.rosterList}
        />
        {isHost ? (
          <TouchableOpacity style={styles.primaryButton} onPress={handleStartGame}>
            <Text style={styles.buttonText}>Start Game</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.waitingText}>Waiting for host to start...</Text>
        )}
        <TouchableOpacity style={styles.secondaryButton} onPress={handleLeaveGame}>
          <Text style={styles.secondaryButtonText}>Leave Game</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (view === 'host_map_select') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Select Map</Text>
        <FlatList
          data={maps}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.mapItem,
                selectedMap?.id === item.id && styles.mapItemSelected,
              ]}
              onPress={() => {
                setSelectedMap(item);
                setView('host_settings');
              }}
            >
              <Text style={styles.mapName}>{item.name}</Text>
              <Text style={styles.mapDetail}>
                {item.data.features.filter((f) => f.properties?.type === 'landmark').length} landmarks
              </Text>
            </TouchableOpacity>
          )}
          style={styles.list}
        />
        <TouchableOpacity style={styles.secondaryButton} onPress={handleImportMap}>
          <Text style={styles.secondaryButtonText}>Import Map</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setView('home')}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (view === 'host_settings') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Game Settings</Text>
        {selectedMap && (
          <View style={styles.selectedMapCard}>
            <Text style={styles.mapName}>{selectedMap.name}</Text>
            <Text style={styles.mapDetail}>Default radius: {selectedMap.defaultVicinityRadius}m</Text>
          </View>
        )}
        <Text style={styles.fieldLabel}>Duration (minutes)</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={String(config.duration / 60)}
          onChangeText={(t) => setConfig({ ...config, duration: Math.max(1, parseInt(t) || 1) * 60 })}
        />
        <Text style={styles.fieldLabel}>Vicinity Radius (meters)</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={String(config.vicinityRadius)}
          onChangeText={(t) => setConfig({ ...config, vicinityRadius: Math.max(10, parseInt(t) || 10) })}
        />
        <Text style={styles.fieldLabel}>Win Threshold</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={String(config.winThreshold)}
          onChangeText={(t) => setConfig({ ...config, winThreshold: Math.max(1, parseInt(t) || 1) })}
        />
        <Text style={styles.fieldLabel}>Re-tag Cooldown (seconds)</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={String(config.reTagCooldown)}
          onChangeText={(t) => setConfig({ ...config, reTagCooldown: Math.max(0, parseInt(t) || 0) })}
        />
        <Text style={styles.fieldLabel}>Dispute Window (seconds)</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={String(config.disputeWindow)}
          onChangeText={(t) => setConfig({ ...config, disputeWindow: Math.max(10, parseInt(t) || 10) })}
        />
        <Text style={styles.fieldLabel}>Your Team Name</Text>
        <TextInput
          style={styles.input}
          value={teamName}
          onChangeText={setTeamName}
          placeholder="Enter team name"
        />
        <Text style={styles.fieldLabel}>Team Color</Text>
        <View style={styles.colorRow}>
          {TEAM_COLORS.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.colorSwatch, { backgroundColor: c }, teamColor === c && styles.colorSelected]}
              onPress={() => setTeamColor(c)}
            />
          ))}
        </View>
        <TouchableOpacity style={styles.primaryButton} onPress={handleCreateGame}>
          <Text style={styles.buttonText}>Create Game</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setView('host_map_select')}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (view === 'join') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Join Game</Text>
        <Text style={styles.fieldLabel}>Join Code</Text>
        <TextInput
          style={styles.input}
          value={joinCode}
          onChangeText={setJoinCode}
          placeholder="Enter 6-character code"
          autoCapitalize="characters"
        />
        <Text style={styles.fieldLabel}>Your Team Name</Text>
        <TextInput
          style={styles.input}
          value={teamName}
          onChangeText={setTeamName}
          placeholder="Enter team name"
        />
        <Text style={styles.fieldLabel}>Team Color</Text>
        <View style={styles.colorRow}>
          {TEAM_COLORS.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.colorSwatch, { backgroundColor: c }, teamColor === c && styles.colorSelected]}
              onPress={() => setTeamColor(c)}
            />
          ))}
        </View>
        <TouchableOpacity style={styles.primaryButton} onPress={handleJoinGame}>
          <Text style={styles.buttonText}>Join</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setView('home')}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Vancouver Art Thieves</Text>
      <Text style={styles.subtitle}>Compete to claim art landmarks across the city!</Text>
      <View style={styles.homeButtons}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => {
            setSelectedMap(null);
            setTeamName('');
            setTeamColor(TEAM_COLORS[0]);
            setView('host_map_select');
          }}
        >
          <Text style={styles.buttonText}>Create Game</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.outlineButton}
          onPress={() => {
            setJoinCode('');
            setTeamName('');
            setTeamColor(TEAM_COLORS[0]);
            setView('join');
          }}
        >
          <Text style={styles.outlineButtonText}>Join Game</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  scrollContent: { paddingBottom: 40 },
  loadingText: { marginTop: 12, fontSize: 16, color: '#666' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1a1a2e', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 32 },
  homeButtons: { gap: 16, marginTop: 32 },
  primaryButton: {
    backgroundColor: '#1a1a2e', paddingVertical: 16, borderRadius: 12,
    alignItems: 'center', marginTop: 16,
  },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  outlineButton: {
    borderWidth: 2, borderColor: '#1a1a2e', paddingVertical: 16,
    borderRadius: 12, alignItems: 'center',
  },
  outlineButtonText: { color: '#1a1a2e', fontSize: 18, fontWeight: '600' },
  secondaryButton: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  secondaryButtonText: { color: '#1a1a2e', fontSize: 16 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12,
    fontSize: 16, backgroundColor: '#fff', marginBottom: 12,
  },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 4, marginTop: 8 },
  colorRow: { flexDirection: 'row', gap: 12, marginBottom: 16, marginTop: 4 },
  colorSwatch: { width: 36, height: 36, borderRadius: 18 },
  colorSelected: { borderWidth: 3, borderColor: '#1a1a2e' },
  list: { flex: 1, marginBottom: 16 },
  mapItem: {
    backgroundColor: '#fff', padding: 16, borderRadius: 8, marginBottom: 8,
    borderWidth: 1, borderColor: '#eee',
  },
  mapItemSelected: { borderColor: '#1a1a2e', borderWidth: 2 },
  mapName: { fontSize: 16, fontWeight: '600', color: '#1a1a2e' },
  mapDetail: { fontSize: 13, color: '#888', marginTop: 2 },
  selectedMapCard: {
    backgroundColor: '#e8f4f8', padding: 12, borderRadius: 8, marginBottom: 16,
  },
  codeCard: {
    backgroundColor: '#fff', padding: 20, borderRadius: 16, alignItems: 'center',
    marginVertical: 20, borderWidth: 1, borderColor: '#e0e0e0',
  },
  codeBox: {
    backgroundColor: '#1a1a2e', paddingVertical: 16, paddingHorizontal: 32,
    borderRadius: 12, marginVertical: 8,
  },
  codeValue: { fontSize: 48, fontWeight: 'bold', color: '#ffffff', letterSpacing: 10 },
  codeHint: { fontSize: 13, color: '#888' },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1a1a2e', marginTop: 8 },
  rosterList: { flex: 1, marginTop: 8 },
  rosterItem: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#fff', borderRadius: 8, marginBottom: 6 },
  colorDot: { width: 16, height: 16, borderRadius: 8, marginRight: 12 },
  rosterName: { fontSize: 16, color: '#333' },
  waitingText: { fontSize: 16, color: '#666', textAlign: 'center', marginTop: 24 },
});
