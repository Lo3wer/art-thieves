import { Router } from 'express';
import { store } from '../data/store';
import { AppError } from '../middleware/errorHandler';
import {
  validate,
  createGameSchema,
  joinGameSchema,
  claimSchema,
  challengeSchema,
  tagSchema,
  pushTokenSchema,
  configUpdateSchema,
  photoMetadataSchema,
} from '../middleware/validation';
import { isWithinVicinity, computeScoreboard, computeWinner, checkWinCondition, getActiveElapsedMs } from '../game/logic';
import { scheduleGameEnd, cancelGameEnd } from '../game/timer';
import { decorateLandmarkStates, startChallengeForClaim, resolveChallengeForTeam } from '../game/challenges';
import { broadcastState, broadcastToGame } from '../socket/broadcast';
import { photoUpload } from '../middleware/upload';

const FREEZE_DURATION_MS = 10 * 60 * 1000;

const router = Router();

function p(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] : v ?? '';
}

// Maps
router.get('/maps', (_req, res) => {
  const maps = store.getMaps().map((m) => {
    const features = (m.data as any)?.features ?? [];
    return {
      id: m.id,
      name: m.name,
      center: { lat: m.centerLat, lng: m.centerLng },
      defaultZoom: m.defaultZoom,
      defaultVicinityRadius: m.defaultVicinityRadius,
      winThreshold: m.winThreshold,
      createdAt: m.createdAt,
      landmarkCount: features.filter((f: any) => f.properties?.type === 'landmark').length,
    };
  });
  res.json(maps);
});

router.get('/maps/:id', (req, res) => {
  const map = store.getMap(p(req.params.id));
  if (!map) throw new AppError(404, 'Map not found');
  const { centerLat, centerLng, ...rest } = map;
  res.json({ ...rest, center: { lat: centerLat, lng: centerLng } });
});

// Games
router.get('/games/:id', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const gameTeams = store.getTeamsByGame(game.id);
  const gameLandmarks = store.getLandmarksByGame(game.id);
  res.json({
    ...game,
    teams: gameTeams,
    landmarks: gameLandmarks,
    landmarkStates: decorateLandmarkStates(game.id),
    penalties: store.getPenaltiesByGame(game.id),
  });
});

router.post('/games', validate(createGameSchema), (req, res) => {
  const { mapId, config } = req.body;
  const map = store.getMap(mapId);
  if (!map) throw new AppError(404, 'Map not found');
  const game = store.createGame(mapId, config);
  const landmarkData = (map.data as any).features
    ?.filter((f: any) => f.properties?.type === 'landmark')
    .map((f: any, i: number) => ({
      name: f.properties?.name ?? `Landmark ${i + 1}`,
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0],
      imageUrl: f.properties?.imageUrl,
      challengeText: f.properties?.challengeText,
      challenge: f.properties?.challenge,
      mapLandmarkIndex: i,
    }));
  if (landmarkData) {
    store.addLandmarks(game.id, landmarkData);
  }
  store.addLogEntry(game.id, 'game_created', { mapName: map.name });
  res.status(201).json({
    ...game,
    teams: [],
    landmarks: store.getLandmarksByGame(game.id),
    landmarkStates: [],
    penalties: [],
  });
});

router.get('/games/lookup/:joinCode', (req, res) => {
  const game = store.getGameByJoinCode(p(req.params.joinCode));
  if (!game) throw new AppError(404, 'Game not found');
  res.json({
    id: game.id,
    status: game.status,
    teams: store.getTeamsByGame(game.id).map((t) => ({ id: t.id, name: t.name, color: t.color })),
  });
});

router.post('/games/join/:joinCode', validate(joinGameSchema), (req, res) => {
  const game = store.getGameByJoinCode(p(req.params.joinCode));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'lobby') throw new AppError(400, 'Game already started');
  try {
    const team = store.addTeam(game.id, req.body.name, req.body.color);
    store.addLogEntry(game.id, 'team_joined', { teamId: team.id, teamName: team.name });
    res.status(201).json({
      game: {
        ...game,
        teams: store.getTeamsByGame(game.id),
        landmarks: store.getLandmarksByGame(game.id),
        landmarkStates: decorateLandmarkStates(game.id),
        penalties: store.getPenaltiesByGame(game.id),
      },
      team,
    });
  } catch (err: any) {
    const existing = store.getTeamsByGame(game.id).map((t) => ({ name: t.name, color: t.color }));
    throw new AppError(409, err.message, { existing });
  }
});

router.post('/games/:id/start', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const updated = store.updateGame(game.id, {
    status: 'active',
    startedAt: new Date().toISOString(),
  });
  store.addLogEntry(game.id, 'game_started', {});
  scheduleGameEnd(game.id);
  broadcastState(game.id);
  res.json(updated);
});

router.put('/games/:id/config', validate(configUpdateSchema), (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const updated = store.updateGame(game.id, {
    config: { ...game.config, ...req.body },
  });
  res.json(updated);
});

router.put('/games/:id/pause', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'active') throw new AppError(400, 'Game is not active');
  store.updateGame(game.id, { status: 'paused', pausedAt: new Date().toISOString() });
  cancelGameEnd(game.id);
  store.addLogEntry(game.id, 'game_paused', {});
  broadcastToGame(game.id, 'game_paused', {});
  broadcastState(game.id);
  res.json({ status: 'paused' });
});

router.put('/games/:id/resume', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'paused') throw new AppError(400, 'Game is not paused');
  const pausedMs = game.pausedAt ? Date.now() - new Date(game.pausedAt).getTime() : 0;
  store.updateGame(game.id, {
    status: 'active',
    pausedAt: undefined,
    totalPausedMs: game.totalPausedMs + pausedMs,
  });
  store.addLogEntry(game.id, 'game_resumed', {});
  scheduleGameEnd(game.id);
  broadcastToGame(game.id, 'game_resumed', {});
  broadcastState(game.id);
  res.json({ status: 'active' });
});

router.put('/games/:id/end', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const teams = store.getTeamsByGame(game.id);
  const states = store.getLandmarkStates(game.id);
  const scores = computeScoreboard(teams, states);
  const result = computeWinner(scores);
  store.updateGame(game.id, { status: 'ended' });
  cancelGameEnd(game.id);
  store.addLogEntry(game.id, 'game_ended', result);
  broadcastToGame(game.id, 'game_ended', { ...result, scores });
  broadcastState(game.id);
  res.json({ ...result, scores });
});

function isTeamFrozen(gameId: string, teamId: string): boolean {
  const activeTag = store.getActiveTag(gameId, teamId);
  if (!activeTag) return false;
  const elapsed = Date.now() - new Date(activeTag.timestamp).getTime();
  return elapsed < FREEZE_DURATION_MS;
}

function getFrozenTeams(gameId: string): { teamId: string; frozenUntil: string }[] {
  const teams = store.getTeamsByGame(gameId);
  const frozen: { teamId: string; frozenUntil: string }[] = [];
  for (const team of teams) {
    const tag = store.getActiveTag(gameId, team.id);
    if (tag) {
      const elapsed = Date.now() - new Date(tag.timestamp).getTime();
      if (elapsed < FREEZE_DURATION_MS) {
        frozen.push({ teamId: team.id, frozenUntil: new Date(new Date(tag.timestamp).getTime() + FREEZE_DURATION_MS).toISOString() });
      }
    }
  }
  return frozen;
}

function checkWinAndEnd(gameId: string): void {
  const game = store.getGame(gameId);
  if (!game) return;
  const teams = store.getTeamsByGame(gameId);
  const states = store.getLandmarkStates(gameId);
  const scores = computeScoreboard(teams, states);
  const win = checkWinCondition(scores.map((s) => ({ teamId: s.teamId, claimed: s.claimed })), game.config.winThreshold);
  if (win.winner) {
    store.updateGame(gameId, { status: 'ended' });
    cancelGameEnd(gameId);
    store.addLogEntry(gameId, 'game_ended', { winnerId: win.winner });
    broadcastToGame(gameId, 'game_ended', win);
  }
}

// Claim & challenge
router.post('/games/:id/claim', validate(claimSchema), (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'active') throw new AppError(400, 'Game is not active');
  const { landmarkId, teamId, latitude, longitude } = req.body;
  if (!teamId) throw new AppError(400, 'teamId is required');
  if (isTeamFrozen(game.id, teamId)) throw new AppError(400, 'Your team is frozen');

  const landmark = store.getLandmarksByGame(game.id).find((l) => l.id === landmarkId);
  if (!landmark) throw new AppError(404, 'Landmark not found');
  if (!isWithinVicinity(latitude, longitude, landmark.latitude, landmark.longitude, game.config.vicinityRadius)) {
    throw new AppError(400, 'Too far from landmark');
  }

  const existing = store.getLandmarkStates(game.id).find((s) => s.landmarkId === landmarkId);
  if (existing?.locked) throw new AppError(400, 'Landmark is locked');
  if (existing?.teamId === teamId) throw new AppError(400, 'Already claimed by your team');

  const isSteal = existing?.teamId != null && existing.teamId !== teamId;
  let photo: { id: string; url: string } | null = null;
  if (req.body.photoId) {
    const p = store.getPhoto(req.body.photoId);
    if (p?.gameId !== game.id) throw new AppError(400, 'Invalid photo for this game');
    photo = { id: p.id, url: p.url };
  }
  store.upsertLandmarkState(game.id, landmarkId, teamId, false, photo?.id);
  startChallengeForClaim(game.id, landmarkId, teamId, landmark.challenge ?? null);
  store.addLogEntry(game.id, isSteal ? 'landmark_stolen' : 'landmark_claimed', {
    landmarkId, teamId, fromTeamId: existing?.teamId,
    latitude, longitude,
    ...(photo ? { photoId: photo.id, photoUrl: photo.url } : {}),
  });
  checkWinAndEnd(game.id);
  broadcastState(game.id);
  const state = store.getLandmarkStates(game.id).find((s) => s.landmarkId === landmarkId);
  res.json(state);
});

router.post('/games/:id/challenge', validate(challengeSchema), (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'active') throw new AppError(400, 'Game is not active');
  const { landmarkId, outcome, teamId, photoId } = req.body;
  if (isTeamFrozen(game.id, teamId)) throw new AppError(400, 'Your team is frozen');

  const result = resolveChallengeForTeam({
    gameId: game.id,
    landmarkId,
    teamId,
    outcome,
    latitude: req.body.latitude ?? 0,
    longitude: req.body.longitude ?? 0,
    photoId,
  });

  store.addLogEntry(game.id, `challenge_${outcome}`, { landmarkId, teamId });
  for (const voidedTeamId of result.voidedTeams) {
    const vt = store.getTeam(voidedTeamId);
    store.addLogEntry(game.id, 'challenge_voided', {
      landmarkId, teamId: voidedTeamId, byTeamId: teamId,
      teamName: vt?.name ?? 'Unknown',
    });
  }
  checkWinAndEnd(game.id);
  broadcastState(game.id);
  res.json({
    outcome,
    penaltyUntil: result.penaltyUntil ?? null,
    penaltyType: result.penaltyType ?? null,
  });
});

// Tag
router.post('/games/:id/tag', validate(tagSchema), (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'active') throw new AppError(400, 'Game is not active');
  const { targetTeamId, teamId } = req.body;
  if (teamId === targetTeamId) throw new AppError(400, 'Cannot tag yourself');
  if (isTeamFrozen(game.id, teamId)) throw new AppError(400, 'Your team is frozen');

  const activeElapsed = getActiveElapsedMs(game.startedAt, game.totalPausedMs, game.pausedAt, game.status);
  if (activeElapsed < game.config.noTagPeriod * 1000) throw new AppError(400, `Tagging is disabled for the first ${game.config.noTagPeriod} seconds`);

  const recentTags = store.getTagsByGame(game.id).filter(
    (t) => t.taggerTeamId === teamId && t.targetTeamId === targetTeamId && !t.voided
  );
  for (const tag of recentTags) {
    const elapsed = Date.now() - new Date(tag.timestamp).getTime();
    if (elapsed < game.config.reTagCooldown * 1000) throw new AppError(400, 'Re-tag cooldown active');
  }

  const tag = store.addTagEvent(game.id, teamId, targetTeamId);
  const taggerTeam = store.getTeam(teamId);
  const targetTeam = store.getTeam(targetTeamId);
  store.addLogEntry(game.id, 'tag_created', {
    taggerTeamId: teamId,
    targetTeamId,
    taggerName: taggerTeam?.name ?? 'Unknown',
    targetName: targetTeam?.name ?? 'Unknown',
  });
  broadcastToGame(game.id, 'team_frozen', {
    teamId: targetTeamId,
    tagTimestamp: tag.timestamp,
    frozenUntil: new Date(Date.now() + FREEZE_DURATION_MS).toISOString(),
  });
  broadcastState(game.id);
  res.status(201).json(tag);
});

router.post('/games/:id/dispute', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const { teamId } = req.body;
  if (!teamId) throw new AppError(400, 'teamId is required');
  const activeTag = store.getActiveTag(game.id, teamId);
  if (!activeTag) throw new AppError(404, 'No active tag to dispute');
  const elapsed = Date.now() - new Date(activeTag.timestamp).getTime();
  if (elapsed > game.config.disputeWindow * 1000) throw new AppError(400, 'Dispute window has expired');
  store.updateTagEvent(activeTag.id, { disputed: true, voided: true });
  const targetTeam = store.getTeam(teamId);
  const taggerTeam = store.getTeam(activeTag.taggerTeamId);
  store.addLogEntry(game.id, 'tag_disputed', {
    tagId: activeTag.id,
    targetTeamId: teamId,
    targetName: targetTeam?.name ?? 'Unknown',
    taggerTeamId: activeTag.taggerTeamId,
    taggerName: taggerTeam?.name ?? 'Unknown',
  });
  broadcastToGame(game.id, 'tag_disputed', { teamId, taggerTeamId: activeTag.taggerTeamId });
  broadcastState(game.id);
  res.json({ voided: true });
});

// Push tokens
router.post('/games/:id/push-token', validate(pushTokenSchema), (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  store.addPushToken(game.id, req.body.teamId ?? '', req.body.token);
  res.status(201).json({ registered: true });
});

// Summary (post-game)
router.get('/games/:id/summary', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const teams = store.getTeamsByGame(game.id);
  const states = store.getLandmarkStates(game.id);
  const landmarks = store.getLandmarksByGame(game.id);
  const tags = store.getTagsByGame(game.id);
  const scores = computeScoreboard(teams, states);
  const result = computeWinner(scores);

  const teamName = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const teamColor = Object.fromEntries(teams.map((t) => [t.id, t.color]));

  const tagsByTeam = teams.map((t) => ({
    teamId: t.id,
    given: tags.filter((x) => x.taggerTeamId === t.id && !x.voided).length,
    received: tags.filter((x) => x.targetTeamId === t.id && !x.voided).length,
  }));

  const landmarkDetails = landmarks.map((l) => {
    const st = states.find((s) => s.landmarkId === l.id);
    const session = st?.teamId ? store.getChallengeSession(game.id, l.id, st.teamId) : null;
    return {
      id: l.id,
      name: l.name,
      mapLandmarkIndex: l.mapLandmarkIndex,
      status: st ? (st.locked ? 'locked' : 'claimed') : 'unclaimed',
      teamId: st?.teamId ?? null,
      teamName: st?.teamId ? teamName[st.teamId] ?? null : null,
      claimedAt: st?.claimedAt ?? null,
      challenge: session?.outcome
        ? { outcome: session.outcome, teamId: session.teamId, createdAt: session.completedAt ?? session.startedAt }
        : null,
    };
  });

  res.json({
    winner: {
      id: result.winnerId,
      isTie: result.isTie,
      name: result.winnerId ? teamName[result.winnerId] ?? null : null,
      color: result.winnerId ? teamColor[result.winnerId] ?? null : null,
    },
    scores,
    tags: tagsByTeam,
    landmarks: landmarkDetails,
  });
});

// Scoreboard & log
router.get('/games/:id/scoreboard', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const teams = store.getTeamsByGame(game.id);
  const states = store.getLandmarkStates(game.id);
  const scores = computeScoreboard(teams, states);
  res.json(scores);
});

router.get('/games/:id/frozen-teams', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  res.json(getFrozenTeams(game.id));
});

router.get('/games/:id/log', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const teamId = req.query.teamId as string | undefined;
  const entries = store.getLog(game.id, teamId);
  res.json(entries);
});

// Photos
router.post(
  '/games/:id/photos',
  photoUpload.single('photo'),
  validate(photoMetadataSchema),
  (req, res) => {
    const game = store.getGame(p(req.params.id));
    if (!game) throw new AppError(404, 'Game not found');
    if (!req.file) throw new AppError(400, 'No file uploaded');
    const { teamId, landmarkId } = req.body;
    const landmark = store.getLandmarksByGame(game.id).find((l) => l.id === landmarkId);
    if (!landmark) throw new AppError(404, 'Landmark not found');
    const url = `/uploads/${game.id}/${req.file.filename}`;
    const photo = store.addPhoto({ gameId: game.id, teamId, landmarkId, filename: req.file.filename, url });
    res.status(201).json({ photoId: photo.id, url });
  }
);

router.get('/games/:id/photos', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  res.json(store.getPhotosByGame(game.id));
});

// Locations (post-game route replay)
router.get('/games/:id/locations', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  res.json(store.getLocationPings(game.id));
});

// Timeline (for post-game reconstruction tooling)
router.get('/games/:id/timeline', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const teams = store.getTeamsByGame(game.id);
  const states = store.getLandmarkStates(game.id);
  const scores = computeScoreboard(teams, states);
  const result = computeWinner(scores);

  const log = store.getLog(game.id);
  const events = [...log]
    .reverse()
    .map((entry) => {
      const data = (entry.data ?? {}) as Record<string, unknown>;
      return {
        timestamp: entry.timestamp,
        type: entry.type,
        teamId:
          (data.teamId as string | undefined) ??
          (data.taggerTeamId as string | undefined) ??
          (data.targetTeamId as string | undefined),
        data,
        photoUrl: data.photoUrl as string | undefined,
      };
    });

  res.json({
    game: {
      id: game.id,
      joinCode: game.joinCode,
      status: game.status,
      createdAt: game.createdAt,
    },
    scores,
    winner: { id: result.winnerId, isTie: result.isTie },
    locations: store.getLocationPings(game.id).map((l) => ({
      teamId: l.teamId,
      latitude: l.latitude,
      longitude: l.longitude,
      timestamp: l.timestamp,
    })),
    events,
  });
});

export default router;
