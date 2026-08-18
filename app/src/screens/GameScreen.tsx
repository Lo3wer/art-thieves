import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../services/api';
import { useGameStore } from '../stores/useGameStore';
import { useTeamStore } from '../stores/useTeamStore';
import { getActiveElapsedMs } from '../utils/gameTime';
import { useFrozenTeams } from '../hooks/useFrozenTeams';
import DebugMenu from '../components/DebugMenu';

interface ScoreEntry {
  team: { id: string; name: string; color: string };
  claimed: number;
  locked: number;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function GameScreen() {
  const game = useGameStore((s) => s.game);
  const updateStatus = useGameStore((s) => s.updateStatus);
  const isHost = useTeamStore((s) => s.isHost);
  const myTeamId = useTeamStore((s) => s.myTeamId);
  const frozenTeams = useTeamStore((s) => s.frozenTeams);
  const { now } = useFrozenTeams();
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    if (!game || !game.startedAt) return;

    const tick = () => {
      const g = useGameStore.getState().game;
      if (!g || !g.startedAt || g.status !== 'active') return;
      const elapsed = getActiveElapsedMs(g.startedAt, g.totalPausedMs, g.pausedAt, g.status);
      const remaining = Math.max(0, Math.floor((g.config.duration * 1000 - elapsed) / 1000));
      setTimeLeft(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [game?.id, game?.status, game?.startedAt, game?.totalPausedMs, game?.config.duration]);

  const handlePause = async () => {
    if (!game) return;
    setLoading(true);
    try {
      await api.pauseGame(game.id);
      updateStatus('paused');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    if (!game) return;
    setLoading(true);
    try {
      await api.resumeGame(game.id);
      updateStatus('active');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEnd = async () => {
    if (!game) return;
    Alert.alert('End Game', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End', style: 'destructive',
        onPress: async () => {
          setLoading(true);
          try {
            await api.endGame(game.id);
            updateStatus('ended');
          } catch (e: any) {
            Alert.alert('Error', e.message);
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  };

  const handleKick = (targetTeamId: string) => {
    if (!game) return;
    Alert.alert('Kick Team', 'Remove this team from the game?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Kick', style: 'destructive',
        onPress: async () => {
          try {
            await api.kickTeam(game.id, targetTeamId, myTeamId ?? '');
          } catch (e: any) {
            Alert.alert('Error', e.message ?? 'Failed to kick team');
          }
        },
      },
    ]);
  };

  if (!game) return null;

  const scoreboard: ScoreEntry[] = game.teams.map((t) => {
    const mine = game.landmarkStates.filter((s) => s.teamId === t.id);
    return {
      team: { id: t.id, name: t.name, color: t.color },
      claimed: mine.length,
      locked: mine.filter((s) => s.status === 'locked').length,
    };
  });

  const sorted = [...scoreboard].sort((a, b) => {
    if (b.claimed !== a.claimed) return b.claimed - a.claimed;
    return b.locked - a.locked;
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Scoreboard</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: game.status === 'active' ? '#2ecc71' : game.status === 'paused' ? '#f39c12' : '#e74c3c' }]} />
          <Text style={styles.statusText}>{game.status.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.joinCodeBar}>
        <Text style={styles.joinCodeLabel}>Room Code</Text>
        <Text style={styles.joinCodeValue}>{game.joinCode}</Text>
      </View>

      {game.status === 'active' && (
        <View style={styles.clockCard}>
          <Text style={styles.clockValue}>{formatTime(timeLeft)}</Text>
          <Text style={styles.clockLabel}>remaining</Text>
        </View>
      )}

      {game.status === 'paused' && (
        <View style={styles.pausedBanner}>
          <Text style={styles.pausedText}>GAME PAUSED</Text>
        </View>
      )}

      <FlatList
        data={sorted}
        keyExtractor={(item) => item.team.id}
        renderItem={({ item, index }) => {
          const frozenUntil = frozenTeams[item.team.id];
          const frozenRemaining = frozenUntil
            ? Math.max(0, Math.floor((new Date(frozenUntil).getTime() - now) / 1000))
            : 0;
          return (
            <View style={styles.scoreRow}>
              <Text style={styles.rank}>#{index + 1}</Text>
              <View style={[styles.teamColor, { backgroundColor: item.team.color }]} />
              <View style={styles.scoreInfo}>
                <Text style={styles.teamName}>{item.team.name}</Text>
                <Text style={styles.scoreDetail}>
                  {item.claimed} claimed{item.locked > 0 ? ` (${item.locked} locked)` : ''}
                </Text>
              </View>
              {frozenRemaining > 0 && (
                <View style={styles.frozenBadge}>
                  <MaterialIcons name="ac-unit" size={14} color="#fff" />
                  <Text style={styles.frozenBadgeText}>FROZEN {formatTime(frozenRemaining)}</Text>
                </View>
              )}
              {isHost && item.team.id !== myTeamId && (
                <TouchableOpacity style={styles.kickButton} onPress={() => handleKick(item.team.id)}>
                  <Text style={styles.kickButtonText}>Kick</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
        style={styles.list}
      />

      {isHost && (
        <View style={styles.hostControls}>
          {game.status === 'active' && (
            <TouchableOpacity style={styles.pauseButton} onPress={handlePause} disabled={loading}>
              <Text style={styles.buttonText}>{loading ? '...' : 'Pause'}</Text>
            </TouchableOpacity>
          )}
          {game.status === 'paused' && (
            <TouchableOpacity style={styles.resumeButton} onPress={handleResume} disabled={loading}>
              <Text style={styles.buttonText}>{loading ? '...' : 'Resume'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.endButton} onPress={handleEnd} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? '...' : 'End Game'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.debugButton}
            onPress={() => setShowDebug(true)}
            disabled={loading}
          >
            <MaterialIcons name="build" size={16} color="#666" />
            <Text style={styles.debugButtonText}>Debug</Text>
          </TouchableOpacity>
        </View>
      )}

      <DebugMenu visible={showDebug} onClose={() => setShowDebug(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1a1a2e' },
  joinCodeBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1a1a2e', paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 8, marginBottom: 12, gap: 10,
  },
  joinCodeLabel: { fontSize: 12, color: '#aaa', letterSpacing: 1 },
  joinCodeValue: { fontSize: 20, fontWeight: 'bold', color: '#fff', letterSpacing: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 12, fontWeight: '700', color: '#666', letterSpacing: 1 },
  clockCard: {
    backgroundColor: '#1a1a2e', padding: 20, borderRadius: 12,
    alignItems: 'center', marginBottom: 16,
  },
  clockValue: { fontSize: 48, fontWeight: 'bold', color: '#fff', fontVariant: ['tabular-nums'] },
  clockLabel: { fontSize: 14, color: '#aaa', marginTop: 4 },
  pausedBanner: { backgroundColor: '#f39c12', padding: 12, borderRadius: 8, alignItems: 'center', marginBottom: 16 },
  pausedText: { color: '#fff', fontSize: 18, fontWeight: 'bold', letterSpacing: 2 },
  pendingBadge: { backgroundColor: '#f39c12', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  pendingText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  list: { flex: 1 },
  scoreRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    padding: 14, borderRadius: 10, marginBottom: 8, elevation: 1,
  },
  rank: { fontSize: 18, fontWeight: 'bold', color: '#888', width: 36 },
  teamColor: { width: 14, height: 14, borderRadius: 7, marginRight: 12 },
  scoreInfo: { flex: 1 },
  teamName: { fontSize: 16, fontWeight: '600', color: '#1a1a2e' },
  scoreDetail: { fontSize: 13, color: '#888', marginTop: 2 },
  frozenBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#3498db',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginLeft: 8, gap: 4,
  },
  frozenBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  kickButton: {
    backgroundColor: '#e74c3c', paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 6, marginLeft: 8,
  },
  kickButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  hostControls: { flexDirection: 'row', gap: 12, marginTop: 16, alignItems: 'center' },
  pauseButton: { flex: 1, backgroundColor: '#f39c12', padding: 14, borderRadius: 10, alignItems: 'center' },
  resumeButton: { flex: 1, backgroundColor: '#2ecc71', padding: 14, borderRadius: 10, alignItems: 'center' },
  endButton: { flex: 1, backgroundColor: '#e74c3c', padding: 14, borderRadius: 10, alignItems: 'center' },
  debugButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#c8c8c8',
  },
  debugButtonText: { color: '#666', fontSize: 14, fontWeight: '600' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
