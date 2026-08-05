export interface GeoFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: Record<string, unknown> | null;
    geometry: {
      type: string;
      coordinates: unknown;
    };
  }[];
}

export interface GameMap {
  id: string;
  name: string;
  center: { lat: number; lng: number };
  defaultZoom: number;
  defaultVicinityRadius: number;
  winThreshold: number;
  data: GeoFeatureCollection;
  landmarkCount?: number;
}

export interface Team {
  id: string;
  gameId: string;
  name: string;
  color: string;
}

export interface Landmark {
  id: string;
  gameId: string;
  name: string;
  latitude: number;
  longitude: number;
  imageUrl?: string;
  challengeText?: string;
  mapLandmarkIndex: number;
}

export interface LandmarkState {
  landmarkId: string;
  status: 'unclaimed' | 'claimed' | 'locked';
  teamId?: string;
}

export interface GameConfig {
  duration: number;
  vicinityRadius: number;
  winThreshold: number;
  reTagCooldown: number;
  disputeWindow: number;
  noTagPeriod: number;
}

export type GameStatus = 'lobby' | 'active' | 'paused' | 'ended';

export interface Game {
  id: string;
  joinCode: string;
  mapId: string;
  status: GameStatus;
  config: GameConfig;
  startedAt?: string;
  pausedAt?: string;
  totalPausedMs: number;
  teams: Team[];
  landmarks: Landmark[];
  landmarkStates: LandmarkState[];
}

export interface TagEvent {
  id: string;
  gameId: string;
  taggerTeamId: string;
  targetTeamId: string;
  timestamp: string;
  disputed: boolean;
  voided: boolean;
}

export interface LogEntry {
  id: string;
  gameId: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface LocationPing {
  teamId: string;
  latitude: number;
  longitude: number;
  timestamp: string;
}

export interface GameSummaryLandmark {
  id: string;
  name: string;
  mapLandmarkIndex: number;
  status: 'unclaimed' | 'claimed' | 'locked';
  teamId: string | null;
  teamName: string | null;
  claimedAt: string | null;
  challenge: { outcome: 'complete' | 'fail' | 'veto'; teamId: string; createdAt: string } | null;
}

export interface GameSummary {
  winner: { id: string | null; isTie: boolean; name: string | null; color: string | null };
  scores: { teamId: string; name: string; color: string; claimed: number; locked: number }[];
  tags: { teamId: string; given: number; received: number }[];
  landmarks: GameSummaryLandmark[];
}
