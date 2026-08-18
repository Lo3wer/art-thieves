import { useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, Modal, ScrollView,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { api } from '../services/api';
import { useGameStore } from '../stores/useGameStore';
import { useTeamStore } from '../stores/useTeamStore';
import { Icon, ICONS } from './icons';
import type { Landmark } from '../types';

interface DebugMenuProps {
  visible: boolean;
  onClose: () => void;
}

export default function DebugMenu({ visible, onClose }: DebugMenuProps) {
  const game = useGameStore((s) => s.game);
  const setGame = useGameStore((s) => s.setGame);
  const myTeamId = useTeamStore((s) => s.myTeamId);
  const [selected, setSelected] = useState<Landmark | null>(null);
  const [busy, setBusy] = useState(false);

  if (!game) return null;

  const stateFor = (landmarkId: string) =>
    game.landmarkStates.find((s) => s.landmarkId === landmarkId);

  const refreshGame = async () => {
    const fresh = await api.getGame(game.id);
    setGame(fresh as any);
  };

  const run = async (op: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await op();
      await refreshGame();
    } catch (e: any) {
      Alert.alert('Debug action failed', e.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const setHolder = (landmark: Landmark, holderTeamId: string | null, locked: boolean) =>
    run(() =>
      api.debugLandmarkState(game.id, {
        teamId: myTeamId ?? '',
        landmarkId: landmark.id,
        holderTeamId,
        locked,
      })
    );

  const setLocked = (landmark: Landmark, locked: boolean) => {
    const holder = stateFor(landmark.id)?.teamId ?? null;
    if (locked && !holder) {
      Alert.alert('Cannot lock', 'Set a holder first — locked landmarks must belong to a team.');
      return;
    }
    return setHolder(landmark, holder, locked);
  };

  const attemptAction = (landmark: Landmark, targetTeamId: string, action: 'clear-attempt' | 'set-pending') =>
    run(() => api.debugChallengeAttempt(game.id, { teamId: myTeamId ?? '', landmarkId: landmark.id, targetTeamId, action }));

  const selectedState = selected ? stateFor(selected.id) : undefined;
  const selectedChallenge = selectedState?.challenge;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Icon spec={ICONS.clipboard} size={20} />
              <Text style={styles.title}>Host Debug</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Icon spec={ICONS.close} size={22} />
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>Landmark</Text>
          <View style={styles.listWrap}>
            <FlatList
              data={game.landmarks}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const st = stateFor(item.id);
                const holder = st?.teamId ? game.teams.find((t) => t.id === st.teamId) : null;
                const isSelected = selected?.id === item.id;
                return (
                  <TouchableOpacity
                    style={[styles.lmRow, isSelected && styles.lmRowSelected]}
                    onPress={() => setSelected(item)}
                  >
                    <Text style={styles.lmName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.lmStatus} numberOfLines={1}>
                      {st?.status === 'locked'
                        ? `Locked — ${holder?.name ?? '?'}`
                        : st?.status === 'claimed'
                        ? `Claimed — ${holder?.name ?? '?'}`
                        : 'Unclaimed'}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>

          {selected && (
            <ScrollView style={styles.panel} contentContainerStyle={{ gap: 10 }}>
              <Text style={styles.panelTitle}>{selected.name}</Text>

              <Text style={styles.sectionLabel}>Set claim holder</Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, !selectedState?.teamId && styles.chipActive]}
                  disabled={busy}
                  onPress={() => setHolder(selected, null, false)}
                >
                  <Text style={[styles.chipText, !selectedState?.teamId && styles.chipTextActive]}>None</Text>
                </TouchableOpacity>
                {game.teams.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[
                      styles.chip,
                      selectedState?.teamId === t.id && { borderColor: t.color, backgroundColor: t.color + '20' },
                    ]}
                    disabled={busy}
                    onPress={() => setHolder(selected, t.id, false)}
                  >
                    <Text style={styles.chipText}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, styles.lockChip]}
                  disabled={busy}
                  onPress={() => setLocked(selected, true)}
                >
                  <Text style={styles.chipText}>Lock</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, styles.unlockChip]}
                  disabled={busy}
                  onPress={() => setLocked(selected, false)}
                >
                  <Text style={styles.chipText}>Unlock</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.sectionLabel}>
                Challenge attempts (current: {selectedChallenge?.status ?? 'none'})
              </Text>
              {game.teams.map((t) => (
                <View key={t.id} style={styles.attemptRow}>
                  <View style={[styles.teamDot, { backgroundColor: t.color }]} />
                  <Text style={styles.attemptTeam}>{t.name}</Text>
                  <TouchableOpacity
                    style={[styles.chip, styles.smallChip]}
                    disabled={busy}
                    onPress={() => attemptAction(selected, t.id, 'clear-attempt')}
                  >
                    <Text style={styles.chipText}>Clear</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.chip, styles.smallChip]}
                    disabled={busy}
                    onPress={() => attemptAction(selected, t.id, 'set-pending')}
                  >
                    <Text style={styles.chipText}>Re-open</Text>
                  </TouchableOpacity>
                </View>
              ))}

              {busy && <ActivityIndicator style={{ marginTop: 8 }} />}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  content: { backgroundColor: '#fff', borderRadius: 14, padding: 16, maxHeight: '85%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1a1a2e' },
  closeBtn: { padding: 4 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#888', letterSpacing: 0.5, marginTop: 4 },
  listWrap: { maxHeight: 180, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10, marginTop: 4 },
  lmRow: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  lmRowSelected: { backgroundColor: '#1a1a2e10' },
  lmName: { fontSize: 14, fontWeight: '600', color: '#1a1a2e' },
  lmStatus: { fontSize: 12, color: '#888', marginTop: 2 },
  panel: { marginTop: 8 },
  panelTitle: { fontSize: 16, fontWeight: 'bold', color: '#1a1a2e' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: '#c8c8c8', backgroundColor: '#fff',
  },
  chipActive: { backgroundColor: '#1a1a2e', borderColor: '#1a1a2e' },
  chipText: { fontSize: 13, color: '#1a1a2e', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  lockChip: { borderColor: '#2c3e50' },
  unlockChip: { borderColor: '#f39c12' },
  smallChip: { paddingVertical: 4, paddingHorizontal: 10 },
  attemptRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamDot: { width: 10, height: 10, borderRadius: 5 },
  attemptTeam: { flex: 1, fontSize: 14, color: '#1a1a2e' },
});
