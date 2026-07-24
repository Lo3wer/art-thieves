import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { Map, Camera, Marker, GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { useGameStore } from '../stores/useGameStore';
import { useLocationStore } from '../stores/useLocationStore';
import { useTeamStore } from '../stores/useTeamStore';
import { isWithinVicinity } from '../utils/distance';
import { emitLocation } from '../services/socket';
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
      <Map style={styles.map} mapStyle={MAP_STYLE}>
        <Camera
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
          const color = state.status === 'unclaimed'
            ? '#999'
            : state.status === 'locked'
            ? '#888'
            : getTeamColor(state.teamId);

          return (
            <Marker
              key={lm.id}
              id={lm.id}
              lngLat={[lm.longitude, lm.latitude]}
              onPress={() => handleMarkerPress(lm)}
            >
              <View
                style={[
                  styles.marker,
                  { backgroundColor: color },
                  state.status === 'locked' && styles.markerLocked,
                ]}
              />
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
              <View style={[styles.teamMarkerOuter, isSelected && styles.teamMarkerSelected]}>
                <View style={[styles.teamMarkerInner, { backgroundColor: color }]} />
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
  markerLocked: {
    opacity: 0.6,
  },
  teamMarkerOuter: {
    width: 24,
    height: 24,
    transform: [{ rotate: '45deg' }],
    borderRadius: 3,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: '#fff',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  teamMarkerSelected: {
    borderColor: '#1a1a2e',
    borderWidth: 3,
  },
  teamMarkerInner: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: '#fff',
    opacity: 0.9,
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
});
