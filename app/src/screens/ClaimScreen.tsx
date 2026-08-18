import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Image, ActivityIndicator, FlatList,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { api } from '../services/api';
import { uploadPhoto } from '../services/upload';
import { useGameStore } from '../stores/useGameStore';
import { useLocationStore } from '../stores/useLocationStore';
import { useTeamStore } from '../stores/useTeamStore';
import { isWithinVicinity } from '../utils/distance';
import { scheduleLocalNotification, scheduleLocalNotificationDelayed, formatMinutesUntil } from '../services/notifications';
import type { Landmark, LandmarkState, ChallengeSpec, ChallengeView } from '../types';

type ClaimPhase = 'idle' | 'camera' | 'preview' | 'result' | 'challenge' | 'challengePhoto' | 'challengePhotoPreview';

const OUTCOME_LABEL: Record<string, string> = {
  complete: 'Challenge completed',
  fail: 'Challenge failed',
  pass: 'Challenge passed',
};

function challengeStateLabel(view: ChallengeView | undefined): string | null {
  if (!view) return null;
  if (view.status === 'pending') {
    return view.readyAt ? `Return in ${formatMinutesUntil(view.readyAt)} to complete` : 'Challenge in progress';
  }
  if (view.status === 'ready') return 'Challenge ready — return here to complete';
  if (view.status === 'voided') return 'Challenge voided (another team locked it first)';
  if (view.outcome) return OUTCOME_LABEL[view.outcome];
  return null;
}

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
  const [resultMessage, setResultMessage] = useState('');
  const [exitInfo, setExitInfo] = useState<string | null>(null);

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
      .map((lm) => {
        const s = stateMap.get(lm.id)!;
        return {
          id: lm.id,
          name: lm.name,
          challengeText: lm.challenge?.text ?? lm.challengeText,
          status: s.status,
          challenge: s.challenge,
        };
      });
  }, [game, myTeamId]);

  const lm = nearbyLandmark();
  const state = lm ? landmarkState(lm) : null;
  const spec = useMemo((): ChallengeSpec | null => {
    if (!lm) return null;
    if (lm.challenge) return lm.challenge;
    if (lm.challengeText) return { text: lm.challengeText, mode: 'instant' };
    return null;
  }, [lm]);

  const exitToIdle = (message: string) => {
    setExitInfo(message);
    setPhoto(null);
    setPhase('idle');
  };

  const reset = () => {
    setPhoto(null);
    setPhase('idle');
    setShowStealModal(false);
  };

  // Auto-exit the challenge screen when the claim context changes underneath us
  // (stolen, locked by another team, or walked away) to avoid a deadlock.
  useEffect(() => {
    if (phase !== 'challenge' && phase !== 'challengePhoto' && phase !== 'challengePhotoPreview') return;
    if (!lm) {
      reset();
      return;
    }
    const s = landmarkState(lm);
    if (s.status === 'locked') {
      if (s.teamId === myTeamId) {
        if (phase === 'challenge') setPhase('result');
        else reset();
      } else {
        exitToIdle(`${lm.name} was locked by another team`);
      }
      return;
    }
    if (s.status === 'unclaimed' || (s.teamId && s.teamId !== myTeamId)) {
      exitToIdle(`${lm.name} was taken by another team`);
      return;
    }
    if (phase === 'challenge' && s.challenge?.status === 'voided') {
      exitToIdle(`${lm.name}'s challenge was voided (another team locked it first)`);
    }
  }, [phase, lm, landmarkState, myTeamId]);

  useEffect(() => {
    if (!exitInfo) return;
    const t = setTimeout(() => setExitInfo(null), 4000);
    return () => clearTimeout(t);
  }, [exitInfo]);

  const handleTakePhoto = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    setPhoto(null);
    setPhase('camera');
  };

  const handleSnap = async () => {
    if (!cameraRef.current) return;
    const snap = await cameraRef.current.takePictureAsync({ quality: 0.7 });
    if (snap?.uri) {
      setPhoto(snap.uri);
      setPhase(phase === 'challengePhoto' ? 'challengePhotoPreview' : 'preview');
    }
  };

  const handleConfirmClaim = async () => {
    const landmark = nearbyLandmark();
    if (!landmark || !game) return;

    const st = landmarkState(landmark);
    if (st.status === 'locked') {
      Alert.alert('Locked', 'This landmark is locked and cannot be claimed');
      setPhase('idle');
      return;
    }

    const isSteal = st.status === 'claimed' && st.teamId !== myTeamId;
    if (isSteal && !showStealModal) {
      setShowStealModal(true);
      return;
    }

    setLoading(true);
    try {
      let photoId: string | undefined;
      if (photo) {
        const uploaded = await uploadPhoto(game.id, landmark.id, photo, ownLocation ?? undefined);
        photoId = uploaded.photoId;
      }
      await api.claimLandmark(game.id, landmark.id, ownLocation!.latitude, ownLocation!.longitude, photoId);
      updateLandmarkState({
        landmarkId: landmark.id,
        status: 'claimed',
        teamId: myTeamId ?? undefined,
        claimedAt: new Date().toISOString(),
      });
      setShowStealModal(false);

      if (isSteal) {
        scheduleLocalNotification(
          'Landmark Stolen!',
          `You stole ${landmark.name} from another team!`
        );
        setResultMessage(`Stole ${landmark.name}!`);
      } else {
        scheduleLocalNotification(
          'Landmark Claimed!',
          `You claimed ${landmark.name}!`
        );
        setResultMessage(`Claimed ${landmark.name}!`);
      }

      if (spec) {
        setPhase('challenge');
        if (spec.mode === 'delayed' && spec.delayed?.delayMinutes) {
          scheduleLocalNotificationDelayed(
            'Challenge Ready',
            `${landmark.name}: your challenge is ready — return to lock it!`,
            spec.delayed.delayMinutes * 60
          );
        }
        if (spec.instant?.penalty?.note) {
          scheduleLocalNotification(`${landmark.name}: Penalty`, spec.instant.penalty.note);
        }
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

  const applyPenaltyReminders = (lmName: string, penalty: { type: string; minutes: number; note: string } | undefined) => {
    if (!penalty) return;
    scheduleLocalNotification(`${penalty.type === 'tracker' ? 'Tracker' : 'Transit'} Penalty`, penalty.note);
    scheduleLocalNotificationDelayed(
      `${penalty.type === 'tracker' ? 'Tracker' : 'Transit'} Restored`,
      penalty.type === 'tracker'
        ? `${lmName}: your tracker access has been restored.`
        : `${lmName}: your team may take transit again.`,
      penalty.minutes * 60
    );
  };

  const handleChallenge = async (outcome: 'complete' | 'fail' | 'pass', photoId?: string) => {
    if (!lm || !game) return;
    setLoading(true);
    try {
      let response: { penaltyUntil?: string; penaltyType?: 'tracker' | 'transit' } | null = null;
      if (outcome === 'complete') {
        response = await api.completeChallenge(game.id, lm.id, photoId) as any;
        updateLandmarkState({
          landmarkId: lm.id,
          status: 'locked',
          teamId: myTeamId ?? undefined,
        });
        scheduleLocalNotification('Challenge Complete!', `${lm.name} is now locked!`);
        let message = `${lm.name} is now locked!`;
        if (response?.penaltyType && spec?.instant?.penalty) {
          applyPenaltyReminders(lm.name, { ...spec.instant.penalty, type: response.penaltyType });
          message = `${message}\n\n${spec.instant.penalty.note}`;
        }
        setResultMessage(message);
      } else if (outcome === 'fail') {
        await api.failChallenge(game.id, lm.id);
        setResultMessage(`Challenge failed for ${lm.name}`);
      } else {
        await api.passChallenge(game.id, lm.id);
        setResultMessage(`Challenge passed for ${lm.name}`);
      }
      setPhase('result');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Challenge failed');
      reset();
    } finally {
      setLoading(false);
    }
  };

  const handleChallengeCompleteWithPhoto = async () => {
    if (!lm || !game || !photo) return;
    setLoading(true);
    try {
      const uploaded = await uploadPhoto(game.id, lm.id, photo, ownLocation ?? undefined);
      await handleChallenge('complete', uploaded.photoId);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Photo upload failed');
    } finally {
      setLoading(false);
    }
  };

  const startChallengeCamera = () => {
    (async () => {
      if (!permission?.granted) {
        const result = await requestPermission();
        if (!result.granted) return;
      }
      setPhoto(null);
      setPhase('challengePhoto');
    })();
  };

  const isSteal = state?.status === 'claimed' && state?.teamId !== myTeamId;
  const owner = isSteal && lm && game ? game.teams.find((t) => t.id === state?.teamId) : null;
  const challengeView = state?.challenge;
  const isAttempted = challengeView?.outcome != null;
  const isVoided = challengeView?.status === 'voided';
  const isReady =
    challengeView?.status === 'ready' ||
    (challengeView?.status === 'pending' &&
      challengeView?.readyAt &&
      new Date(challengeView.readyAt).getTime() <= Date.now());

  if (phase === 'camera' || phase === 'challengePhoto') {
    return (
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing="front" />
        <View style={styles.cameraOverlay} pointerEvents="box-none">
          <Text style={styles.cameraHint}>
            {phase === 'challengePhoto' ? 'Take a photo as proof for your challenge' : 'Take a selfie with the landmark'}
          </Text>
          <TouchableOpacity style={styles.snapButton} onPress={handleSnap}>
            <View style={styles.snapInner} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => (phase === 'challengePhoto' ? setPhase('challenge') : reset())}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (phase === 'preview' || phase === 'challengePhotoPreview') {
    const isChallengePhoto = phase === 'challengePhotoPreview';
    return (
      <View style={styles.centered}>
        <Text style={styles.sectionTitle}>{isChallengePhoto ? 'Preview Proof' : 'Preview Selfie'}</Text>
        {photo && <Image source={{ uri: photo }} style={styles.previewImage} />}
        <View style={styles.previewButtonRow}>
          <TouchableOpacity
            style={[styles.retakeButton, loading && styles.buttonDisabled]}
            onPress={() => setPhase(isChallengePhoto ? 'challengePhoto' : 'camera')}
            disabled={loading}
          >
            <Text style={styles.retakeButtonText}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.confirmButton, loading && styles.buttonDisabled]}
            onPress={isChallengePhoto ? handleChallengeCompleteWithPhoto : handleConfirmClaim}
            disabled={loading}
          >
            <Text style={styles.buttonText}>{loading ? '...' : 'Confirm'}</Text>
          </TouchableOpacity>
        </View>
        {isSteal && !isChallengePhoto && (
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

  if (phase === 'challenge' && lm && spec) {
    const isDelayed = spec.mode === 'delayed';
    const needsPhoto = isDelayed && !!spec.delayed?.requiresPhoto;

    return (
      <View style={styles.centered}>
        <Text style={styles.sectionTitle}>Challenge</Text>
        <Text style={styles.challengePrompt}>{spec.text}</Text>

        {isVoided ? (
          <>
            <Text style={styles.attemptedText}>Challenge voided — another team locked this landmark first.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={reset}>
              <Text style={styles.buttonText}>Done</Text>
            </TouchableOpacity>
          </>
        ) : isAttempted ? (
          <>
            <Text style={styles.attemptedText}>Challenge already attempted for this landmark.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={reset}>
              <Text style={styles.buttonText}>Done</Text>
            </TouchableOpacity>
          </>
        ) : isDelayed && !isReady ? (
          <>
            <Text style={styles.pendingText}>
              This challenge will be ready in {spec.delayed?.delayMinutes ? `${spec.delayed.delayMinutes}` : ''} minutes.
              {spec.delayed?.returnToLandmark ? ' Return here to lock it.' : ''}
              {spec.delayed?.preCondition ? `\n\n${spec.delayed.preCondition}` : ''}
            </Text>
            {challengeView?.readyAt && (
              <Text style={styles.attemptedText}>Ready in {formatMinutesUntil(challengeView.readyAt)}</Text>
            )}
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setPhase('idle')}>
              <Text style={styles.secondaryButtonText}>Leave for now</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={reset}>
              <Text style={styles.secondaryButtonText}>Done</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {spec.instant?.penalty?.note && (
              <Text style={styles.penaltyNote}>{spec.instant.penalty.note}</Text>
            )}
            <View style={styles.challengeButtons}>
              <TouchableOpacity
                style={[styles.challengeBtn, { backgroundColor: '#2ecc71' }]}
                onPress={() => (needsPhoto ? startChallengeCamera() : handleChallenge('complete'))}
                disabled={loading}
              >
                <Text style={styles.buttonText}>
                  {needsPhoto
                    ? 'Complete (with photo)'
                    : spec.instant?.completeLabel ?? 'Complete'}
                </Text>
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
                onPress={() => handleChallenge('pass')}
                disabled={loading}
              >
                <Text style={styles.buttonText}>
                  {spec.instant?.vetoLabel ?? 'Pass'}
                </Text>
              </TouchableOpacity>
              {spec.instant?.vetoNote && (
                <Text style={styles.penaltyNote}>{spec.instant.vetoNote}</Text>
              )}
              {isDelayed && spec.delayed?.returnToLandmark && (
                <Text style={styles.penaltyNote}>Must be at the landmark to lock it.</Text>
              )}
            </View>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setPhase('idle')}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </>
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
                const label = isLocked ? null : challengeStateLabel(item.challenge);
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
                      {isLocked && <Text style={styles.ownedHint}>Locked and safe from being stolen</Text>}
                      {!isLocked && (
                        <Text style={styles.ownedHint}>{label ?? 'Complete the challenge to lock this landmark'}</Text>
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
          {exitInfo && <Text style={styles.exitInfo}>{exitInfo}</Text>}
          <Text style={styles.sectionTitle}>{lm.name}</Text>
          {state && (
            <Text style={styles.statusText}>
              {state.status === 'unclaimed'
                ? 'Unclaimed'
                : state.teamId === myTeamId
                ? 'Claimed by you'
                : `Owned by ${owner?.name ?? 'Unknown'}`}
            </Text>
          )}
          {spec && (
            <Text style={styles.challengePreview}>
              {state?.teamId === myTeamId && !isAttempted && challengeView
                ? challengeStateLabel(challengeView) ?? spec.text
                : spec.text}
            </Text>
          )}

          {state?.teamId === myTeamId && spec && !isAttempted ? (
            <TouchableOpacity
              style={[styles.primaryButton, isFrozen && styles.buttonDisabled]}
              onPress={() => setPhase('challenge')}
              disabled={isFrozen}
            >
              <Text style={styles.buttonText}>View Challenge</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.primaryButton, isFrozen && styles.buttonDisabled]}
                onPress={handleTakePhoto}
                disabled={isFrozen}
              >
                <Text style={styles.buttonText}>
                  {isFrozen ? 'Frozen - Cannot Claim' : isSteal ? 'Take Selfie to Steal' : 'Take Selfie to Claim'}
                </Text>
              </TouchableOpacity>
              {!isFrozen && (
                <TouchableOpacity style={styles.secondaryButton} onPress={handleConfirmClaim}>
                  <Text style={styles.secondaryButtonText}>
                    {isSteal ? 'Steal Without Photo' : 'Claim Without Photo'}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
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
  previewButtonRow: { flexDirection: 'row', gap: 12, width: '100%', marginTop: 24 },
  retakeButton: {
    flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center',
    justifyContent: 'center', backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#c8c8c8',
  },
  retakeButtonText: { color: '#1a1a2e', fontSize: 16, fontWeight: '600' },
  confirmButton: {
    flex: 1, backgroundColor: '#1a1a2e', paddingVertical: 14,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
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
  statusText: { fontSize: 15, color: '#666', marginBottom: 4 },
  challengePreview: { fontSize: 13, color: '#888', fontStyle: 'italic', marginBottom: 8, textAlign: 'center' },
  exitInfo: { fontSize: 14, color: '#e67e22', textAlign: 'center', marginBottom: 12, fontWeight: '600' },
  stealWarning: { fontSize: 14, color: '#e74c3c', marginTop: 12, textAlign: 'center' },
  stealContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5', padding: 24 },
  stealIcon: { fontSize: 48, marginBottom: 12 },
  stealTitle: { fontSize: 22, fontWeight: 'bold', color: '#1a1a2e', marginBottom: 12 },
  stealDesc: { fontSize: 15, color: '#666', textAlign: 'center', marginBottom: 8, lineHeight: 22 },
  challengePrompt: { fontSize: 16, color: '#333', textAlign: 'center', marginVertical: 16, lineHeight: 24 },
  challengeButtons: { gap: 12, width: '100%', marginTop: 8 },
  challengeBtn: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  pendingText: { fontSize: 15, color: '#555', textAlign: 'center', marginVertical: 16, lineHeight: 24 },
  penaltyNote: { fontSize: 12, color: '#888', fontStyle: 'italic', textAlign: 'center', marginTop: 4, lineHeight: 18 },
  attemptedText: { fontSize: 14, color: '#888', fontStyle: 'italic', marginTop: 12, textAlign: 'center' },
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