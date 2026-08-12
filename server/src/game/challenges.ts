import { store } from '../data/store';
import type { ChallengeSpec, ChallengeAttempt, ChallengeStatus, ChallengeOutcome, Landmark, LandmarkState, Penalty } from '../data/types';
import { AppError } from '../middleware/errorHandler';
import { isWithinVicinity } from './logic';

export function getChallengeSpec(landmark?: Landmark | null): ChallengeSpec | null {
  if (!landmark) return null;
  return landmark.challenge ?? null;
}

export interface ChallengeView {
  status: ChallengeStatus;
  readyAt?: string;
  outcome?: ChallengeOutcome;
  penaltyUntil?: string;
}

export function effectiveStatus(session: ChallengeAttempt | null): ChallengeStatus | null {
  if (!session) return null;
  if (session.status === 'pending' && session.readyAt && new Date(session.readyAt).getTime() <= Date.now()) {
    return 'ready';
  }
  return session.status;
}

export function buildChallengeView(
  gameId: string,
  landmarkId: string,
  teamId: string,
  spec: ChallengeSpec | null
): ChallengeView | null {
  if (!spec) return null;
  const session = store.getChallengeSession(gameId, landmarkId, teamId);
  if (!session) return null;
  const status = effectiveStatus(session);
  const view: ChallengeView = { status: status ?? session.status };
  if (session.readyAt) view.readyAt = session.readyAt;
  if (session.outcome) view.outcome = session.outcome;
  if (session.penaltyUntil && new Date(session.penaltyUntil).getTime() > Date.now()) {
    view.penaltyUntil = session.penaltyUntil;
  }
  return view;
}

export function decorateLandmarkStates(gameId: string): NominalLandmarkState[] {
  const specMap = new Map(
    store.getLandmarksByGame(gameId).map((l) => [l.id, l.challenge ?? null] as const)
  );
  const states = store.getLandmarkStates(gameId);
  return states.map((st) => {
    const spec = specMap.get(st.landmarkId);
    const view = st.teamId ? buildChallengeView(gameId, st.landmarkId, st.teamId, spec ?? null) : null;
    return view ? { ...st, challenge: view } : st;
  });
}

export interface NominalLandmarkState extends LandmarkState {
  challenge?: ChallengeView;
}

export function startChallengeForClaim(
  gameId: string,
  landmarkId: string,
  teamId: string,
  spec: ChallengeSpec | null
): void {
  if (!spec) return;
  if (spec.mode === 'delayed') {
    store.startChallengeSession(gameId, landmarkId, teamId, spec.delayed?.delayMinutes);
  } else {
    store.startChallengeSession(gameId, landmarkId, teamId);
  }
}

function assertNotAttempted(session: ChallengeAttempt | null): void {
  if (!session) return;
  if (session.status === 'complete' || session.status === 'fail' || session.status === 'pass') {
    throw new AppError(400, 'Your team already attempted this challenge');
  }
  if (session.status === 'voided') {
    throw new AppError(400, 'This challenge was voided because another team locked it first');
  }
}

export interface ResolveChallengeOptions {
  gameId: string;
  landmarkId: string;
  teamId: string;
  outcome: ChallengeOutcome;
  latitude: number;
  longitude: number;
  photoId?: string;
}

export interface ResolveChallengeResult {
  session: ChallengeAttempt | null;
  voidedTeams: string[];
  penaltyUntil?: string;
  penaltyType?: Penalty['type'];
}

export function resolveChallengeForTeam(opts: ResolveChallengeOptions): ResolveChallengeResult {
  const { gameId, landmarkId, teamId, outcome } = opts;

  const existing = store.getLandmarkStates(gameId).find((s) => s.landmarkId === landmarkId);
  if (!existing || existing.teamId !== teamId) {
    throw new AppError(400, 'Landmark not claimed by your team');
  }
  if (existing.locked) throw new AppError(400, 'Landmark is already locked');

  const landmark = store.getLandmarksByGame(gameId).find((l) => l.id === landmarkId);
  const spec = getChallengeSpec(landmark ?? null);

  let session = store.getChallengeSession(gameId, landmarkId, teamId);
  assertNotAttempted(session);
  if (!session) {
    session = store.startChallengeSession(gameId, landmarkId, teamId, spec?.mode === 'delayed' ? spec?.delayed?.delayMinutes : undefined);
  }

  if (session.readyAt && new Date(session.readyAt).getTime() > Date.now() && spec?.mode === 'delayed') {
      throw new AppError(400, 'This challenge is not ready yet');
    }
    if (spec && spec.mode === 'delayed' && outcome === 'complete') {
      const d = spec.delayed;
      if (d?.returnToLandmark && landmark) {
        if (!isWithinVicinity(opts.latitude, opts.longitude, landmark.latitude, landmark.longitude, store.getGame(gameId)?.config.vicinityRadius ?? 30)) {
          throw new AppError(400, 'You must be at the landmark to complete this challenge');
        }
      }
      if (d?.requiresPhoto) {
      if (!opts.photoId) throw new AppError(400, 'A photo is required to complete this challenge');
      const p = store.getPhoto(opts.photoId);
      if (!p || p.gameId !== gameId) throw new AppError(400, 'Invalid photo for this challenge');
    }
  }

  let penaltyUntil: string | undefined;
  let penaltyType: Penalty['type'] | undefined;

  if (outcome === 'complete') {
    store.upsertLandmarkState(gameId, landmarkId, teamId, true);
    if (spec?.instant?.penalty) {
      penaltyType = spec.instant.penalty.type;
      penaltyUntil = new Date(Date.now() + spec.instant.penalty.minutes * 60 * 1000).toISOString();
      store.setPenalty(gameId, teamId, penaltyType, penaltyUntil);
    }
  }

  const resolved = store.resolveChallengeSession(gameId, landmarkId, teamId, outcome, penaltyUntil);
  const voidedTeams = outcome === 'complete' ? store.voidPendingChallenges(gameId, landmarkId, teamId) : [];

  return { session: resolved, voidedTeams, penaltyUntil, penaltyType };
}