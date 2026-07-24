import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, Modal,
  StyleSheet, Alert,
} from 'react-native';
import { api } from '../services/api';
import { useGameStore } from '../stores/useGameStore';
import { useTeamStore } from '../stores/useTeamStore';
import { scheduleLocalNotification } from '../services/notifications';

const NO_TAG_DURATION = 600;
const FREEZE_DURATION = 600;
const DISPUTE_WINDOW = 60;

export default function TagScreen() {
  const game = useGameStore((s) => s.game);
  const myTeamId = useTeamStore((s) => s.myTeamId);
  const isFrozen = useTeamStore((s) => s.isFrozen);
  const freezeEndsAt = useTeamStore((s) => s.freezeEndsAt);
  const disputeAvailableUntil = useTeamStore((s) => s.disputeAvailableUntil);
  const setFrozen = useTeamStore((s) => s.setFrozen);
  const setDisputeWindow = useTeamStore((s) => s.setDisputeWindow);

  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [noTagTimeLeft, setNoTagTimeLeft] = useState<number | null>(null);
  const [freezeCountdown, setFreezeCountdown] = useState<number | null>(null);
  const [disputeCountdown, setDisputeCountdown] = useState<number | null>(null);
  const [cooldownEnd, setCooldownEnd] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const otherTeams = game
    ? game.teams.filter((t) => t.id !== myTeamId)
    : [];

  useEffect(() => {
    if (!game || !game.startedAt) return;
    const started = new Date(game.startedAt).getTime();
    const noTagEnd = started + NO_TAG_DURATION * 1000;

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
  }, [game?.id, game?.startedAt]);

  useEffect(() => {
    if (!game || !myTeamId) return;
    const interval = setInterval(async () => {
      try {
        const tag = await api.getActiveTag(game.id, myTeamId);
        if (tag) {
          const tagTime = new Date((tag as any).timestamp).getTime();
          const freezeEnd = tagTime + FREEZE_DURATION * 1000;
          const disputeEnd = tagTime + DISPUTE_WINDOW * 1000;
          const now = Date.now();

          if (now < disputeEnd && !(tag as any).voided) {
            setDisputeWindow(new Date(disputeEnd).toISOString());
          } else if (now < freezeEnd && !(tag as any).voided) {
            setFrozen(true, new Date(freezeEnd).toISOString());
            setDisputeWindow(null);
          } else {
            setFrozen(false, null);
            setDisputeWindow(null);
          }
        } else {
          setFrozen(false, null);
          setDisputeWindow(null);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [game?.id, myTeamId, setFrozen, setDisputeWindow]);

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

  const handleTag = async (targetTeamId: string) => {
    if (!game) return;
    setLoading(true);
    try {
      await api.tagTeam(game.id, targetTeamId);
      const target = game.teams.find((t) => t.id === targetTeamId);
      scheduleLocalNotification(
        'Tag Sent!',
        `${target?.name ?? 'Team'} has been tagged and frozen for 10 minutes`
      );
      setCooldownEnd(new Date(Date.now() + 300 * 1000).toISOString());
      setShowTeamPicker(false);
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

  if (isFrozen) {
    return (
      <View style={styles.container}>
        <View style={styles.frozenOverlay}>
          <Text style={styles.frozenIcon}>🧊</Text>
          <Text style={styles.frozenTitle}>YOU ARE FROZEN</Text>
          {freezeCountdown != null && (
            <Text style={styles.frozenTimer}>{formatTime(freezeCountdown)}</Text>
          )}
          <Text style={styles.frozenDesc}>You cannot tag or claim landmarks while frozen</Text>
          {disputeCountdown != null && disputeCountdown > 0 && (
            <View style={styles.disputeSection}>
              <Text style={styles.disputeHint}>
                Dispute available for {formatTime(disputeCountdown)}
              </Text>
              <TouchableOpacity style={styles.disputeButton} onPress={handleDispute} disabled={loading}>
                <Text style={styles.disputeButtonText}>{loading ? '...' : 'Dispute Tag'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.teamCard}
                onPress={() => handleTag(item.id)}
                disabled={loading}
              >
                <View style={[styles.teamDot, { backgroundColor: item.color }]} />
                <Text style={styles.teamName}>{item.name}</Text>
              </TouchableOpacity>
            )}
            style={styles.list}
          />
        </>
      )}

      {cooldownEnd && (
        <Text style={styles.cooldownText}>
          Re-tag cooldown active for {Math.max(0, Math.floor((new Date(cooldownEnd).getTime() - Date.now()) / 1000))}s
        </Text>
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
  teamDot: { width: 16, height: 16, borderRadius: 8, marginRight: 14 },
  teamName: { fontSize: 16, fontWeight: '600', color: '#1a1a2e' },
  frozenOverlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  frozenIcon: { fontSize: 64, marginBottom: 16 },
  frozenTitle: { fontSize: 24, fontWeight: 'bold', color: '#3498db', marginBottom: 8 },
  frozenTimer: { fontSize: 36, fontWeight: 'bold', color: '#1a1a2e', fontVariant: ['tabular-nums'], marginBottom: 8 },
  frozenDesc: { fontSize: 15, color: '#888', textAlign: 'center', marginBottom: 24 },
  disputeSection: { alignItems: 'center', marginTop: 16 },
  disputeHint: { fontSize: 14, color: '#e74c3c', marginBottom: 12 },
  disputeButton: {
    backgroundColor: '#e74c3c', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 10,
  },
  disputeButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  noTagCard: {
    backgroundColor: '#fff', padding: 24, borderRadius: 12, alignItems: 'center', marginTop: 40,
  },
  noTagTitle: { fontSize: 18, fontWeight: 'bold', color: '#1a1a2e', marginBottom: 8 },
  noTagTimer: { fontSize: 40, fontWeight: 'bold', color: '#f39c12', fontVariant: ['tabular-nums'], marginBottom: 8 },
  noTagDesc: { fontSize: 14, color: '#888', textAlign: 'center' },
  cooldownText: { fontSize: 13, color: '#888', textAlign: 'center', marginTop: 16 },
});
