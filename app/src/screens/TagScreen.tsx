import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, Alert, Modal,
} from 'react-native';
import { api } from '../services/api';
import { useGameStore } from '../stores/useGameStore';
import { useTeamStore } from '../stores/useTeamStore';
import { getActiveElapsedMs } from '../utils/gameTime';
import { useFrozenTeams } from '../hooks/useFrozenTeams';
import { scheduleLocalNotification } from '../services/notifications';
import FrozenBar from '../components/FrozenBar';
import { Icon, ICONS } from '../components/icons';

export default function TagScreen() {
  const game = useGameStore((s) => s.game);
  const myTeamId = useTeamStore((s) => s.myTeamId);
  const frozenTeams = useTeamStore((s) => s.frozenTeams);
  const tagCooldowns = useTeamStore((s) => s.tagCooldowns);
  const setTagCooldown = useTeamStore((s) => s.setTagCooldown);
  const { now } = useFrozenTeams();

  const [noTagTimeLeft, setNoTagTimeLeft] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);

  const otherTeams = game
    ? game.teams.filter((t) => t.id !== myTeamId)
    : [];

  useEffect(() => {
    if (!game || !game.startedAt) return;

    const tick = () => {
      const g = useGameStore.getState().game;
      if (!g || !g.startedAt) {
        setNoTagTimeLeft(null);
        return;
      }
      const activeElapsed = getActiveElapsedMs(
        g.startedAt,
        g.totalPausedMs,
        g.pausedAt,
        g.status
      );
      const remainingMs = (g.config.noTagPeriod ?? 600) * 1000 - activeElapsed;
      if (remainingMs > 0) {
        setNoTagTimeLeft(Math.ceil(remainingMs / 1000));
      } else {
        setNoTagTimeLeft(null);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [game?.id, game?.startedAt, game?.config.noTagPeriod]);

  const confirmTag = async () => {
    if (!game || !pendingTarget) return;
    setShowTagModal(false);
    setLoading(true);
    try {
      await api.tagTeam(game.id, pendingTarget);
      const target = game.teams.find((t) => t.id === pendingTarget);
      scheduleLocalNotification(
        'Tag Sent!',
        `${target?.name ?? 'Team'} has been tagged and frozen for 10 minutes`
      );
      const cooldownSeconds = game.config.reTagCooldown ?? 300;
      setTagCooldown(pendingTarget, new Date(Date.now() + cooldownSeconds * 1000).toISOString());
      setPendingTarget(null);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to tag team');
    } finally {
      setLoading(false);
    }
  };

  const handleTagPress = (teamId: string) => {
    setPendingTarget(teamId);
    setShowTagModal(true);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const getTeamStatus = (teamId: string) => {
    const frozenUntil = frozenTeams[teamId];
    if (frozenUntil) {
      const remaining = Math.floor((new Date(frozenUntil).getTime() - now) / 1000);
      if (remaining > 0) return { disabled: true, label: `Frozen ${formatTime(remaining)}` };
    }
    const cdUntil = tagCooldowns[teamId];
    if (cdUntil) {
      const remaining = Math.floor((new Date(cdUntil).getTime() - now) / 1000);
      if (remaining > 0) return { disabled: true, label: `Cooldown ${formatTime(remaining)}` };
    }
    return { disabled: false, label: '' };
  };

  const pendingTargetName = pendingTarget
    ? game?.teams.find((t) => t.id === pendingTarget)?.name ?? 'this team'
    : '';

  return (
    <View style={styles.container}>
      <FrozenBar />

      <Text style={styles.title}>Tag</Text>

      {noTagTimeLeft != null && noTagTimeLeft > 0 ? (
        <View style={styles.noTagCard}>
          <Text style={styles.noTagTitle}>No-Tag Period</Text>
          <Text style={styles.noTagTimer}>{formatTime(noTagTimeLeft)}</Text>
          <Text style={styles.noTagDesc}>Tagging becomes available when the timer expires</Text>
        </View>
      ) : (
        <>
          <Text style={styles.sectionTitle}>Select a team to tag and freeze</Text>
          <FlatList
            data={otherTeams}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const { disabled, label } = getTeamStatus(item.id);
              return (
                <TouchableOpacity
                  style={[styles.teamCard, disabled && styles.teamCardDisabled]}
                  onPress={() => handleTagPress(item.id)}
                  disabled={disabled || loading}
                >
                  <View style={[styles.teamDot, { backgroundColor: item.color }]} />
                  <Text style={[styles.teamName, disabled && styles.teamNameDisabled]}>
                    {item.name}
                  </Text>
                  {label !== '' && <Text style={styles.teamBadge}>{label}</Text>}
                </TouchableOpacity>
              );
            }}
            style={styles.list}
          />
        </>
      )}

      {/* Tag confirmation modal */}
      <Modal visible={showTagModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalIcon}>
              <Icon spec={ICONS.label} size={48} />
            </View>
            <Text style={styles.modalTitle}>Tag {pendingTargetName}?</Text>
            <Text style={styles.modalDesc}>
              This will freeze {pendingTargetName} for 10 minutes and mark them as tagged.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => { setShowTagModal(false); setPendingTarget(null); }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmButton}
                onPress={confirmTag}
                disabled={loading}
              >
                <Text style={styles.modalConfirmText}>{loading ? '...' : 'Tag!'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1a1a2e', marginBottom: 16 },
  sectionTitle: { fontSize: 16, color: '#666', marginBottom: 12 },
  list: { flex: 1 },
  teamCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    padding: 16, borderRadius: 10, marginBottom: 8, elevation: 1,
  },
  teamCardDisabled: { opacity: 0.55 },
  teamDot: { width: 16, height: 16, borderRadius: 8, marginRight: 14 },
  teamName: { fontSize: 16, fontWeight: '600', color: '#1a1a2e', flex: 1 },
  teamNameDisabled: { color: '#999' },
  teamBadge: { fontSize: 12, fontWeight: '600', color: '#e74c3c', marginLeft: 8 },
  noTagCard: {
    backgroundColor: '#fff', padding: 24, borderRadius: 12, alignItems: 'center', marginTop: 40,
  },
  noTagTitle: { fontSize: 18, fontWeight: 'bold', color: '#1a1a2e', marginBottom: 8 },
  noTagTimer: { fontSize: 40, fontWeight: 'bold', color: '#f39c12', fontVariant: ['tabular-nums'], marginBottom: 8 },
  noTagDesc: { fontSize: 14, color: '#888', textAlign: 'center' },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24, marginHorizontal: 32,
    alignItems: 'center', elevation: 10,
  },
  modalIcon: { marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1a1a2e', marginBottom: 8 },
  modalDesc: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  modalButtons: { flexDirection: 'row', gap: 12 },
  modalCancelButton: {
    paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10,
    backgroundColor: '#eee',
  },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: '#666' },
  modalConfirmButton: {
    paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10,
    backgroundColor: '#e74c3c',
  },
  modalConfirmText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
