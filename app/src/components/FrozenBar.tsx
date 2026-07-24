import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useTeamStore } from '../stores/useTeamStore';
import { useGameStore } from '../stores/useGameStore';
import { api } from '../services/api';

export default function FrozenBar() {
  const isFrozen = useTeamStore((s) => s.isFrozen);
  const freezeEndsAt = useTeamStore((s) => s.freezeEndsAt);
  const disputeAvailableUntil = useTeamStore((s) => s.disputeAvailableUntil);
  const setFrozen = useTeamStore((s) => s.setFrozen);
  const setDisputeWindow = useTeamStore((s) => s.setDisputeWindow);
  const game = useGameStore((s) => s.game);

  const [loading, setLoading] = useState(false);
  const [freezeCountdown, setFreezeCountdown] = useState<number | null>(null);
  const [disputeCountdown, setDisputeCountdown] = useState<number | null>(null);
  const [showDisputeModal, setShowDisputeModal] = useState(false);

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

  const handleDispute = async () => {
    if (!game) return;
    setLoading(true);
    setShowDisputeModal(false);
    try {
      await api.disputeTag(game.id);
      setFrozen(false, null);
      setDisputeWindow(null);
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

  if (!isFrozen) return null;

  return (
    <>
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
            <TouchableOpacity
              style={styles.disputeButton}
              onPress={() => setShowDisputeModal(true)}
              disabled={loading}
            >
              <Text style={styles.disputeButtonText}>Dispute</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {showDisputeModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalIcon}>🔄</Text>
            <Text style={styles.modalTitle}>Dispute Tag?</Text>
            <Text style={styles.modalDesc}>
              Claim that you were not tagged fairly. The tag will be voided.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setShowDisputeModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmButton}
                onPress={handleDispute}
                disabled={loading}
              >
                <Text style={styles.modalConfirmText}>{loading ? '...' : 'Dispute'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
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
  modalOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center',
    zIndex: 100,
  },
  modalContent: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24, marginHorizontal: 32,
    alignItems: 'center', elevation: 10,
  },
  modalIcon: { fontSize: 40, marginBottom: 12 },
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
