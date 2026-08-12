import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { Map, Camera, GeoJSONSource, Layer, Marker as MapMarker } from '@maplibre/maplibre-react-native';
import { FontAwesome } from '@expo/vector-icons';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { useGameStore } from '../stores/useGameStore';
import { useLocationStore } from '../stores/useLocationStore';
import { useTeamStore } from '../stores/useTeamStore';
import { isWithinVicinity } from '../utils/distance';
import { emitLocation } from '../services/socket';
import {
  isMockLocationEnabled,
  startMockLocation,
  stopMockLocation,
  jumpTo,
} from '../services/mockLocation';
import type { Landmark, LandmarkState, LocationPing } from '../types';

const MINIMAL_MAP_STYLE: any = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'],
      tileSize: 256,
    },
  },
  layers: [
    { id: 'carto-bg', type: 'raster', source: 'carto' },
  ],
};

const MAP_STYLE = (Constants.expoConfig?.extra as any)?.mapStyle
  ?? MINIMAL_MAP_STYLE;

const LANDMARK_ICON: Record<LandmarkState['status'], 'lock' | 'unlock'> = {
  unclaimed: 'unlock',
  claimed: 'unlock',
  locked: 'lock',
};

const LANDMARK_HALO: Record<LandmarkState['status'], number> = {
  unclaimed: 24,
  claimed: 32,
  locked: 36,
};

const TEAM_HALO = 32;

export default function MapScreen() {
  const game = useGameStore((s) => s.game);
  const ownLocation = useLocationStore((s) => s.ownLocation);
  const setOwnLocation = useLocationStore((s) => s.setOwnLocation);
  const teamLocations = useLocationStore((s) => s.teamLocations);
  const myTeamId = useTeamStore((s) => s.myTeamId);

  const [selectedLandmark, setSelectedLandmark] = useState<Landmark | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [boundaryCoords] = useState<[number, number][]>([
    [-123.224, 49.319],
    [-123.005, 49.319],
    [-123.005, 49.215],
    [-123.224, 49.215],
    [-123.224, 49.319],
  ]);

  useEffect(() => {
    if (isMockLocationEnabled()) return;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      setOwnLocation(loc.coords.latitude, loc.coords.longitude);
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 5000 },
        (loc) => {
          setOwnLocation(loc.coords.latitude, loc.coords.longitude);
          emitLocation(loc.coords.latitude, loc.coords.longitude);
        }
      );
    })();
  }, [setOwnLocation]);

  const mockRoute = useMemo(
    () =>
      game
        ? game.landmarks.map((lm) => ({ latitude: lm.latitude, longitude: lm.longitude }))
        : [],
    [game]
  );

  const [mockWalking, setMockWalking] = useState(false);

  const handleStartWalk = useCallback(() => {
    startMockLocation(mockRoute, (lat, lng) => {
      setOwnLocation(lat, lng);
      emitLocation(lat, lng);
    });
    setMockWalking(true);
  }, [mockRoute, setOwnLocation]);

  const handleStopWalk = useCallback(() => {
    stopMockLocation();
    setMockWalking(false);
  }, []);

  useEffect(() => {
    if (!isMockLocationEnabled() || !game) return;
    return () => stopMockLocation();
  }, [game?.id]);

  const mockStartedForGame = useRef<string | null>(null);

  useEffect(() => {
    if (!isMockLocationEnabled() || !game || mockRoute.length === 0) return;
    if (mockStartedForGame.current === game.id) return;
    mockStartedForGame.current = game.id;
    startMockLocation(mockRoute, (lat, lng) => {
      setOwnLocation(lat, lng);
      emitLocation(lat, lng);
    });
    setMockWalking(true);
  }, [game?.id, mockRoute, setOwnLocation]);

  useEffect(() => {
    if (!game || teamLocations.length > 0) return;
    const mockPositions = game.teams.map((t, i) => {
      const landmarkIndex = i * 10;
      const lm = game.landmarks[landmarkIndex % game.landmarks.length];
      return {
        teamId: t.id,
        latitude: lm.latitude + (Math.random() - 0.5) * 0.001,
        longitude: lm.longitude + (Math.random() - 0.5) * 0.001,
        timestamp: new Date().toISOString(),
      };
    });
    mockPositions.forEach((p) => useLocationStore.getState().updateTeamLocation(p));
  }, [game?.id]);

  const getLandmarkState = useCallback(
    (landmarkId: string): LandmarkState => {
      if (!game) return { landmarkId, status: 'unclaimed' };
      return (
        game.landmarkStates.find((s) => s.landmarkId === landmarkId) ?? {
          landmarkId,
          status: 'unclaimed',
        }
      );
    },
    [game]
  );

  const getTeamColor = useCallback(
    (teamId?: string): string => {
      if (!teamId || !game) return '#999';
      const team = game.teams.find((t) => t.id === teamId);
      return team?.color ?? '#999';
    },
    [game]
  );

  const myTrackerPenalty =
    game?.penalties?.find(
      (p) => p.teamId === myTeamId && p.type === 'tracker' && new Date(p.until).getTime() > Date.now()
    ) ?? null;

  const [cameraCenter, setCameraCenter] = useState<[number, number] | null>(null);
  const centeredRef = useRef(false);

  const centerOnOwnTeam = useCallback(() => {
    if (centeredRef.current) return;
    const ownTeamLoc = teamLocations.find((l) => l.teamId === myTeamId);
    let lat = ownLocation?.latitude;
    let lng = ownLocation?.longitude;
    if ((lat == null || lng == null) && ownTeamLoc) {
      lat = ownTeamLoc.latitude;
      lng = ownTeamLoc.longitude;
    }
    if (lat == null || lng == null) return;
    centeredRef.current = true;
    setCameraCenter([lng, lat]);
  }, [ownLocation, myTeamId, teamLocations]);

  useEffect(() => {
    centerOnOwnTeam();
  }, [centerOnOwnTeam]);

  const handleLandmarkPress = useCallback((id: string) => {
    if (!game) return;
    const landmark = game.landmarks.find((l) => l.id === id);
    if (!landmark) return;
    setSelectedLandmark(landmark);
    setSelectedTeamId(null);
  }, [game]);

  const handleTeamPress = useCallback((id: string) => {
    setSelectedTeamId((prev) => (prev === id ? null : id));
    setSelectedLandmark(null);
  }, []);

  const closePanel = () => {
    setSelectedLandmark(null);
    setSelectedTeamId(null);
  };

  const timeSince = useCallback((timestamp: string): string => {
    const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const mins = Math.floor(seconds / 60);
    return `${mins}m ago`;
  }, []);

  if (!game) return null;

  const isNearby =
    selectedLandmark &&
    ownLocation &&
    isWithinVicinity(
      ownLocation.latitude,
      ownLocation.longitude,
      selectedLandmark.latitude,
      selectedLandmark.longitude,
      game.config.vicinityRadius
    );

  const landmarkState = selectedLandmark ? getLandmarkState(selectedLandmark.id) : null;
  const isClaimedByMe = landmarkState?.teamId === myTeamId;
  const claimedTeam = landmarkState?.teamId
    ? game.teams.find((t) => t.id === landmarkState.teamId)
    : null;

  const selectedTeamLoc = selectedTeamId
    ? teamLocations.find((l) => l.teamId === selectedTeamId)
    : null;
  const selectedTeamInfo = selectedTeamId
    ? game.teams.find((t) => t.id === selectedTeamId)
    : null;

  return (
    <View style={styles.container}>
      {myTrackerPenalty && (
        <View style={styles.penaltyBanner}>
          <Text style={styles.penaltyBannerText}>
            👁️ Blind spot active — your tracker is hidden for {Math.max(1, Math.round((new Date(myTrackerPenalty.until).getTime() - Date.now()) / 60000))} min
          </Text>
        </View>
      )}
      <Map style={styles.map} mapStyle={MAP_STYLE}>
        <Camera
          initialViewState={{
            center: [-123.1207, 49.2827],
            zoom: 14,
          }}
          center={cameraCenter ?? undefined}
          duration={800}
        />

        <GeoJSONSource
          id="boundary-source"
          data={{
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [boundaryCoords],
            },
            properties: {},
          }}
        >
          <Layer
            id="boundary-fill"
            type="fill"
            paint={{
              'fill-color': 'rgba(26, 26, 46, 0.05)',
              'fill-outline-color': '#1a1a2e',
            }}
          />
        </GeoJSONSource>

        {game.landmarks.map((lm) => {
          const state = getLandmarkState(lm.id);
          const status = state?.status ?? 'unclaimed';
          const color = status === 'unclaimed' ? '#999' : getTeamColor(state?.teamId);
          const halo = LANDMARK_HALO[status];
          return (
            <MapMarker
              key={lm.id}
              id={lm.id}
              lngLat={[lm.longitude, lm.latitude]}
              onPress={() => handleLandmarkPress(lm.id)}
            >
              <View
                style={[
                  styles.markerHalo,
                  { width: halo, height: halo, borderRadius: halo / 2 },
                ]}
              >
                <FontAwesome name={LANDMARK_ICON[status]} size={halo * 0.5} color={color} />
              </View>
            </MapMarker>
          );
        })}

        {teamLocations.map((loc) => {
          const selected = selectedTeamId === loc.teamId;
          if (myTrackerPenalty && loc.teamId === myTeamId) return null;
          return (
            <MapMarker
              key={loc.teamId}
              id={loc.teamId}
              lngLat={[loc.longitude, loc.latitude]}
              onPress={() => handleTeamPress(loc.teamId)}
            >
              <View
                style={[
                  styles.markerHalo,
                  styles.teamHalo,
                  selected && styles.teamHaloSelected,
                ]}
              >
                <FontAwesome name="user" size={16} color={getTeamColor(loc.teamId)} />
              </View>
            </MapMarker>
          );
        })}
      </Map>

      {selectedTeamId && selectedTeamLoc && selectedTeamInfo && (
        <View style={styles.detailPanel}>
          <View style={styles.detailHeader}>
            <View style={styles.detailHeaderLeft}>
              <View style={[styles.teamDetailDot, { backgroundColor: selectedTeamInfo.color }]} />
              <Text style={styles.detailTitle}>{selectedTeamInfo.name}</Text>
            </View>
            <TouchableOpacity onPress={closePanel}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.statusText}>Location updated {timeSince(selectedTeamLoc.timestamp)}</Text>
        </View>
      )}

      {selectedLandmark && !selectedTeamId && (
        <View style={styles.detailPanel}>
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle}>{selectedLandmark.name}</Text>
            <TouchableOpacity onPress={closePanel}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>
          {landmarkState && (
            <Text style={styles.statusText}>
              {landmarkState.status === 'unclaimed'
                ? 'Unclaimed'
                : landmarkState.status === 'locked'
                ? 'Locked'
                : `Claimed by ${claimedTeam?.name ?? 'Unknown'}`}
            </Text>
          )}
          {(selectedLandmark.challenge?.text ?? selectedLandmark.challengeText) && (
            <Text style={styles.challengeText}>
              Challenge: {selectedLandmark.challenge?.text ?? selectedLandmark.challengeText}
            </Text>
          )}
          {isNearby && !isClaimedByMe && landmarkState?.status !== 'locked' && (
            <Text style={styles.nearbyText}>You are within vicinity!</Text>
          )}
          {!isNearby && ownLocation && (
            <Text style={styles.distantText}>Move closer to interact</Text>
          )}
        </View>
      )}

      {isMockLocationEnabled() && (
        <View style={styles.mockPanel}>
          <View style={styles.mockHeader}>
            <Text style={styles.mockTitle}>Mock Location</Text>
            <TouchableOpacity
              style={[styles.mockToggle, mockWalking && styles.mockToggleActive]}
              onPress={mockWalking ? handleStopWalk : handleStartWalk}
            >
              <Text style={styles.mockToggleText}>
                {mockWalking ? 'Stop Walk' : 'Start Walk'}
              </Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mockLandmarks}>
            {game.landmarks.map((lm) => (
              <TouchableOpacity
                key={lm.id}
                style={styles.mockChip}
                onPress={() => jumpTo({ latitude: lm.latitude, longitude: lm.longitude })}
              >
                <Text style={styles.mockChipText}>{lm.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  markerHalo: {
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamHalo: { width: TEAM_HALO, height: TEAM_HALO, borderRadius: TEAM_HALO / 2 },
  teamHaloSelected: { borderWidth: 3, borderColor: '#1a1a2e' },
  detailPanel: {
    position: 'absolute', bottom: 20, left: 16, right: 16,
    backgroundColor: '#fff', borderRadius: 14, padding: 18,
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6,
  },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  teamDetailDot: { width: 14, height: 14, borderRadius: 7 },
  detailTitle: { fontSize: 18, fontWeight: 'bold', color: '#1a1a2e', flex: 1 },
  closeBtn: { fontSize: 20, color: '#999', paddingLeft: 12 },
  statusText: { fontSize: 14, color: '#666', marginTop: 4 },
  challengeText: { fontSize: 13, color: '#888', marginTop: 6, fontStyle: 'italic' },
  penaltyBanner: {
    position: 'absolute', top: 16, left: 16, right: 16, zIndex: 10,
    backgroundColor: '#1a1a2e', borderRadius: 12, padding: 12,
  },
  penaltyBannerText: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  nearbyText: { fontSize: 14, fontWeight: '600', color: '#2ecc71', marginTop: 8 },
  distantText: { fontSize: 13, color: '#e74c3c', marginTop: 8 },
  mockPanel: {
    position: 'absolute', top: 16, left: 16, right: 16,
    backgroundColor: 'rgba(26, 26, 46, 0.9)', borderRadius: 12, padding: 12,
  },
  mockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  mockTitle: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  mockToggle: {
    backgroundColor: '#2ecc71', paddingVertical: 6, paddingHorizontal: 14,
    borderRadius: 8,
  },
  mockToggleActive: { backgroundColor: '#e74c3c' },
  mockToggleText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  mockLandmarks: { flexGrow: 0 },
  mockChip: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16,
    paddingVertical: 6, paddingHorizontal: 12, marginRight: 8,
  },
  mockChipText: { color: '#fff', fontSize: 12 },
});
