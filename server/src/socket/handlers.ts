import { Server, Socket } from 'socket.io';
import { store } from '../data/store';
import { isWithinVicinity, computeScoreboard, computeWinner, checkWinCondition, getActiveElapsedMs } from '../game/logic';
import { broadcastState, seedSnapshot } from './broadcast';

const FREEZE_MS = 10 * 60 * 1000;

function getFrozenUntil(): string {
  return new Date(Date.now() + FREEZE_MS).toISOString();
}

export function registerGameHandlers(io: Server): void {
  const gameNsp = io.of('/game');

  gameNsp.on('connection', (socket: Socket) => {
    let currentGameId: string | null = null;
    let currentTeamId: string | null = null;

    socket.on('join_game', ({ gameId, teamId }: { gameId: string; teamId: string }) => {
      currentGameId = gameId;
      currentTeamId = teamId;
      socket.join(`game:${gameId}`);
      const game = store.getGame(gameId);
      if (game) {
        socket.emit('state_update', {
          game: {
            ...game,
            teams: store.getTeamsByGame(gameId),
            landmarks: store.getLandmarksByGame(gameId),
            landmarkStates: store.getLandmarkStates(gameId),
          },
        });
        seedSnapshot(gameId);
      }
    });

    socket.on('location_update', ({ latitude, longitude }: { latitude: number; longitude: number }) => {
      if (!currentGameId || !currentTeamId) return;
      store.addLocationPing(currentGameId, currentTeamId, latitude, longitude);
      socket.to(`game:${currentGameId}`).emit('location_broadcast', {
        teamId: currentTeamId,
        latitude,
        longitude,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('claim_landmark', ({ landmarkId, latitude, longitude }: { landmarkId: string; latitude: number; longitude: number }) => {
      if (!currentGameId || !currentTeamId) return;
      try { processClaim(currentGameId, currentTeamId, landmarkId, latitude, longitude, socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('complete_challenge', ({ landmarkId }: { landmarkId: string }) => {
      if (!currentGameId || !currentTeamId) return;
      try { processChallenge(currentGameId, currentTeamId, landmarkId, 'complete', socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('fail_challenge', ({ landmarkId }: { landmarkId: string }) => {
      if (!currentGameId || !currentTeamId) return;
      try { processChallenge(currentGameId, currentTeamId, landmarkId, 'fail', socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('pass_challenge', ({ landmarkId }: { landmarkId: string }) => {
      if (!currentGameId || !currentTeamId) return;
      try { processChallenge(currentGameId, currentTeamId, landmarkId, 'pass', socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('tag_team', ({ targetTeamId }: { targetTeamId: string }) => {
      if (!currentGameId || !currentTeamId) return;
      try { processTag(currentGameId, currentTeamId, targetTeamId, socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('dispute_tag', () => {
      if (!currentGameId || !currentTeamId) return;
      try { processDispute(currentGameId, currentTeamId, socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('pause_game', () => {
      if (!currentGameId) return;
      try { processPause(currentGameId, socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('resume_game', () => {
      if (!currentGameId) return;
      try { processResume(currentGameId, socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('end_game', () => {
      if (!currentGameId) return;
      try { processEnd(currentGameId, socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('disconnect', () => {});
  });
}

function getGameOrThrow(gameId: string): NonNullable<ReturnType<typeof store.getGame>> {
  const game = store.getGame(gameId);
  if (!game) throw new Error('Game not found');
  return game;
}

function isTeamFrozen(gameId: string, teamId: string): boolean {
  const activeTag = store.getActiveTag(gameId, teamId);
  if (!activeTag) return false;
  const elapsed = Date.now() - new Date(activeTag.timestamp).getTime();
  return elapsed < FREEZE_MS;
}

function processClaim(
  gameId: string, teamId: string, landmarkId: string,
  latitude: number, longitude: number,
  socket: Socket, nsp: ReturnType<Server['of']>
): void {
  const game = getGameOrThrow(gameId);
  if (game.status !== 'active') throw new Error('Game is not active');
  if (isTeamFrozen(gameId, teamId)) throw new Error('Your team is frozen');

  const landmark = store.getLandmarksByGame(gameId).find((l) => l.id === landmarkId);
  if (!landmark) throw new Error('Landmark not found');

  if (!isWithinVicinity(latitude, longitude, landmark.latitude, landmark.longitude, game.config.vicinityRadius)) {
    throw new Error('Too far from landmark');
  }

  const existing = store.getLandmarkStates(gameId).find((s) => s.landmarkId === landmarkId);
  if (existing?.locked) throw new Error('Landmark is locked');
  if (existing?.teamId === teamId) throw new Error('Already claimed by your team');

  const isSteal = existing?.teamId != null && existing.teamId !== teamId;
  store.upsertLandmarkState(gameId, landmarkId, teamId, false);
  store.addLogEntry(gameId, isSteal ? 'landmark_stolen' : 'landmark_claimed', {
    landmarkId, teamId, fromTeamId: existing?.teamId,
  });

  const teams = store.getTeamsByGame(gameId);
  const states = store.getLandmarkStates(gameId);
  const scores = computeScoreboard(teams, states);
  const win = checkWinCondition(scores.map((s) => ({ teamId: s.teamId, claimed: s.claimed })), game.config.winThreshold);

  broadcastState(gameId);

  if (win.winner) {
    store.updateGame(gameId, { status: 'ended' });
    store.addLogEntry(gameId, 'game_ended', { winnerId: win.winner });
    nsp.to(`game:${gameId}`).emit('game_ended', { winnerId: win.winner, scores });
  }
}

function processChallenge(
  gameId: string, teamId: string, landmarkId: string,
  outcome: 'complete' | 'fail' | 'pass',
  socket: Socket, nsp: ReturnType<Server['of']>
): void {
  const game = getGameOrThrow(gameId);
  if (game.status !== 'active') throw new Error('Game is not active');
  if (isTeamFrozen(gameId, teamId)) throw new Error('Your team is frozen');

  const existing = store.getLandmarkStates(gameId).find((s) => s.landmarkId === landmarkId);
  if (!existing || existing.teamId !== teamId) throw new Error('Landmark not claimed by your team');
  if (existing.locked) throw new Error('Landmark is already locked');

  const attempted = store.getChallengeAttempt(gameId, landmarkId, teamId);
  if (attempted) throw new Error('Your team already attempted this challenge');

  if (outcome === 'complete') {
    store.upsertLandmarkState(gameId, landmarkId, teamId, true);
  }
  store.addChallengeAttempt(gameId, landmarkId, teamId, outcome);
  store.addLogEntry(gameId, `challenge_${outcome}`, { landmarkId, teamId });

  const teams = store.getTeamsByGame(gameId);
  const states = store.getLandmarkStates(gameId);
  const scores = computeScoreboard(teams, states);
  const win = checkWinCondition(scores.map((s) => ({ teamId: s.teamId, claimed: s.claimed })), game.config.winThreshold);

  broadcastState(gameId);

  if (win.winner) {
    store.updateGame(gameId, { status: 'ended' });
    store.addLogEntry(gameId, 'game_ended', { winnerId: win.winner });
    nsp.to(`game:${gameId}`).emit('game_ended', { winnerId: win.winner, scores });
  }
}

function processTag(
  gameId: string, taggerTeamId: string, targetTeamId: string,
  socket: Socket, nsp: ReturnType<Server['of']>
): void {
  const game = getGameOrThrow(gameId);
  if (game.status !== 'active') throw new Error('Game is not active');
  if (taggerTeamId === targetTeamId) throw new Error('Cannot tag yourself');
  if (isTeamFrozen(gameId, taggerTeamId)) throw new Error('Your team is frozen');

  const activeElapsed = getActiveElapsedMs(game.startedAt, game.totalPausedMs, game.pausedAt, game.status);
  if (activeElapsed < game.config.noTagPeriod * 1000) throw new Error(`Tagging is disabled for the first ${game.config.noTagPeriod} seconds`);

  const recentTags = store.getTagsByGame(gameId).filter(
    (t) => t.taggerTeamId === taggerTeamId && t.targetTeamId === targetTeamId && !t.voided
  );
  for (const tag of recentTags) {
    const elapsed = Date.now() - new Date(tag.timestamp).getTime();
    if (elapsed < game.config.reTagCooldown * 1000) throw new Error('Re-tag cooldown active');
  }

  const tag = store.addTagEvent(gameId, taggerTeamId, targetTeamId);
  const taggerTeam = store.getTeam(taggerTeamId);
  const targetTeam = store.getTeam(targetTeamId);
  store.addLogEntry(gameId, 'tag_created', {
    taggerTeamId,
    targetTeamId,
    taggerName: taggerTeam?.name ?? 'Unknown',
    targetName: targetTeam?.name ?? 'Unknown',
  });
  broadcastState(gameId);
  nsp.to(`game:${gameId}`).emit('team_frozen', {
    teamId: targetTeamId,
    tagTimestamp: tag.timestamp,
    frozenUntil: getFrozenUntil(),
  });
}

function processDispute(
  gameId: string, teamId: string,
  socket: Socket, nsp: ReturnType<Server['of']>
): void {
  const game = getGameOrThrow(gameId);
  const activeTag = store.getActiveTag(gameId, teamId);
  if (!activeTag) throw new Error('No active tag to dispute');

  const elapsed = Date.now() - new Date(activeTag.timestamp).getTime();
  if (elapsed > game.config.disputeWindow * 1000) throw new Error('Dispute window has expired');

  store.updateTagEvent(activeTag.id, { disputed: true, voided: true });
  const targetTeam = store.getTeam(teamId);
  const taggerTeam = store.getTeam(activeTag.taggerTeamId);
  store.addLogEntry(gameId, 'tag_disputed', {
    tagId: activeTag.id,
    targetTeamId: teamId,
    targetName: targetTeam?.name ?? 'Unknown',
    taggerTeamId: activeTag.taggerTeamId,
    taggerName: taggerTeam?.name ?? 'Unknown',
  });
  broadcastState(gameId);
  nsp.to(`game:${gameId}`).emit('tag_disputed', { teamId, taggerTeamId: activeTag.taggerTeamId });
}

function processPause(gameId: string, socket: Socket, nsp: ReturnType<Server['of']>): void {
  const game = getGameOrThrow(gameId);
  if (game.status !== 'active') throw new Error('Game is not active');
  store.updateGame(gameId, { status: 'paused', pausedAt: new Date().toISOString() });
  store.addLogEntry(gameId, 'game_paused', {});
  broadcastState(gameId);
  nsp.to(`game:${gameId}`).emit('game_paused', {});
}

function processResume(gameId: string, socket: Socket, nsp: ReturnType<Server['of']>): void {
  const game = getGameOrThrow(gameId);
  if (game.status !== 'paused') throw new Error('Game is not paused');
  const pausedMs = game.pausedAt ? Date.now() - new Date(game.pausedAt).getTime() : 0;
  store.updateGame(gameId, { status: 'active', pausedAt: undefined, totalPausedMs: game.totalPausedMs + pausedMs });
  store.addLogEntry(gameId, 'game_resumed', {});
  broadcastState(gameId);
  nsp.to(`game:${gameId}`).emit('game_resumed', {});
}

function processEnd(gameId: string, socket: Socket, nsp: ReturnType<Server['of']>): void {
  const game = getGameOrThrow(gameId);
  const teams = store.getTeamsByGame(gameId);
  const states = store.getLandmarkStates(gameId);
  const scores = computeScoreboard(teams, states);
  const result = computeWinner(scores);
  store.updateGame(gameId, { status: 'ended' });
  store.addLogEntry(gameId, 'game_ended', result);
  broadcastState(gameId);
  nsp.to(`game:${gameId}`).emit('game_ended', { ...result, scores });
}
