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
import { isWithinVicinity, computeScoreboard, computeWinner } from '../game/logic';

const router = Router();

function p(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] : v ?? '';
}

// Maps
router.get('/maps', (_req, res) => {
  const maps = store.getMaps().map((m) => ({
    id: m.id,
    name: m.name,
    center: { lat: m.centerLat, lng: m.centerLng },
    defaultZoom: m.defaultZoom,
    defaultVicinityRadius: m.defaultVicinityRadius,
    winThreshold: m.winThreshold,
    createdAt: m.createdAt,
  }));
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

router.post('/games/join/:joinCode', validate(joinGameSchema), (req, res) => {
  const game = store.getGameByJoinCode(p(req.params.joinCode));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'lobby') throw new AppError(400, 'Game already started');
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
});

router.post('/games/:id/start', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const updated = store.updateGame(game.id, {
    status: 'active',
    startedAt: new Date().toISOString(),
  });
  store.addLogEntry(game.id, 'game_started', {});
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
  res.json({ ...result, scores });
});

// Claim & challenge
router.post('/games/:id/claim', validate(claimSchema), (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'active') throw new AppError(400, 'Game is not active');
  const state = store.upsertLandmarkState(game.id, req.body.landmarkId, req.body.teamId ?? '', false);
  store.addLogEntry(game.id, 'landmark_claimed', { landmarkId: state.landmarkId, teamId: state.teamId });
  res.json(state);
});

router.post('/games/:id/challenge', validate(challengeSchema), (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'active') throw new AppError(400, 'Game is not active');
  const { landmarkId, outcome } = req.body;
  const teamId = req.body.teamId ?? '';
  const existing = store.getChallengeAttempt(game.id, landmarkId, teamId);
  if (existing) throw new AppError(400, 'Team already attempted this challenge');
  if (outcome === 'complete') {
    store.upsertLandmarkState(game.id, landmarkId, teamId, true);
  }
  store.addChallengeAttempt(game.id, landmarkId, teamId, outcome);
  store.addLogEntry(game.id, `challenge_${outcome}`, { landmarkId, teamId });
  res.json({ outcome });
});

// Tag
router.post('/games/:id/tag', validate(tagSchema), (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'active') throw new AppError(400, 'Game is not active');
  const tag = store.addTagEvent(game.id, req.body.taggerTeamId ?? '', req.body.targetTeamId);
  store.addLogEntry(game.id, 'tag_created', { tagger: tag.taggerTeamId, target: tag.targetTeamId });
  res.status(201).json(tag);
});

router.post('/games/:id/dispute', (req, res) => {
  const game = store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const activeTag = store.getActiveTag(game.id, req.body.teamId ?? '');
  if (!activeTag) throw new AppError(404, 'No active tag to dispute');
  store.updateTagEvent(activeTag.id, { disputed: true, voided: true });
  store.addLogEntry(game.id, 'tag_disputed', { tagId: activeTag.id });
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
