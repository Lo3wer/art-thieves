import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Map, Camera, Marker, GeoJSONSource, Layer, type CameraRef } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { MaterialIcons } from '@expo/vector-icons';
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

  const cameraRef = useRef<CameraRef>(null);
  const centeredRef = useRef(false);
  const mapReadyRef = useRef(false);

  const centerOnOwnTeam = useCallback(() => {
    if (centeredRef.current || !mapReadyRef.current) return;
    const ownTeamLoc = teamLocations.find((l) => l.teamId === myTeamId);
    let lat = ownLocation?.latitude;
    let lng = ownLocation?.longitude;
    if ((lat == null || lng == null) && ownTeamLoc) {
      lat = ownTeamLoc.latitude;
      lng = ownTeamLoc.longitude;
    }
    if (lat == null || lng == null) return;
    centeredRef.current = true;
    cameraRef.current?.flyTo({
      center: [lng, lat],
      duration: 800,
    });
  }, [ownLocation, myTeamId, teamLocations]);

  useEffect(() => {
    centerOnOwnTeam();
  }, [centerOnOwnTeam]);

  useFocusEffect(
    useCallback(() => {
      centeredRef.current = false;
      centerOnOwnTeam();
    }, [centerOnOwnTeam])
  );

  const handleMarkerPress = (landmark: Landmark) => {
    setSelectedLandmark(landmark);
    setSelectedTeamId(null);
  };

  const handleTeamMarkerPress = (teamId: string) => {
    setSelectedTeamId(selectedTeamId === teamId ? null : teamId);
    setSelectedLandmark(null);
  };

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
      <Map
        style={styles.map}
        mapStyle={MAP_STYLE}
        onDidFinishRenderingMap={() => {
          mapReadyRef.current = true;
          centerOnOwnTeam();
        }}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: [-123.1207, 49.2827],
            zoom: 14,
          }}
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
          const ownedTeamId = state?.teamId;
          const color = state.status === 'unclaimed'
            ? '#999'
            : getTeamColor(ownedTeamId);

          return (
            <Marker
              key={lm.id}
              id={lm.id}
              lngLat={[lm.longitude, lm.latitude]}
              onPress={() => handleMarkerPress(lm)}
            >
              {state.status === 'unclaimed' ? (
                <View style={[styles.marker, { backgroundColor: color }]} />
              ) : (
                <View
                  style={[
                    styles.lockMarker,
                    state.status === 'locked' && styles.lockMarkerLocked,
                  ]}
                >
                  <MaterialIcons
                    name={state.status === 'locked' ? 'lock' : 'lock-open'}
                    size={22}
                    color={color}
                  />
                </View>
              )}
            </Marker>
          );
        })}

        {teamLocations.map((loc) => {
          const color = getTeamColor(loc.teamId);
          const isSelected = selectedTeamId === loc.teamId;
          return (
            <Marker
              key={`team-${loc.teamId}`}
              id={`team-${loc.teamId}`}
              lngLat={[loc.longitude, loc.latitude]}
              onPress={() => handleTeamMarkerPress(loc.teamId)}
            >
              <View style={[styles.personMarker, isSelected && styles.personMarkerSelected]}>
                <MaterialIcons name="person" size={26} color={color} />
              </View>
            </Marker>
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
          {selectedLandmark.challengeText && (
            <Text style={styles.challengeText}>Challenge: {selectedLandmark.challengeText}</Text>
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
  marker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#fff',
    elevation: 2,
  },
  lockMarker: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  lockMarkerLocked: {
    opacity: 0.55,
  },
  personMarker: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#fff',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  personMarkerSelected: {
    borderColor: '#1a1a2e',
    borderWidth: 3,
  },
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
