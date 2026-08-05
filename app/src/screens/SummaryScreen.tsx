import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { api } from '../services/api';
import { disconnectSocket } from '../services/socket';
import { useGameStore } from '../stores/useGameStore';
import { useTeamStore } from '../stores/useTeamStore';
import type { GameSummary } from '../types';

type SummaryView = 'landmarks' | 'teams';

const STATUS_LABEL: Record<'unclaimed' | 'claimed' | 'locked', string> = {
  unclaimed: 'Unclaimed',
  claimed: 'Claimed',
  locked: 'Locked',
};

const CHALLENGE_LABEL: Record<'complete' | 'fail' | 'pass', string> = {
  complete: 'Challenge completed',
  fail: 'Challenge failed',
  pass: 'Challenge passed',
};

export default function SummaryScreen() {
  const game = useGameStore((s) => s.game);
  const [summary, setSummary] = useState<GameSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<SummaryView>('teams');

  const clearGame = useGameStore((s) => s.clearGame);
  const clearTeam = useTeamStore((s) => s.clear);

  const load = useCallback(async () => {
    if (!game) return;
    setLoading(true);
    try {
      const data = await api.getSummary(game.id);
      setSummary(data);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [game?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleReturnToLobby = () => {
    disconnectSocket();
    clearTeam();
    clearGame();
  };

  if (!game) return null;

  if (loading || !summary) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1a1a2e" />
        <Text style={styles.loadingText}>Compiling results...</Text>
      </View>
    );
  }

  const teams = summary.scores.map((s) => {
    const tagStat = summary.tags.find((t) => t.teamId === s.teamId);
    return {
      ...s,
      tagsGiven: tagStat?.given ?? 0,
      tagsReceived: tagStat?.received ?? 0,
    };
  });

  const winnerColor = summary.winner.color ?? '#1a1a2e';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Game Over</Text>

      <View style={[styles.winnerCard, { backgroundColor: winnerColor }]}>
        {summary.winner.isTie ? (
          <>
            <Text style={styles.winnerTitle}>It's a Tie!</Text>
            <Text style={styles.winnerSub}>No single winning team</Text>
          </>
        ) : (
          <>
            <Text style={styles.winnerTitle}>{summary.winner.name ?? 'Unknown team'} Wins!</Text>
            <Text style={styles.winnerSub}>Congratulations</Text>
          </>
        )}
      </View>

      <View style={styles.segmented}>
        <TouchableOpacity
          style={[styles.segment, view === 'landmarks' && styles.segmentActive]}
          onPress={() => setView('landmarks')}
        >
          <Text style={[styles.segmentText, view === 'landmarks' && styles.segmentTextActive]}>
            By Landmark
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segment, view === 'teams' && styles.segmentActive]}
          onPress={() => setView('teams')}
        >
          <Text style={[styles.segmentText, view === 'teams' && styles.segmentTextActive]}>
            By Team
          </Text>
        </TouchableOpacity>
      </View>

      {view === 'landmarks' ? (
        <FlatList
          data={summary.landmarks}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text
                  style={[
                    styles.badge,
                    item.status === 'locked'
                      ? styles.badgeLocked
                      : item.status === 'claimed'
                      ? styles.badgeClaimed
                      : styles.badgeUnclaimed,
                  ]}
                >
                  {STATUS_LABEL[item.status]}
                </Text>
              </View>
              {item.teamId && item.teamName ? (
                <Text style={styles.owner}>
                  {item.status === 'locked' ? 'Locked by' : 'Claimed by'} {item.teamName}
                </Text>
              ) : (
                <Text style={styles.owner}>Not claimed</Text>
              )}
              {item.challenge && (
                <Text style={styles.challenge}>{CHALLENGE_LABEL[item.challenge.outcome]}</Text>
              )}
            </View>
          )}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No landmarks found</Text>
          }
        />
      ) : (
        <FlatList
          data={teams}
          keyExtractor={(item) => item.teamId}
          renderItem={({ item, index }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.teamWithDot}>
                  <View style={[styles.dot, { backgroundColor: item.color }]} />
                  <Text style={styles.cardTitle}>#{index + 1} {item.name}</Text>
                </View>
              </View>
              <View style={styles.statGrid}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{item.claimed}</Text>
                  <Text style={styles.statLabel}>Claimed</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{item.locked}</Text>
                  <Text style={styles.statLabel}>Locked</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{item.tagsGiven}</Text>
                  <Text style={styles.statLabel}>Tags Given</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{item.tagsReceived}</Text>
                  <Text style={styles.statLabel}>Tags Taken</Text>
                </View>
              </View>
            </View>
          )}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No teams found</Text>
          }
        />
      )}

      <TouchableOpacity style={styles.returnButton} onPress={handleReturnToLobby}>
        <Text style={styles.returnButtonText}>Return to Lobby</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  loadingText: { marginTop: 12, fontSize: 16, color: '#666' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1a1a2e', textAlign: 'center', marginBottom: 12 },
  winnerCard: {
    padding: 20, borderRadius: 12, alignItems: 'center', marginBottom: 16,
  },
  winnerTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  winnerSub: { fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  segmented: { flexDirection: 'row', backgroundColor: '#e0e0e0', borderRadius: 10, padding: 4, marginBottom: 12 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: '#1a1a2e' },
  segmentText: { fontSize: 14, fontWeight: '600', color: '#666' },
  segmentTextActive: { color: '#fff' },
  listContent: { paddingBottom: 16 },
  card: {
    backgroundColor: '#fff', padding: 14, borderRadius: 10,
    marginBottom: 8, elevation: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a2e', flexShrink: 1 },
  teamWithDot: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  dot: { width: 14, height: 14, borderRadius: 7, marginRight: 8 },
  badge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    fontSize: 12, fontWeight: '700', color: '#fff', marginLeft: 8, overflow: 'hidden',
  },
  badgeLocked: { backgroundColor: '#e74c3c' },
  badgeClaimed: { backgroundColor: '#2ecc71' },
  badgeUnclaimed: { backgroundColor: '#888' },
  owner: { fontSize: 13, color: '#666', marginTop: 8, flexShrink: 1 },
  challenge: { fontSize: 12, color: '#888', marginTop: 4 },
  statGrid: { flexDirection: 'row', marginTop: 12, gap: 8 },
  stat: {
    flex: 1, backgroundColor: '#f5f5f5', borderRadius: 8, padding: 10, alignItems: 'center',
  },
  statValue: { fontSize: 20, fontWeight: 'bold', color: '#1a1a2e' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 2 },
  emptyText: { fontSize: 14, color: '#888', textAlign: 'center', marginTop: 24 },
  returnButton: {
    backgroundColor: '#1a1a2e', paddingVertical: 16, borderRadius: 12,
    alignItems: 'center', marginTop: 8,
  },
  returnButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});