import { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { api } from '../services/api';
import { useGameStore } from '../stores/useGameStore';
import { useLogStore } from '../stores/useLogStore';
import type { LogEntry } from '../types';

const EVENT_ICONS: Record<string, string> = {
  game_created: '🎮',
  team_joined: '👋',
  game_started: '▶️',
  game_paused: '⏸️',
  game_resumed: '▶️',
  game_ended: '⏹️',
  landmark_claimed: '📸',
  landmark_stolen: '⚔️',
  challenge_complete: '🔒',
  challenge_fail: '❌',
  challenge_pass: '➡️',
  tag_created: '🏷️',
  tag_disputed: '🔄',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function getEventText(entry: LogEntry): string {
  const data = entry.data as Record<string, string>;
  switch (entry.type) {
    case 'game_created':
      return `Game created (${data.mapName ?? 'Unknown map'})`;
    case 'team_joined':
      return `${data.teamName ?? 'A team'} joined`;
    case 'game_started':
      return 'Game started!';
    case 'game_paused':
      return 'Game paused';
    case 'game_resumed':
      return 'Game resumed';
    case 'game_ended':
      return 'Game ended';
    case 'landmark_claimed':
      return `${data.teamName ?? 'Unknown'} claimed ${data.landmarkName ?? 'a landmark'}`;
    case 'landmark_stolen':
      return `${data.teamName ?? 'Unknown'} stole ${data.landmarkName ?? 'a landmark'} from ${data.fromTeamName ?? 'Unknown'}`;
    case 'challenge_complete':
      return `${data.teamName ?? 'Unknown'} completed challenge on ${data.landmarkName ?? 'a landmark'} (LOCKED)`;
    case 'challenge_fail':
      return `${data.teamName ?? 'Unknown'} failed challenge on ${data.landmarkName ?? 'a landmark'}`;
    case 'challenge_pass':
      return `${data.teamName ?? 'Unknown'} passed challenge on ${data.landmarkName ?? 'a landmark'}`;
    case 'tag_created':
      return `${data.taggerName ?? 'Unknown'} tagged ${data.targetName ?? 'Unknown'}`;
    case 'tag_disputed':
      return `${data.targetName ?? 'Unknown'} disputed a tag from ${data.taggerName ?? 'Unknown'}`;
    default:
      return entry.type;
  }
}

export default function LogScreen() {
  const game = useGameStore((s) => s.game);
  const entries = useLogStore((s) => s.entries);
  const setEntries = useLogStore((s) => s.setEntries);
  const [filterTeamId, setFilterTeamId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!game) return;
    (async () => {
      try {
        const data = await api.getLog(game.id);
        setEntries(data as LogEntry[]);
      } catch {}
    })();
  }, [game?.id, setEntries]);

  if (!game) return null;

  const log = filterTeamId
    ? entries.filter((e) => {
        const data = e.data as Record<string, string>;
        return data?.teamId === filterTeamId || data?.targetTeamId === filterTeamId;
      })
    : entries;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Event Log</Text>

      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, !filterTeamId && styles.filterChipActive]}
          onPress={() => setFilterTeamId(undefined)}
        >
          <Text style={[styles.filterText, !filterTeamId && styles.filterTextActive]}>All</Text>
        </TouchableOpacity>
        {game.teams.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[
              styles.filterChip,
              filterTeamId === t.id && styles.filterChipActive,
              { borderColor: t.color },
              filterTeamId === t.id && { backgroundColor: t.color + '20' },
            ]}
            onPress={() => setFilterTeamId(filterTeamId === t.id ? undefined : t.id)}
          >
            <Text
              style={[
                styles.filterText,
                filterTeamId === t.id && styles.filterTextActive,
                { color: filterTeamId === t.id ? t.color : '#666' },
              ]}
            >
              {t.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={log}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.logItem}>
            <Text style={styles.logIcon}>{EVENT_ICONS[item.type] ?? '📄'}</Text>
            <View style={styles.logContent}>
              <Text style={styles.logText}>{getEventText(item)}</Text>
              <Text style={styles.logTime}>{formatTime(item.timestamp)}</Text>
            </View>
          </View>
        )}
        contentContainerStyle={log.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <View style={styles.emptyView}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyText}>No events yet</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1a1a2e', marginBottom: 12 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff',
  },
  filterChipActive: { backgroundColor: '#1a1a2e', borderColor: '#1a1a2e' },
  filterText: { fontSize: 13, fontWeight: '500', color: '#666' },
  filterTextActive: { color: '#fff' },
  logItem: {
    flexDirection: 'row', backgroundColor: '#fff', padding: 14,
    borderRadius: 10, marginBottom: 6, elevation: 1,
  },
  logIcon: { fontSize: 20, marginRight: 12, marginTop: 2 },
  logContent: { flex: 1 },
  logText: { fontSize: 14, color: '#1a1a2e' },
  logTime: { fontSize: 11, color: '#aaa', marginTop: 4 },
  emptyContainer: { flex: 1 },
  emptyView: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#888' },
});
