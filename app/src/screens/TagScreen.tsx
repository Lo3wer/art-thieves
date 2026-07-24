import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, Alert,
} from 'react-native';
import { api } from '../services/api';
import { useGameStore } from '../stores/useGameStore';
import { useTeamStore } from '../stores/useTeamStore';
import { scheduleLocalNotification } from '../services/notifications';

const FREEZE_DURATION = 600;

export default function TagScreen() {
  const game = useGameStore((s) => s.game);
  const myTeamId = useTeamStore((s) => s.myTeamId);
  const isFrozen = useTeamStore((s) => s.isFrozen);
  const freezeEndsAt = useTeamStore((s) => s.freezeEndsAt);
  const disputeAvailableUntil = useTeamStore((s) => s.disputeAvailableUntil);
  const frozenTeams = useTeamStore((s) => s.frozenTeams);
  const tagCooldowns = useTeamStore((s) => s.tagCooldowns);
  const setFrozen = useTeamStore((s) => s.setFrozen);
  const setDisputeWindow = useTeamStore((s) => s.setDisputeWindow);
  const setTagCooldown = useTeamStore((s) => s.setTagCooldown);
  const setFrozenTeams = useTeamStore((s) => s.setFrozenTeams);

  const [noTagTimeLeft, setNoTagTimeLeft] = useState<number | null>(null);
  const [freezeCountdown, setFreezeCountdown] = useState<number | null>(null);
  const [disputeCountdown, setDisputeCountdown] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const otherTeams = game
    ? game.teams.filter((t) => t.id !== myTeamId)
    : [];

  useEffect(() => {
    if (!game || !myTeamId) return;
    api.getFrozenTeams(game.id).then((list: { teamId: string; frozenUntil: string }[]) => {
      const map: Record<string, string> = {};
      for (const item of list) {
        map[item.teamId] = item.frozenUntil;
        if (item.teamId === myTeamId) {
          setFrozen(true, item.frozenUntil);
          const gameConfig = useGameStore.getState().game?.config;
          if (gameConfig) {
            const disputeEnd = new Date(
              new Date(item.frozenUntil).getTime() - FREEZE_DURATION * 1000 + (gameConfig.disputeWindow ?? 60) * 1000
            ).toISOString();
            setDisputeWindow(disputeEnd);
          }
        }
      }
      setFrozenTeams(map);
    }).catch(() => {});
  }, [game?.id, myTeamId, setFrozenTeams, setFrozen, setDisputeWindow]);

  useEffect(() => {
    if (!game || !game.startedAt) return;
    const started = new Date(game.startedAt).getTime();
    const noTagEnd = started + (game.config.noTagPeriod ?? 600) * 1000;

    const tick = () => {
      const now = Date.now();
      if (now < noTagEnd) {
        setNoTagTimeLeft(Math.floor((noTagEnd - now) / 1000));
      } else {
        setNoTagTimeLeft(null);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [game?.id, game?.startedAt, game?.config.noTagPeriod]);

  useEffect(() => {
    if (!freezeEndsAt) { setFreezeCountdown(null); return; }
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(freezeEndsAt).getTime() - Date.now()) / 1000));
      setFreezeCountdown(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [freezeEndsAt]);

  useEffect(() => {
    if (!disputeAvailableUntil) { setDisputeCountdown(null); return; }
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(disputeAvailableUntil).getTime() - Date.now()) / 1000));
      setDisputeCountdown(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [disputeAvailableUntil]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const s = useTeamStore.getState();
      for (const [tid, until] of Object.entries(s.frozenTeams)) {
        if (new Date(until).getTime() <= now) {
          s.removeFrozenTeam(tid);
        }
      }
      for (const [tid, until] of Object.entries(s.tagCooldowns)) {
        if (new Date(until).getTime() <= now) {
          s.removeTagCooldown(tid);
        }
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleTag = async (targetTeamId: string) => {
    if (!game) return;
    setLoading(true);
    try {
      await api.tagTeam(game.id, targetTeamId);
      const target = game.teams.find((t) => t.id === targetTeamId);
      const freezeMins = Math.round(FREEZE_DURATION / 60);
      scheduleLocalNotification(
        'Tag Sent!',
        `${target?.name ?? 'Team'} has been tagged and frozen for ${freezeMins} minutes`
      );
      const cooldownSeconds = game.config.reTagCooldown ?? 300;
      setTagCooldown(targetTeamId, new Date(Date.now() + cooldownSeconds * 1000).toISOString());
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to tag team');
    } finally {
      setLoading(false);
    }
  };

  const handleDispute = async () => {
    if (!game) return;
    setLoading(true);
    try {
      await api.disputeTag(game.id);
      setFrozen(false, null);
      setDisputeWindow(null);
      scheduleLocalNotification('Tag Disputed!', 'The tag has been voided successfully');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to dispute tag');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const getTeamStatus = (teamId: string) => {
    const frozenUntil = frozenTeams[teamId];
    if (frozenUntil) {
      const remaining = Math.floor((new Date(frozenUntil).getTime() - Date.now()) / 1000);
      if (remaining > 0) return { disabled: true, label: `Frozen ${formatTime(remaining)}` };
    }
    const cdUntil = tagCooldowns[teamId];
    if (cdUntil) {
      const remaining = Math.floor((new Date(cdUntil).getTime() - Date.now()) / 1000);
      if (remaining > 0) return { disabled: true, label: `Cooldown ${formatTime(remaining)}` };
    }
    return { disabled: false, label: '' };
  };

  return (
    <View style={styles.container}>
      {isFrozen && (
        <View style={styles.frozenBar}>
          <View style={styles.frozenBarContent}>
            <Text style={styles.frozenBarIcon}>🧊</Text>
            <View style={styles.frozenBarInfo}>
              <Text style={styles.frozenBarTitle}>YOU ARE FROZEN</Text>
              {freezeCountdown != null && (
                <Text style={styles.frozenBarTimer}>{formatTime(freezeCountdown)} remaining</Text>
              )}
            </View>
            {disputeCountdown != null && disputeCountdown > 0 && (
              <TouchableOpacity style={styles.disputeButton} onPress={handleDispute} disabled={loading}>
                <Text style={styles.disputeButtonText}>Dispute</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

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
                  onPress={() => handleTag(item.id)}
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
  frozenBar: {
    backgroundColor: '#e8f4fd', borderRadius: 10, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: '#b3d9f2',
  },
  frozenBarContent: { flexDirection: 'row', alignItems: 'center' },
  frozenBarIcon: { fontSize: 24, marginRight: 10 },
  frozenBarInfo: { flex: 1 },
  frozenBarTitle: { fontSize: 14, fontWeight: 'bold', color: '#3498db' },
  frozenBarTimer: { fontSize: 13, color: '#555', marginTop: 2 },
  disputeButton: {
    backgroundColor: '#e74c3c', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8,
  },
  disputeButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  noTagCard: {
    backgroundColor: '#fff', padding: 24, borderRadius: 12, alignItems: 'center', marginTop: 40,
  },
  noTagTitle: { fontSize: 18, fontWeight: 'bold', color: '#1a1a2e', marginBottom: 8 },
  noTagTimer: { fontSize: 40, fontWeight: 'bold', color: '#f39c12', fontVariant: ['tabular-nums'], marginBottom: 8 },
  noTagDesc: { fontSize: 14, color: '#888', textAlign: 'center' },
});
