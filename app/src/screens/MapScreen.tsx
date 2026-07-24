import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { Map, Camera, Marker, UserLocation, GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { useGameStore } from '../stores/useGameStore';
import { useLocationStore } from '../stores/useLocationStore';
import { useTeamStore } from '../stores/useTeamStore';
import { isWithinVicinity } from '../utils/distance';
import type { Landmark, LandmarkState } from '../types';

const MAP_STYLE = (Constants.expoConfig?.extra as any)?.mapStyle
  ?? 'https://tiles.openfreemap.org/styles/liberty';

export default function MapScreen() {
  const game = useGameStore((s) => s.game);
  const ownLocation = useLocationStore((s) => s.ownLocation);
  const setOwnLocation = useLocationStore((s) => s.setOwnLocation);
  const teamLocations = useLocationStore((s) => s.teamLocations);
  const myTeamId = useTeamStore((s) => s.myTeamId);

  const [selectedLandmark, setSelectedLandmark] = useState<Landmark | null>(null);
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
  };

  const closePanel = () => setSelectedLandmark(null);

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

  return (
    <View style={styles.container}>
      <Map style={styles.map} mapStyle={MAP_STYLE}>
        <Camera
          initialViewState={{
            center: [-123.1207, 49.2827],
            zoom: 14,
          }}
        />

        <UserLocation />

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
          return (
            <Marker
              key={`team-${loc.teamId}`}
              id={`team-${loc.teamId}`}
              lngLat={[loc.longitude, loc.latitude]}
            >
              <View style={[styles.teamMarker, { backgroundColor: color }]} />
            </Marker>
          );
        })}
      </Map>

      {selectedLandmark && (
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
  teamMarker: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#fff',
    elevation: 2,
  },
  detailPanel: {
    position: 'absolute', bottom: 20, left: 16, right: 16,
    backgroundColor: '#fff', borderRadius: 14, padding: 18,
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6,
  },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailTitle: { fontSize: 18, fontWeight: 'bold', color: '#1a1a2e', flex: 1 },
  closeBtn: { fontSize: 20, color: '#999', paddingLeft: 12 },
  statusText: { fontSize: 14, color: '#666', marginTop: 4 },
  challengeText: { fontSize: 13, color: '#888', marginTop: 6, fontStyle: 'italic' },
  nearbyText: { fontSize: 14, fontWeight: '600', color: '#2ecc71', marginTop: 8 },
  distantText: { fontSize: 13, color: '#e74c3c', marginTop: 8 },
});
