export interface GameMap {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  defaultZoom: number;
  defaultVicinityRadius: number;
  winThreshold: number;
  data: unknown;
  createdAt: string;
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
  id: string;
  gameId: string;
  landmarkId: string;
  teamId?: string;
  locked: boolean;
  claimedAt?: string;
  claimPhotoId?: string;
}

export interface ChallengeAttempt {
  id: string;
  gameId: string;
  landmarkId: string;
  teamId: string;
  outcome: 'complete' | 'fail' | 'pass';
  createdAt: string;
}

export interface LocationPing {
  id: string;
  gameId: string;
  teamId: string;
  latitude: number;
  longitude: number;
  timestamp: string;
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

export interface PushToken {
  id: string;
  gameId: string;
  teamId: string;
  token: string;
}

export interface LogEntry {
  id: string;
  gameId: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface Photo {
  id: string;
  gameId: string;
  teamId: string;
  landmarkId: string;
  filename: string;
  url: string;
  createdAt: string;
}

export interface Game {
  id: string;
  joinCode: string;
  mapId: string;
  status: 'lobby' | 'active' | 'paused' | 'ended';
  config: {
    duration: number;
    vicinityRadius: number;
    winThreshold: number;
    reTagCooldown: number;
    disputeWindow: number;
    noTagPeriod: number;
  };
  startedAt?: string;
  pausedAt?: string;
  totalPausedMs: number;
  createdAt: string;
}
