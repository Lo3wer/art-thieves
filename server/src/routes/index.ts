import { Router } from 'express';
import { store } from '../data/store';
import { AppError } from '../middleware/errorHandler';
import {
  validate,
  gameMapSchema,
  createGameSchema,
  joinGameSchema,
  claimSchema,
  challengeSchema,
  tagSchema,
  pushTokenSchema,
  configUpdateSchema,
} from '../middleware/validation';
import { isWithinVicinity, computeScoreboard, computeWinner, checkWinCondition } from '../game/logic';
import { broadcastState, broadcastToGame } from '../socket/broadcast';

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

router.post('/maps', validate(gameMapSchema), (req, res) => {
  const { center, ...rest } = req.body;
  const map = store.addMap({
    ...rest,
    centerLat: center.lat,
    centerLng: center.lng,
  });
  res.status(201).json(map);
});

// Games
router.get('/games/:id', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const gameTeams = store.getTeamsByGame(game.id);
  const gameLandmarks = store.getLandmarksByGame(game.id);
  const gameStates = store.getLandmarkStates(game.id);
  res.json({
    ...game,
    teams: gameTeams,
    landmarks: gameLandmarks,
    landmarkStates: gameStates,
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
        landmarkStates: store.getLandmarkStates(game.id),
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
  store.addLogEntry(game.id, 'game_ended', result);
  broadcastToGame(game.id, 'game_ended', { ...result, scores });
  broadcastState(game.id);
  res.json({ ...result, scores });
});

function isTeamFrozen(gameId: string, teamId: string): boolean {
  const activeTag = store.getActiveTag(gameId, teamId);
  if (!activeTag) return false;
  const elapsed = Date.now() - new Date(activeTag.timestamp).getTime();
  return elapsed < 10 * 60 * 1000;
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
  store.upsertLandmarkState(game.id, landmarkId, teamId, false);
  store.addLogEntry(game.id, isSteal ? 'landmark_stolen' : 'landmark_claimed', {
    landmarkId, teamId, fromTeamId: existing?.teamId,
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
  const { landmarkId, outcome, teamId } = req.body;
  if (isTeamFrozen(game.id, teamId)) throw new AppError(400, 'Your team is frozen');

  const existing = store.getLandmarkStates(game.id).find((s) => s.landmarkId === landmarkId);
  if (!existing || existing.teamId !== teamId) throw new AppError(400, 'Landmark not claimed by your team');
  if (existing.locked) throw new AppError(400, 'Landmark is already locked');

  const attempted = store.getChallengeAttempt(game.id, landmarkId, teamId);
  if (attempted) throw new AppError(400, 'Team already attempted this challenge');
  if (outcome === 'complete') {
    store.upsertLandmarkState(game.id, landmarkId, teamId, true);
  }
  store.addChallengeAttempt(game.id, landmarkId, teamId, outcome);
  store.addLogEntry(game.id, `challenge_${outcome}`, { landmarkId, teamId });
  checkWinAndEnd(game.id);
  broadcastState(game.id);
  res.json({ outcome });
});

// Tag
router.post('/games/:id/tag', validate(tagSchema), (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'active') throw new AppError(400, 'Game is not active');
  const { targetTeamId, teamId } = req.body;
  if (teamId === targetTeamId) throw new AppError(400, 'Cannot tag yourself');
  if (isTeamFrozen(game.id, teamId)) throw new AppError(400, 'Your team is frozen');

  const startedAt = game.startedAt ? new Date(game.startedAt).getTime() : 0;
  if (Date.now() - startedAt < 10 * 60 * 1000) throw new AppError(400, 'Tagging is disabled for the first 10 minutes');

  const recentTags = store.getTagsByGame(game.id).filter(
    (t) => t.taggerTeamId === teamId && t.targetTeamId === targetTeamId && !t.voided
  );
  for (const tag of recentTags) {
    const elapsed = Date.now() - new Date(tag.timestamp).getTime();
    if (elapsed < game.config.reTagCooldown * 1000) throw new AppError(400, 'Re-tag cooldown active');
  }

  const tag = store.addTagEvent(game.id, teamId, targetTeamId);
  store.addLogEntry(game.id, 'tag_created', { tagger: tag.taggerTeamId, target: tag.targetTeamId });
  broadcastToGame(game.id, 'team_frozen', { teamId: targetTeamId });
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
  store.addLogEntry(game.id, 'tag_disputed', { tagId: activeTag.id });
  broadcastToGame(game.id, 'tag_disputed', { teamId });
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

// Scoreboard & log
router.get('/games/:id/scoreboard', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const teams = store.getTeamsByGame(game.id);
  const states = store.getLandmarkStates(game.id);
  const scores = computeScoreboard(teams, states);
  res.json(scores);
});

router.get('/games/:id/log', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const teamId = req.query.teamId as string | undefined;
  const entries = store.getLog(game.id, teamId);
  res.json(entries);
});

export default router;
