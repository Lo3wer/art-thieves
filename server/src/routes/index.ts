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
  debugLandmarkStateSchema,
  debugChallengeAttemptSchema,
} from '../middleware/validation';
import { isWithinVicinity, computeScoreboard, computeWinner, checkWinCondition, getActiveElapsedMs } from '../game/logic';
import { scheduleGameEnd, cancelGameEnd } from '../game/timer';
import { decorateLandmarkStates, startChallengeForClaim, resolveChallengeForTeam } from '../game/challenges';
import { isTeamFrozen, getFrozenTeams, getFrozenUntil } from '../game/freeze';
import { broadcastState, broadcastToGame } from '../socket/broadcast';
import { photoUpload } from '../middleware/upload';

const router = Router();

function p(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] : v ?? '';
}

// Maps
router.get('/maps', async (_req, res) => {
  const maps = (await store.getMaps()).map((m) => {
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

router.get('/maps/:id', async (req, res) => {
  const map = await store.getMap(p(req.params.id));
  if (!map) throw new AppError(404, 'Map not found');
  const { centerLat, centerLng, ...rest } = map;
  res.json({ ...rest, center: { lat: centerLat, lng: centerLng } });
});

// Games
router.get('/games/:id', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const gameTeams = await store.getTeamsByGame(game.id);
  const gameLandmarks = await store.getLandmarksByGame(game.id);
  res.json({
    ...game,
    teams: gameTeams,
    landmarks: gameLandmarks,
    landmarkStates: await decorateLandmarkStates(game.id),
    penalties: await store.getPenaltiesByGame(game.id),
  });
});

router.post('/games', validate(createGameSchema), async (req, res) => {
  const { mapId, config } = req.body;
  const map = await store.getMap(mapId);
  if (!map) throw new AppError(404, 'Map not found');
  const game = await store.createGame(mapId, config);
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
    await store.addLandmarks(game.id, landmarkData);
  }
  await store.addLogEntry(game.id, 'game_created', { mapName: map.name });
  res.status(201).json({
    ...game,
    teams: [],
    landmarks: await store.getLandmarksByGame(game.id),
    landmarkStates: [],
    penalties: [],
  });
});

router.get('/games/lookup/:joinCode', async (req, res) => {
  const game = await store.getGameByJoinCode(p(req.params.joinCode));
  if (!game) throw new AppError(404, 'Game not found');
  res.json({
    id: game.id,
    status: game.status,
    teams: (await store.getTeamsByGame(game.id)).map((t) => ({ id: t.id, name: t.name, color: t.color })),
  });
});

router.post('/games/join/:joinCode', validate(joinGameSchema), async (req, res) => {
  const game = await store.getGameByJoinCode(p(req.params.joinCode));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'lobby') throw new AppError(400, 'Game already started');
  try {
    const wasEmpty = (await store.getTeamsByGame(game.id)).length === 0;
    const team = await store.addTeam(game.id, req.body.name, req.body.color);
    if (wasEmpty) {
      await store.updateGame(game.id, { hostTeamId: team.id });
    }
    const freshGame = (await store.getGame(game.id))!;
    await store.addLogEntry(game.id, 'team_joined', { teamId: team.id, teamName: team.name });
    res.status(201).json({
      game: {
        ...freshGame,
        teams: await store.getTeamsByGame(game.id),
        landmarks: await store.getLandmarksByGame(game.id),
        landmarkStates: await decorateLandmarkStates(game.id),
        penalties: await store.getPenaltiesByGame(game.id),
      },
      team,
    });
  } catch (err: any) {
    const existing = (await store.getTeamsByGame(game.id)).map((t) => ({ name: t.name, color: t.color }));
    throw new AppError(409, err.message, { existing });
  }
});

router.post('/games/:id/rejoin', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const teamId = typeof req.body?.teamId === 'string' ? req.body.teamId : '';
  const team = await store.getTeam(teamId);
  if (!team || team.gameId !== game.id) throw new AppError(400, 'Invalid team for this game');
  res.json({
    game: {
      ...game,
        teams: await store.getTeamsByGame(game.id),
        landmarks: await store.getLandmarksByGame(game.id),
        landmarkStates: await decorateLandmarkStates(game.id),
        penalties: await store.getPenaltiesByGame(game.id),
    },
    team,
    isHost: game.hostTeamId === team.id,
  });
});

router.post('/games/:id/kick', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const targetTeamId = typeof req.body?.teamId === 'string' ? req.body.teamId : '';
  const hostTeamId = typeof req.body?.hostTeamId === 'string' ? req.body.hostTeamId : '';
  if (game.hostTeamId && hostTeamId && hostTeamId !== game.hostTeamId) {
    throw new AppError(403, 'Only the host can kick players');
  }
  const target = await store.getTeam(targetTeamId);
  if (!target || target.gameId !== game.id) throw new AppError(404, 'Team not found');
  broadcastToGame(game.id, 'team_kicked', { teamId: targetTeamId });
  await store.addLogEntry(game.id, 'team_kicked', { teamId: targetTeamId, teamName: target.name });
  res.json({ ok: true });
});

router.post('/games/:id/start', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const updated = await store.updateGame(game.id, {
    status: 'active',
    startedAt: new Date().toISOString(),
  });
  await store.addLogEntry(game.id, 'game_started', {});
  await scheduleGameEnd(game.id);
  await broadcastState(game.id);
  res.json(updated);
});

router.put('/games/:id/config', validate(configUpdateSchema), async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const updated = await store.updateGame(game.id, {
    config: { ...game.config, ...req.body },
  });
  res.json(updated);
});

router.put('/games/:id/pause', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'active') throw new AppError(400, 'Game is not active');
  await store.updateGame(game.id, { status: 'paused', pausedAt: new Date().toISOString() });
  cancelGameEnd(game.id);
  await store.addLogEntry(game.id, 'game_paused', {});
  broadcastToGame(game.id, 'game_paused', {});
  await broadcastState(game.id);
  res.json({ status: 'paused' });
});

router.put('/games/:id/resume', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'paused') throw new AppError(400, 'Game is not paused');
  const pausedMs = game.pausedAt ? Date.now() - new Date(game.pausedAt).getTime() : 0;
  await store.updateGame(game.id, {
    status: 'active',
    pausedAt: undefined,
    totalPausedMs: game.totalPausedMs + pausedMs,
  });
  await store.addLogEntry(game.id, 'game_resumed', {});
  await scheduleGameEnd(game.id);
  broadcastToGame(game.id, 'game_resumed', {});
  await broadcastState(game.id);
  res.json({ status: 'active' });
});

router.put('/games/:id/end', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const teams = await store.getTeamsByGame(game.id);
  const states = await store.getLandmarkStates(game.id);
  const scores = computeScoreboard(teams, states);
  const result = computeWinner(scores);
  await store.updateGame(game.id, { status: 'ended' });
  cancelGameEnd(game.id);
  await store.addLogEntry(game.id, 'game_ended', result);
  broadcastToGame(game.id, 'game_ended', { ...result, scores });
  await broadcastState(game.id);
  res.json({ ...result, scores });
});

async function checkWinAndEnd(gameId: string): Promise<void> {
  const game = await store.getGame(gameId);
  if (!game) return;
  const teams = await store.getTeamsByGame(gameId);
  const states = await store.getLandmarkStates(gameId);
  const scores = computeScoreboard(teams, states);
  const win = checkWinCondition(scores.map((s) => ({ teamId: s.teamId, claimed: s.claimed })), game.config.winThreshold);
  if (win.winner) {
    await store.updateGame(gameId, { status: 'ended' });
    cancelGameEnd(gameId);
    await store.addLogEntry(gameId, 'game_ended', { winnerId: win.winner });
    broadcastToGame(gameId, 'game_ended', win);
  }
}

// Claim & challenge
router.post('/games/:id/claim', validate(claimSchema), async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'active') throw new AppError(400, 'Game is not active');
  const { landmarkId, teamId, latitude, longitude } = req.body;
  if (!teamId) throw new AppError(400, 'teamId is required');
  if (await isTeamFrozen(game.id, teamId)) throw new AppError(400, 'Your team is frozen');

  const landmark = (await store.getLandmarksByGame(game.id)).find((l) => l.id === landmarkId);
  if (!landmark) throw new AppError(404, 'Landmark not found');
  if (!isWithinVicinity(latitude, longitude, landmark.latitude, landmark.longitude, game.config.vicinityRadius)) {
    throw new AppError(400, 'Too far from landmark');
  }

  const existing = (await store.getLandmarkStates(game.id)).find((s) => s.landmarkId === landmarkId);
  if (existing?.locked) throw new AppError(400, 'Landmark is locked');
  if (existing?.teamId === teamId) throw new AppError(400, 'Already claimed by your team');

  const isSteal = existing?.teamId != null && existing.teamId !== teamId;
  let photo: { id: string; url: string } | null = null;
  if (req.body.photoId) {
    const p = await store.getPhoto(req.body.photoId);
    if (p?.gameId !== game.id) throw new AppError(400, 'Invalid photo for this game');
    photo = { id: p.id, url: p.url };
  }
  await store.upsertLandmarkState(game.id, landmarkId, teamId, false, photo?.id);
  await startChallengeForClaim(game.id, landmarkId, teamId, landmark.challenge ?? null);
  const team = await store.getTeam(teamId);
  const fromTeam = existing?.teamId ? await store.getTeam(existing.teamId) : null;
  await store.addLogEntry(game.id, isSteal ? 'landmark_stolen' : 'landmark_claimed', {
    landmarkId, teamId, fromTeamId: existing?.teamId,
    teamName: team?.name ?? 'Unknown',
    landmarkName: landmark.name,
    ...(existing?.teamId ? { fromTeamName: fromTeam?.name ?? 'Unknown' } : {}),
    latitude, longitude,
    ...(photo ? { photoId: photo.id, photoUrl: photo.url } : {}),
  });
  await checkWinAndEnd(game.id);
  await broadcastState(game.id);
  const state = (await store.getLandmarkStates(game.id)).find((s) => s.landmarkId === landmarkId);
  res.json(state);
});

router.post('/games/:id/challenge', validate(challengeSchema), async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'active') throw new AppError(400, 'Game is not active');
  const { landmarkId, outcome, teamId, photoId } = req.body;
  if (await isTeamFrozen(game.id, teamId)) throw new AppError(400, 'Your team is frozen');

  const result = await resolveChallengeForTeam({
    gameId: game.id,
    landmarkId,
    teamId,
    outcome,
    latitude: req.body.latitude ?? 0,
    longitude: req.body.longitude ?? 0,
    photoId,
  });

  const challengeLandmark = (await store.getLandmarksByGame(game.id)).find((l) => l.id === landmarkId);
  const team = await store.getTeam(teamId);
  await store.addLogEntry(game.id, `challenge_${outcome}`, {
    landmarkId, teamId,
    teamName: team?.name ?? 'Unknown',
    landmarkName: challengeLandmark?.name ?? 'a landmark',
  });
  for (const voidedTeamId of result.voidedTeams) {
    const vt = await store.getTeam(voidedTeamId);
    await store.addLogEntry(game.id, 'challenge_voided', {
      landmarkId, teamId: voidedTeamId, byTeamId: teamId,
      teamName: vt?.name ?? 'Unknown',
      landmarkName: challengeLandmark?.name ?? 'a landmark',
    });
  }
  await checkWinAndEnd(game.id);
  await broadcastState(game.id);
  res.json({
    outcome,
    penaltyUntil: result.penaltyUntil ?? null,
    penaltyType: result.penaltyType ?? null,
  });
});

// Tag
router.post('/games/:id/tag', validate(tagSchema), async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  if (game.status !== 'active') throw new AppError(400, 'Game is not active');
  const { targetTeamId, teamId } = req.body;
  if (teamId === targetTeamId) throw new AppError(400, 'Cannot tag yourself');
  if (await isTeamFrozen(game.id, teamId)) throw new AppError(400, 'Your team is frozen');

  const activeElapsed = getActiveElapsedMs(game.startedAt, game.totalPausedMs, game.pausedAt, game.status);
  if (activeElapsed < game.config.noTagPeriod * 1000) throw new AppError(400, `Tagging is disabled for the first ${game.config.noTagPeriod} seconds`);

  const recentTags = (await store.getTagsByGame(game.id)).filter(
    (t) => t.taggerTeamId === teamId && t.targetTeamId === targetTeamId && !t.voided
  );
  for (const tag of recentTags) {
    const elapsed = Date.now() - new Date(tag.timestamp).getTime();
    if (elapsed < game.config.reTagCooldown * 1000) throw new AppError(400, 'Re-tag cooldown active');
  }

  const tag = await store.addTagEvent(game.id, teamId, targetTeamId);
  const taggerTeam = await store.getTeam(teamId);
  const targetTeam = await store.getTeam(targetTeamId);
  await store.addLogEntry(game.id, 'tag_created', {
    taggerTeamId: teamId,
    targetTeamId,
    taggerName: taggerTeam?.name ?? 'Unknown',
    targetName: targetTeam?.name ?? 'Unknown',
  });
  broadcastToGame(game.id, 'team_frozen', {
    teamId: targetTeamId,
    tagTimestamp: tag.timestamp,
    frozenUntil: getFrozenUntil(tag.timestamp),
  });
  await broadcastState(game.id);
  res.status(201).json(tag);
});

router.post('/games/:id/dispute', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const { teamId } = req.body;
  if (!teamId) throw new AppError(400, 'teamId is required');
  const activeTag = await store.getActiveTag(game.id, teamId);
  if (!activeTag) throw new AppError(404, 'No active tag to dispute');
  const elapsed = Date.now() - new Date(activeTag.timestamp).getTime();
  if (elapsed > game.config.disputeWindow * 1000) throw new AppError(400, 'Dispute window has expired');
  await store.updateTagEvent(activeTag.id, { disputed: true, voided: true });
  const targetTeam = await store.getTeam(teamId);
  const taggerTeam = await store.getTeam(activeTag.taggerTeamId);
  await store.addLogEntry(game.id, 'tag_disputed', {
    tagId: activeTag.id,
    targetTeamId: teamId,
    targetName: targetTeam?.name ?? 'Unknown',
    taggerTeamId: activeTag.taggerTeamId,
    taggerName: taggerTeam?.name ?? 'Unknown',
  });
  broadcastToGame(game.id, 'tag_disputed', { teamId, taggerTeamId: activeTag.taggerTeamId });
  await broadcastState(game.id);
  res.json({ voided: true });
});

// Push tokens
router.post('/games/:id/push-token', validate(pushTokenSchema), async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  await store.addPushToken(game.id, req.body.teamId ?? '', req.body.token);
  res.status(201).json({ registered: true });
});

// Summary (post-game)
router.get('/games/:id/summary', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const teams = await store.getTeamsByGame(game.id);
  const states = await store.getLandmarkStates(game.id);
  const landmarks = await store.getLandmarksByGame(game.id);
  const tags = await store.getTagsByGame(game.id);
  const scores = computeScoreboard(teams, states);
  const result = computeWinner(scores);

  const teamName = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const teamColor = Object.fromEntries(teams.map((t) => [t.id, t.color]));

  const tagsByTeam = teams.map((t) => ({
    teamId: t.id,
    given: tags.filter((x) => x.taggerTeamId === t.id && !x.voided).length,
    received: tags.filter((x) => x.targetTeamId === t.id && !x.voided).length,
  }));

  const landmarkDetails = await Promise.all(landmarks.map(async (l) => {
    const st = states.find((s) => s.landmarkId === l.id);
    const session = st?.teamId ? await store.getChallengeSession(game.id, l.id, st.teamId) : null;
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
  }));

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
router.get('/games/:id/scoreboard', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const teams = await store.getTeamsByGame(game.id);
  const states = await store.getLandmarkStates(game.id);
  const scores = computeScoreboard(teams, states);
  res.json(scores);
});

router.get('/games/:id/frozen-teams', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  res.json(await getFrozenTeams(game.id));
});

router.get('/games/:id/log', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const teamId = req.query.teamId as string | undefined;
  const entries = await store.getLog(game.id, teamId);
  res.json(entries);
});

// Photos
router.post(
  '/games/:id/photos',
  photoUpload.single('photo'),
  validate(photoMetadataSchema),
  async (req, res) => {
    const game = await store.getGame(p(req.params.id));
    if (!game) throw new AppError(404, 'Game not found');
    if (!req.file) throw new AppError(400, 'No file uploaded');
    const { teamId, landmarkId, latitude, longitude } = req.body;
    const landmark = (await store.getLandmarksByGame(game.id)).find((l) => l.id === landmarkId);
    if (!landmark) throw new AppError(404, 'Landmark not found');
    const url = `/uploads/${game.id}/${req.file.filename}`;
    const photo = await store.addPhoto({
      gameId: game.id,
      teamId,
      landmarkId,
      filename: req.file.filename,
      url,
      ...(latitude !== undefined ? { latitude } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
    });
    res.status(201).json({ photoId: photo.id, url });
  }
);

router.get('/games/:id/photos', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  res.json(await store.getPhotosByGame(game.id));
});

// Locations (post-game route replay)
router.get('/games/:id/locations', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  res.json(await store.getLocationPings(game.id));
});

// Timeline (for post-game reconstruction tooling)
router.get('/games/:id/timeline', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const teams = await store.getTeamsByGame(game.id);
  const states = await store.getLandmarkStates(game.id);
  const scores = computeScoreboard(teams, states);
  const result = computeWinner(scores);

  const log = await store.getLog(game.id);
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

  const landmarks = await store.getLandmarksByGame(game.id);
  const stateByLandmark = new Map(states.map((s) => [s.landmarkId, s]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const landmarkById = new Map(landmarks.map((l) => [l.id, l]));

  const photos = (await store.getPhotosByGame(game.id)).map((p) => {
    const team = teamById.get(p.teamId);
    const landmark = landmarkById.get(p.landmarkId);
    return {
      id: p.id,
      url: p.url,
      teamId: p.teamId,
      teamName: team?.name ?? null,
      teamColor: team?.color ?? null,
      landmarkId: p.landmarkId,
      landmarkName: landmark?.name ?? null,
      latitude: p.latitude ?? landmark?.latitude ?? null,
      longitude: p.longitude ?? landmark?.longitude ?? null,
      takenAt: p.createdAt,
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
    teams: teams.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    landmarks: landmarks.map((l) => {
      const state = stateByLandmark.get(l.id);
      return {
        id: l.id,
        name: l.name,
        latitude: l.latitude,
        longitude: l.longitude,
        finalStatus: !state ? 'unclaimed' : state.locked ? 'locked' : 'claimed',
        holderTeamId: state?.teamId ?? null,
        locked: state?.locked ?? false,
        claimedAt: state?.claimedAt ?? null,
      };
    }),
    photos,
    locations: (await store.getLocationPings(game.id)).map((l) => ({
      teamId: l.teamId,
      latitude: l.latitude,
      longitude: l.longitude,
      timestamp: l.timestamp,
    })),
    events,
  });
});

// Per-team challenge attempts (lets a team see its own past attempts on
// landmarks it no longer holds; landmarkStates only embeds the holder's view)
router.get('/games/:id/challenge-attempts', async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const teamId = req.query.teamId as string | undefined;
  if (!teamId) throw new AppError(400, 'teamId query parameter is required');
  const team = await store.getTeam(teamId);
  if (!team || team.gameId !== game.id) throw new AppError(404, 'Team not found');
  const attempts = (await store.getChallengeSessionsByGame(game.id))
    .filter((a) => a.teamId === teamId)
    .map((a) => ({
      landmarkId: a.landmarkId,
      status: a.status,
      outcome: a.outcome ?? null,
      startedAt: a.startedAt,
      completedAt: a.completedAt ?? null,
    }));
  res.json({ teamId, attempts });
});

// Host debug controls: repair landmark state when something goes wrong mid-game.
function assertHost(game: NonNullable<Awaited<ReturnType<typeof store.getGame>>>, teamId: string): void {
  if (!game.hostTeamId || teamId !== game.hostTeamId) {
    throw new AppError(403, 'Only the host can use debug controls');
  }
}

router.put('/games/:id/debug/landmark-state', validate(debugLandmarkStateSchema), async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const { teamId, landmarkId, holderTeamId, locked } = req.body;
  assertHost(game, teamId);

  const landmark = (await store.getLandmarksByGame(game.id)).find((l) => l.id === landmarkId);
  if (!landmark) throw new AppError(404, 'Landmark not found');

  if (holderTeamId) {
    const holder = await store.getTeam(holderTeamId);
    if (!holder || holder.gameId !== game.id) throw new AppError(404, 'Team not found');
    await store.upsertLandmarkState(game.id, landmarkId, holderTeamId, locked);
  } else {
    await store.clearLandmarkState(game.id, landmarkId);
  }

  await store.addLogEntry(game.id, 'debug_adjusted', {
    kind: 'landmark-state',
    landmarkId,
    landmarkName: landmark.name,
    holderTeamId,
    locked,
    hostTeamId: teamId,
  });
  await broadcastState(game.id);
  res.json({ ok: true, landmarkStates: await decorateLandmarkStates(game.id) });
});

router.put('/games/:id/debug/challenge-attempt', validate(debugChallengeAttemptSchema), async (req, res) => {
  const game = await store.getGame(p(req.params.id));
  if (!game) throw new AppError(404, 'Game not found');
  const { teamId, landmarkId, targetTeamId, action } = req.body;
  assertHost(game, teamId);

  const landmark = (await store.getLandmarksByGame(game.id)).find((l) => l.id === landmarkId);
  if (!landmark) throw new AppError(404, 'Landmark not found');
  const target = await store.getTeam(targetTeamId);
  if (!target || target.gameId !== game.id) throw new AppError(404, 'Team not found');

  await store.deleteChallengeSession(game.id, landmarkId, targetTeamId);
  if (action === 'set-pending') {
    await store.startChallengeSession(game.id, landmarkId, targetTeamId);
  }

  await store.addLogEntry(game.id, 'debug_adjusted', {
    kind: 'challenge-attempt',
    action,
    landmarkId,
    landmarkName: landmark.name,
    targetTeamId,
    targetTeamName: target.name,
    hostTeamId: teamId,
  });
  await broadcastState(game.id);
  res.json({ ok: true, challenge: await store.getChallengeSession(game.id, landmarkId, targetTeamId) });
});

export default router;
