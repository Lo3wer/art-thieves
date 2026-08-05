import { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Image, ActivityIndicator, FlatList,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { api } from '../services/api';
import { useGameStore } from '../stores/useGameStore';
import { useLocationStore } from '../stores/useLocationStore';
import { useTeamStore } from '../stores/useTeamStore';
import { isWithinVicinity } from '../utils/distance';
import { scheduleLocalNotification } from '../services/notifications';
import type { Landmark, LandmarkState } from '../types';
import FrozenBar from '../components/FrozenBar';

type ClaimPhase = 'idle' | 'camera' | 'preview' | 'result' | 'challenge';

export default function ClaimScreen() {
  const game = useGameStore((s) => s.game);
  const updateLandmarkState = useGameStore((s) => s.updateLandmarkState);
  const ownLocation = useLocationStore((s) => s.ownLocation);
  const myTeamId = useTeamStore((s) => s.myTeamId);
  const myTeamColor = useTeamStore((s) => s.myTeamColor);
  const isFrozen = useTeamStore((s) => s.isFrozen);

  const [activeTab, setActiveTab] = useState<'nearby' | 'owned'>('nearby');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [phase, setPhase] = useState<ClaimPhase>('idle');
  const [loading, setLoading] = useState(false);
  const [showStealModal, setShowStealModal] = useState(false);
  const [challengeAttempted, setChallengeAttempted] = useState(false);
  const [resultMessage, setResultMessage] = useState('');

  const nearbyLandmark = useCallback((): Landmark | null => {
    if (!game || !ownLocation) return null;
    return (
      game.landmarks.find((lm) =>
        isWithinVicinity(
          ownLocation.latitude,
          ownLocation.longitude,
          lm.latitude,
          lm.longitude,
          game.config.vicinityRadius
        )
      ) ?? null
    );
  }, [game, ownLocation]);

  const landmarkState = useCallback(
    (lm: Landmark): LandmarkState => {
      if (!game) return { landmarkId: lm.id, status: 'unclaimed' };
      return (
        game.landmarkStates.find((s) => s.landmarkId === lm.id) ?? {
          landmarkId: lm.id,
          status: 'unclaimed',
        }
      );
    },
    [game]
  );

  const myOwnedLandmarks = useMemo(() => {
    if (!game || !myTeamId) return [];
    const states = game.landmarkStates.filter((s) => s.teamId === myTeamId);
    const stateMap = new Map(states.map((s) => [s.landmarkId, s]));
    return game.landmarks
      .filter((lm) => {
        const s = stateMap.get(lm.id);
        return s && (s.status === 'claimed' || s.status === 'locked');
      })
      .map((lm) => ({
        id: lm.id,
        name: lm.name,
        challengeText: lm.challengeText,
        status: stateMap.get(lm.id)!.status,
      }));
  }, [game, myTeamId]);

  const handleTakePhoto = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    setPhase('camera');
  };

  const handleSnap = async () => {
    if (!cameraRef.current) return;
    const snap = await cameraRef.current.takePictureAsync({ quality: 0.7 });
    if (snap?.uri) {
      setPhoto(snap.uri);
      setPhase('preview');
    }
  };

  const handleConfirmClaim = async () => {
    const lm = nearbyLandmark();
    if (!lm || !game) return;

    const state = landmarkState(lm);
    if (state.status === 'locked') {
      Alert.alert('Locked', 'This landmark is locked and cannot be claimed');
      setPhase('idle');
      return;
    }

    const isSteal = state.status === 'claimed' && state.teamId !== myTeamId;
    if (isSteal && !showStealModal) {
      const owner = game.teams.find((t) => t.id === state.teamId);
      setShowStealModal(true);
      return;
    }

    setLoading(true);
    try {
      await api.claimLandmark(game.id, lm.id, ownLocation!.latitude, ownLocation!.longitude);
      updateLandmarkState({
        landmarkId: lm.id,
        status: 'claimed',
        teamId: myTeamId ?? undefined,
      });
      setShowStealModal(false);

      if (isSteal) {
        const owner = game.teams.find((t) => t.id === state.teamId);
        scheduleLocalNotification(
          'Landmark Stolen!',
          `You stole ${lm.name} from ${owner?.name ?? 'Unknown'}!`
        );
        setResultMessage(`Stole ${lm.name} from ${owner?.name ?? 'Unknown'}!`);
      } else {
        scheduleLocalNotification(
          'Landmark Claimed!',
          `You claimed ${lm.name}!`
        );
        setResultMessage(`Claimed ${lm.name}!`);
      }

      if (lm.challengeText) {
        setPhase('challenge');
      } else {
        setPhase('result');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to claim landmark');
      setPhase('idle');
    } finally {
      setLoading(false);
    }
  };

  const handleChallenge = async (outcome: 'complete' | 'fail' | 'veto') => {
    const lm = nearbyLandmark();
    if (!lm || !game) return;
    setLoading(true);
    try {
      if (outcome === 'complete') {
        await api.completeChallenge(game.id, lm.id);
        updateLandmarkState({
          landmarkId: lm.id,
          status: 'locked',
          teamId: myTeamId ?? undefined,
        });
        scheduleLocalNotification('Challenge Complete!', `${lm.name} is now locked!`);
        setResultMessage(`${lm.name} is now locked!`);
      } else if (outcome === 'fail') {
        await api.failChallenge(game.id, lm.id);
        setResultMessage(`Challenge failed for ${lm.name}`);
      } else {
        await api.vetoChallenge(game.id, lm.id);
        setResultMessage(`Challenge vetoed for ${lm.name}`);
      }
      setChallengeAttempted(true);
      setPhase('result');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Challenge failed');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setPhoto(null);
    setPhase('idle');
    setShowStealModal(false);
    setChallengeAttempted(false);
  };

  const lm = nearbyLandmark();
  const state = lm ? landmarkState(lm) : null;
  const isSteal = state?.status === 'claimed' && state?.teamId !== myTeamId;
  const owner = isSteal && lm && game
    ? game.teams.find((t) => t.id === state?.teamId)
    : null;

  if (phase === 'camera') {
    return (
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing="front" />
        <View style={styles.cameraOverlay} pointerEvents="box-none">
          <Text style={styles.cameraHint}>Take a selfie with the landmark</Text>
          <TouchableOpacity style={styles.snapButton} onPress={handleSnap}>
            <View style={styles.snapInner} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={reset}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (phase === 'preview') {
    return (
      <View style={styles.centered}>
        <Text style={styles.sectionTitle}>Preview Selfie</Text>
        {photo && <Image source={{ uri: photo }} style={styles.previewImage} />}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setPhase('camera')}>
            <Text style={styles.secondaryButtonText}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={handleConfirmClaim} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? '...' : 'Confirm'}</Text>
          </TouchableOpacity>
        </View>
        {isSteal && (
          <Text style={styles.stealWarning}>This landmark belongs to {owner?.name ?? 'another team'}</Text>
        )}
      </View>
    );
  }

  if (showStealModal) {
    return (
      <View style={styles.stealContainer}>
        <Text style={styles.stealIcon}>⚔️</Text>
        <Text style={styles.stealTitle}>Steal Landmark?</Text>
        <Text style={styles.stealDesc}>
          This landmark is owned by {owner?.name}. Stealing it will transfer ownership to your team.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={handleConfirmClaim} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? '...' : 'Steal It!'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={reset}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'challenge' && lm) {
    return (
      <View style={styles.centered}>
        <Text style={styles.sectionTitle}>Challenge</Text>
        <Text style={styles.challengePrompt}>{lm.challengeText}</Text>
        {challengeAttempted ? (
          <Text style={styles.attemptedText}>Challenge already attempted for this landmark</Text>
        ) : (
          <View style={styles.challengeButtons}>
            <TouchableOpacity
              style={[styles.challengeBtn, { backgroundColor: '#2ecc71' }]}
              onPress={() => handleChallenge('complete')}
              disabled={loading}
            >
              <Text style={styles.buttonText}>Complete</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.challengeBtn, { backgroundColor: '#e74c3c' }]}
              onPress={() => handleChallenge('fail')}
              disabled={loading}
            >
              <Text style={styles.buttonText}>Fail</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.challengeBtn, { backgroundColor: '#f39c12' }]}
              onPress={() => handleChallenge('veto')}
              disabled={loading}
            >
              <Text style={styles.buttonText}>Veto</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  if (phase === 'result') {
    return (
      <View style={styles.centered}>
        <Text style={styles.resultIcon}>✅</Text>
        <Text style={styles.sectionTitle}>Success!</Text>
        <Text style={styles.resultSub}>{resultMessage}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={reset}>
          <Text style={styles.buttonText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FrozenBar />

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'nearby' && styles.tabButtonActive]}
          onPress={() => setActiveTab('nearby')}
        >
          <Text style={[styles.tabButtonText, activeTab === 'nearby' && styles.tabButtonTextActive]}>
            Nearby
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'owned' && styles.tabButtonActive]}
          onPress={() => setActiveTab('owned')}
        >
          <Text style={[styles.tabButtonText, activeTab === 'owned' && styles.tabButtonTextActive]}>
            My Landmarks ({myOwnedLandmarks.length})
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'owned' ? (
        <View style={styles.container}>
          {myOwnedLandmarks.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.inactiveIcon}>🏆</Text>
              <Text style={styles.inactiveTitle}>No Claimed Landmarks Yet</Text>
              <Text style={styles.inactiveSub}>Claim landmarks here to see them in your collection.</Text>
            </View>
          ) : (
            <FlatList
              data={myOwnedLandmarks}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const isLocked = item.status === 'locked';
                return (
                  <View style={[styles.ownedRow, isLocked && styles.ownedRowLocked]}>
                    <View
                      style={[styles.ownedStatusBar, { backgroundColor: isLocked ? '#888' : myTeamColor ?? '#3498db' }]}
                    />
                    <View style={styles.ownedInfo}>
                      <Text style={styles.ownedName}>{item.name}</Text>
                      <Text style={[styles.ownedStatus, isLocked && styles.ownedStatusLocked]}>
                        {isLocked ? '🔒 Locked' : 'Claimed'}
                      </Text>
                      {!isLocked && item.challengeText && (
                        <Text style={styles.ownedHint}>Complete the challenge to lock this landmark</Text>
                      )}
                      {isLocked && (
                        <Text style={styles.ownedHint}>Locked and safe from being stolen</Text>
                      )}
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      ) : game?.status === 'paused' ? (
        <View style={styles.centered}>
          <Text style={styles.inactiveIcon}>⏸️</Text>
          <Text style={styles.inactiveTitle}>Game Paused</Text>
          <Text style={styles.inactiveSub}>Claiming is disabled while the game is paused.</Text>
        </View>
      ) : !lm ? (
        <View style={styles.centered}>
          <Text style={styles.inactiveIcon}>📌</Text>
          <Text style={styles.inactiveTitle}>Move Closer</Text>
          <Text style={styles.inactiveSub}>Walk near a landmark on the map to claim it</Text>
        </View>
      ) : state?.status === 'locked' ? (
        <View style={styles.centered}>
          <Text style={styles.inactiveIcon}>🔒</Text>
          <Text style={styles.inactiveTitle}>{lm.name}</Text>
          <Text style={styles.inactiveSub}>This landmark is already locked and cannot be claimed.</Text>
        </View>
      ) : (
        <View style={styles.centered}>
          <Text style={styles.sectionTitle}>{lm.name}</Text>
          {state && (
            <Text style={styles.statusText}>
              {state.status === 'unclaimed'
                ? 'Unclaimed'
                : `Owned by ${owner?.name ?? 'Unknown'}`}
            </Text>
          )}
          {lm.challengeText && (
            <Text style={styles.challengePreview}>Challenge available after claiming</Text>
          )}
          <TouchableOpacity
            style={[styles.primaryButton, isFrozen && styles.buttonDisabled]}
            onPress={handleTakePhoto}
            disabled={isFrozen}
          >
            <Text style={styles.buttonText}>
              {isFrozen ? 'Frozen - Cannot Claim' : isSteal ? 'Take Selfie to Steal' : 'Take Selfie to Claim'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5', padding: 24 },
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  cameraOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 60,
  },
  cameraHint: { color: '#fff', fontSize: 16, marginBottom: 24, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  snapButton: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  snapInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  cancelButton: { padding: 12 },
  cancelText: { color: '#fff', fontSize: 16 },
  previewImage: { width: 280, height: 360, borderRadius: 12, marginVertical: 16 },
  buttonRow: { flexDirection: 'row', gap: 16, marginTop: 12 },
  primaryButton: {
    backgroundColor: '#1a1a2e', paddingVertical: 14, paddingHorizontal: 32,
    borderRadius: 10, marginTop: 16,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: { paddingVertical: 12, paddingHorizontal: 24, marginTop: 8 },
  secondaryButtonText: { color: '#1a1a2e', fontSize: 16 },
  sectionTitle: { fontSize: 22, fontWeight: 'bold', color: '#1a1a2e', marginBottom: 8, textAlign: 'center' },
  inactiveIcon: { fontSize: 48, marginBottom: 12 },
  inactiveTitle: { fontSize: 22, fontWeight: 'bold', color: '#1a1a2e', marginBottom: 8 },
  inactiveSub: { fontSize: 15, color: '#888', textAlign: 'center' },
  frozenTitle: { fontSize: 24, fontWeight: 'bold', color: '#3498db', marginBottom: 8 },
  frozenSub: { fontSize: 15, color: '#888', textAlign: 'center' },
  statusText: { fontSize: 15, color: '#666', marginBottom: 4 },
  challengePreview: { fontSize: 13, color: '#888', fontStyle: 'italic', marginBottom: 8 },
  stealWarning: { fontSize: 14, color: '#e74c3c', marginTop: 12, textAlign: 'center' },
  stealContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5', padding: 24 },
  stealIcon: { fontSize: 48, marginBottom: 12 },
  stealTitle: { fontSize: 22, fontWeight: 'bold', color: '#1a1a2e', marginBottom: 12 },
  stealDesc: { fontSize: 15, color: '#666', textAlign: 'center', marginBottom: 8, lineHeight: 22 },
  challengePrompt: { fontSize: 16, color: '#333', textAlign: 'center', marginVertical: 16, lineHeight: 24 },
  challengeButtons: { gap: 12, width: '100%', marginTop: 8 },
  challengeBtn: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  attemptedText: { fontSize: 14, color: '#888', fontStyle: 'italic', marginTop: 12 },
  resultIcon: { fontSize: 48, marginBottom: 12 },
  resultSub: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 8 },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  tabBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
  tabButton: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0e0e0',
  },
  tabButtonActive: { backgroundColor: '#1a1a2e', borderColor: '#1a1a2e' },
  tabButtonText: { fontSize: 15, fontWeight: '600', color: '#666' },
  tabButtonTextActive: { color: '#fff' },
  listContent: { paddingHorizontal: 20, paddingBottom: 24 },
  ownedRow: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 10, marginBottom: 8,
    overflow: 'hidden', elevation: 1,
  },
  ownedRowLocked: { backgroundColor: '#ececec', opacity: 0.9 },
  ownedStatusBar: { width: 6 },
  ownedInfo: { flex: 1, padding: 14 },
  ownedName: { fontSize: 16, fontWeight: '600', color: '#1a1a2e' },
  ownedStatus: { fontSize: 14, fontWeight: '700', color: '#3498db', marginTop: 2 },
  ownedStatusLocked: { color: '#888' },
  ownedHint: { fontSize: 12, color: '#888', marginTop: 4, fontStyle: 'italic' },
});
