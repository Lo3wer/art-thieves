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

export async function buildChallengeView(
  gameId: string,
  landmarkId: string,
  teamId: string,
  spec: ChallengeSpec | null
): Promise<ChallengeView | null> {
  if (!spec) return null;
  const session = await store.getChallengeSession(gameId, landmarkId, teamId);
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

export async function hasActiveChallenge(gameId: string, teamId: string): Promise<boolean> {
  return (await store
    .getChallengeSessionsByGame(gameId))
    .some(
      (a) => a.teamId === teamId && (a.status === 'pending' || a.status === 'ready')
    );
}

export async function decorateLandmarkStates(gameId: string): Promise<NominalLandmarkState[]> {
  const specMap = new Map(
    (await store.getLandmarksByGame(gameId)).map((l) => [l.id, l.challenge ?? null] as const)
  );
  const states = await store.getLandmarkStates(gameId);
  return Promise.all(states.map(async (st) => {
    const spec = specMap.get(st.landmarkId);
    const view = st.teamId ? await buildChallengeView(gameId, st.landmarkId, st.teamId, spec ?? null) : null;
    return view ? { ...st, challenge: view } : st;
  }));
}

export interface NominalLandmarkState extends LandmarkState {
  challenge?: ChallengeView;
}

export async function startChallengeForClaim(
  gameId: string,
  landmarkId: string,
  teamId: string,
  spec: ChallengeSpec | null
): Promise<void> {
  if (!spec) return;
  if (spec.mode === 'delayed') {
    await store.startChallengeSession(gameId, landmarkId, teamId, spec.delayed?.delayMinutes);
  } else {
    await store.startChallengeSession(gameId, landmarkId, teamId);
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

export async function resolveChallengeForTeam(opts: ResolveChallengeOptions): Promise<ResolveChallengeResult> {
  const { gameId, landmarkId, teamId, outcome } = opts;

  const existing = (await store.getLandmarkStates(gameId)).find((s) => s.landmarkId === landmarkId);
  if (!existing || existing.teamId !== teamId) {
    throw new AppError(400, 'Landmark not claimed by your team');
  }
  if (existing.locked) throw new AppError(400, 'Landmark is already locked');

  const landmark = (await store.getLandmarksByGame(gameId)).find((l) => l.id === landmarkId);
  const spec = getChallengeSpec(landmark ?? null);

  let session = await store.getChallengeSession(gameId, landmarkId, teamId);
  assertNotAttempted(session);
  if (!session) {
    session = await store.startChallengeSession(gameId, landmarkId, teamId, spec?.mode === 'delayed' ? spec?.delayed?.delayMinutes : undefined);
  }

  if (session.readyAt && new Date(session.readyAt).getTime() > Date.now() && spec?.mode === 'delayed') {
      throw new AppError(400, 'This challenge is not ready yet');
    }
    if (spec && spec.mode === 'delayed' && outcome === 'complete') {
      const d = spec.delayed;
      if (d?.returnToLandmark && landmark) {
        if (!isWithinVicinity(opts.latitude, opts.longitude, landmark.latitude, landmark.longitude, (await store.getGame(gameId))?.config.vicinityRadius ?? 30)) {
          throw new AppError(400, 'You must be at the landmark to complete this challenge');
        }
      }
      if (d?.requiresPhoto) {
      if (!opts.photoId) throw new AppError(400, 'A photo is required to complete this challenge');
      const p = await store.getPhoto(opts.photoId);
      if (!p || p.gameId !== gameId) throw new AppError(400, 'Invalid photo for this challenge');
    }
  }

  let penaltyUntil: string | undefined;
  let penaltyType: Penalty['type'] | undefined;

  if (outcome === 'complete') {
    await store.upsertLandmarkState(gameId, landmarkId, teamId, true);
    if (spec?.instant?.penalty) {
      penaltyType = spec.instant.penalty.type;
      penaltyUntil = new Date(Date.now() + spec.instant.penalty.minutes * 60 * 1000).toISOString();
      await store.setPenalty(gameId, teamId, penaltyType, penaltyUntil);
    }
  }

  const resolved = await store.resolveChallengeSession(gameId, landmarkId, teamId, outcome, penaltyUntil);
  const voidedTeams = outcome === 'complete' ? await store.voidPendingChallenges(gameId, landmarkId, teamId) : [];

  return { session: resolved, voidedTeams, penaltyUntil, penaltyType };
}
