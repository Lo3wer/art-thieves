import { Server, Socket } from 'socket.io';
import { store } from '../data/store';
import { isWithinVicinity, computeScoreboard, computeWinner, checkWinCondition, getActiveElapsedMs } from '../game/logic';
import { startChallengeForClaim, resolveChallengeForTeam, hasActiveChallenge } from '../game/challenges';
import { scheduleGameEnd, cancelGameEnd } from '../game/timer';
import { broadcastState, seedSnapshot, buildRoomState } from './broadcast';
import { isTeamFrozen, getFrozenUntil } from '../game/freeze';

export function registerGameHandlers(io: Server): void {
  const gameNsp = io.of('/game');

  gameNsp.on('connection', (socket: Socket) => {
    let currentGameId: string | null = null;
    let currentTeamId: string | null = null;

    socket.on('join_game', async ({ gameId, teamId }: { gameId: string; teamId: string }) => {
      currentGameId = gameId;
      currentTeamId = teamId;
      socket.data.teamId = teamId;
      socket.join(`game:${gameId}`);
      const state = await buildRoomState(gameId, teamId);
      if (state) {
        socket.emit('state_update', { game: state });
        await seedSnapshot(gameId);
      }
    });

    socket.on('location_update', async ({ latitude, longitude }: { latitude: number; longitude: number }) => {
      if (!currentGameId || !currentTeamId) return;
      const gameId = currentGameId;
      const senderTeamId = currentTeamId;
      await store.addLocationPing(gameId, senderTeamId, latitude, longitude);
      const room = `game:${gameId}`;
      const payload = {
        teamId: senderTeamId,
        latitude,
        longitude,
        timestamp: new Date().toISOString(),
      };
      // Teams with an in-progress challenge only receive their own team's locations
      void (async () => {
        const sockets = await gameNsp.in(room).fetchSockets();
        for (const recipient of sockets) {
          if (recipient.id === socket.id) continue;
          const recipientTeamId = recipient.data?.teamId as string | undefined;
          if (
            recipientTeamId &&
            recipientTeamId !== senderTeamId &&
            await hasActiveChallenge(gameId, recipientTeamId)
          ) {
            continue;
          }
          recipient.emit('location_broadcast', payload);
        }
      })();
    });

    socket.on('claim_landmark', async ({ landmarkId, latitude, longitude }: { landmarkId: string; latitude: number; longitude: number }) => {
      if (!currentGameId || !currentTeamId) return;
      try { await processClaim(currentGameId, currentTeamId, landmarkId, latitude, longitude, socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('complete_challenge', async ({ landmarkId }: { landmarkId: string }) => {
      if (!currentGameId || !currentTeamId) return;
      try { await processChallenge(currentGameId, currentTeamId, landmarkId, 'complete', socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('fail_challenge', async ({ landmarkId }: { landmarkId: string }) => {
      if (!currentGameId || !currentTeamId) return;
      try { await processChallenge(currentGameId, currentTeamId, landmarkId, 'fail', socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('pass_challenge', async ({ landmarkId }: { landmarkId: string }) => {
      if (!currentGameId || !currentTeamId) return;
      try { await processChallenge(currentGameId, currentTeamId, landmarkId, 'pass', socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('tag_team', async ({ targetTeamId }: { targetTeamId: string }) => {
      if (!currentGameId || !currentTeamId) return;
      try { await processTag(currentGameId, currentTeamId, targetTeamId, socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('dispute_tag', async () => {
      if (!currentGameId || !currentTeamId) return;
      try { await processDispute(currentGameId, currentTeamId, socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('pause_game', async () => {
      if (!currentGameId) return;
      try { await processPause(currentGameId, socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('resume_game', async () => {
      if (!currentGameId) return;
      try { await processResume(currentGameId, socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('end_game', async () => {
      if (!currentGameId) return;
      try { await processEnd(currentGameId, socket, gameNsp); }
      catch (e: any) { socket.emit('error', { message: e.message }); }
    });

    socket.on('disconnect', () => {});
  });
}

async function getGameOrThrow(gameId: string): Promise<NonNullable<Awaited<ReturnType<typeof store.getGame>>>> {
  const game = await store.getGame(gameId);
  if (!game) throw new Error('Game not found');
  return game;
}

async function processClaim(
  gameId: string, teamId: string, landmarkId: string,
  latitude: number, longitude: number,
  socket: Socket, nsp: ReturnType<Server['of']>
): Promise<void> {
  const game = await getGameOrThrow(gameId);
  if (game.status !== 'active') throw new Error('Game is not active');
  if (await isTeamFrozen(gameId, teamId)) throw new Error('Your team is frozen');

  const landmark = (await store.getLandmarksByGame(gameId)).find((l) => l.id === landmarkId);
  if (!landmark) throw new Error('Landmark not found');

  if (!isWithinVicinity(latitude, longitude, landmark.latitude, landmark.longitude, game.config.vicinityRadius)) {
    throw new Error('Too far from landmark');
  }

  const existing = (await store.getLandmarkStates(gameId)).find((s) => s.landmarkId === landmarkId);
  if (existing?.locked) throw new Error('Landmark is locked');
  if (existing?.teamId === teamId) throw new Error('Already claimed by your team');

  const isSteal = existing?.teamId != null && existing.teamId !== teamId;
  await store.upsertLandmarkState(gameId, landmarkId, teamId, false);
  await startChallengeForClaim(gameId, landmarkId, teamId, landmark.challenge ?? null);
  const team = await store.getTeam(teamId);
  const fromTeam = existing?.teamId ? await store.getTeam(existing.teamId) : null;
  await store.addLogEntry(gameId, isSteal ? 'landmark_stolen' : 'landmark_claimed', {
    landmarkId, teamId, fromTeamId: existing?.teamId,
    teamName: team?.name ?? 'Unknown',
    landmarkName: landmark.name,
    ...(existing?.teamId ? { fromTeamName: fromTeam?.name ?? 'Unknown' } : {}),
  });

  const teams = await store.getTeamsByGame(gameId);
  const states = await store.getLandmarkStates(gameId);
  const scores = computeScoreboard(teams, states);
  const win = checkWinCondition(scores.map((s) => ({ teamId: s.teamId, claimed: s.claimed })), game.config.winThreshold);

  await broadcastState(gameId);

  if (win.winner) {
    await store.updateGame(gameId, { status: 'ended' });
    cancelGameEnd(gameId);
    await store.addLogEntry(gameId, 'game_ended', { winnerId: win.winner });
    nsp.to(`game:${gameId}`).emit('game_ended', { winnerId: win.winner, scores });
  }
}

async function processChallenge(
  gameId: string, teamId: string, landmarkId: string,
  outcome: 'complete' | 'fail' | 'pass',
  socket: Socket, nsp: ReturnType<Server['of']>
): Promise<void> {
  const game = await getGameOrThrow(gameId);
  if (game.status !== 'active') throw new Error('Game is not active');
  if (await isTeamFrozen(gameId, teamId)) throw new Error('Your team is frozen');

  const landmark = (await store.getLandmarksByGame(gameId)).find((l) => l.id === landmarkId);
  let result;
  if (landmark) {
    result = await resolveChallengeForTeam({
      gameId,
      landmarkId,
      teamId,
      outcome,
      latitude: 0,
      longitude: 0,
    });
  }

  const challengeLandmark = (await store.getLandmarksByGame(gameId)).find((l) => l.id === landmarkId);
  const team = await store.getTeam(teamId);
  await store.addLogEntry(gameId, `challenge_${outcome}`, {
    landmarkId, teamId,
    teamName: team?.name ?? 'Unknown',
    landmarkName: challengeLandmark?.name ?? 'a landmark',
  });
  if (result?.voidedTeams.length) {
    for (const voidedTeamId of result.voidedTeams) {
      const vt = await store.getTeam(voidedTeamId);
      await store.addLogEntry(gameId, 'challenge_voided', {
        landmarkId, teamId: voidedTeamId, byTeamId: teamId,
        teamName: vt?.name ?? 'Unknown',
        landmarkName: challengeLandmark?.name ?? 'a landmark',
      });
    }
  }

  const teams = await store.getTeamsByGame(gameId);
  const states = await store.getLandmarkStates(gameId);
  const scores = computeScoreboard(teams, states);
  const win = checkWinCondition(scores.map((s) => ({ teamId: s.teamId, claimed: s.claimed })), game.config.winThreshold);

  await broadcastState(gameId);

  if (win.winner) {
    await store.updateGame(gameId, { status: 'ended' });
    cancelGameEnd(gameId);
    await store.addLogEntry(gameId, 'game_ended', { winnerId: win.winner });
    nsp.to(`game:${gameId}`).emit('game_ended', { winnerId: win.winner, scores });
  }
}

async function processTag(
  gameId: string, taggerTeamId: string, targetTeamId: string,
  socket: Socket, nsp: ReturnType<Server['of']>
): Promise<void> {
  const game = await getGameOrThrow(gameId);
  if (game.status !== 'active') throw new Error('Game is not active');
  if (taggerTeamId === targetTeamId) throw new Error('Cannot tag yourself');
  if (await isTeamFrozen(gameId, taggerTeamId)) throw new Error('Your team is frozen');

  const activeElapsed = getActiveElapsedMs(game.startedAt, game.totalPausedMs, game.pausedAt, game.status);
  if (activeElapsed < game.config.noTagPeriod * 1000) throw new Error(`Tagging is disabled for the first ${game.config.noTagPeriod} seconds`);

  const recentTags = (await store.getTagsByGame(gameId)).filter(
    (t) => t.taggerTeamId === taggerTeamId && t.targetTeamId === targetTeamId && !t.voided
  );
  for (const tag of recentTags) {
    const elapsed = Date.now() - new Date(tag.timestamp).getTime();
    if (elapsed < game.config.reTagCooldown * 1000) throw new Error('Re-tag cooldown active');
  }

  const tag = await store.addTagEvent(gameId, taggerTeamId, targetTeamId);
  const taggerTeam = await store.getTeam(taggerTeamId);
  const targetTeam = await store.getTeam(targetTeamId);
  await store.addLogEntry(gameId, 'tag_created', {
    taggerTeamId,
    targetTeamId,
    taggerName: taggerTeam?.name ?? 'Unknown',
    targetName: targetTeam?.name ?? 'Unknown',
  });
  await broadcastState(gameId);
  nsp.to(`game:${gameId}`).emit('team_frozen', {
    teamId: targetTeamId,
    tagTimestamp: tag.timestamp,
    frozenUntil: getFrozenUntil(),
  });
}

async function processDispute(
  gameId: string, teamId: string,
  socket: Socket, nsp: ReturnType<Server['of']>
): Promise<void> {
  const game = await getGameOrThrow(gameId);
  const activeTag = await store.getActiveTag(gameId, teamId);
  if (!activeTag) throw new Error('No active tag to dispute');

  const elapsed = Date.now() - new Date(activeTag.timestamp).getTime();
  if (elapsed > game.config.disputeWindow * 1000) throw new Error('Dispute window has expired');

  await store.updateTagEvent(activeTag.id, { disputed: true, voided: true });
  const targetTeam = await store.getTeam(teamId);
  const taggerTeam = await store.getTeam(activeTag.taggerTeamId);
  await store.addLogEntry(gameId, 'tag_disputed', {
    tagId: activeTag.id,
    targetTeamId: teamId,
    targetName: targetTeam?.name ?? 'Unknown',
    taggerTeamId: activeTag.taggerTeamId,
    taggerName: taggerTeam?.name ?? 'Unknown',
  });
  await broadcastState(gameId);
  nsp.to(`game:${gameId}`).emit('tag_disputed', { teamId, taggerTeamId: activeTag.taggerTeamId });
}

async function processPause(gameId: string, socket: Socket, nsp: ReturnType<Server['of']>): Promise<void> {
  const game = await getGameOrThrow(gameId);
  if (game.status !== 'active') throw new Error('Game is not active');
  await store.updateGame(gameId, { status: 'paused', pausedAt: new Date().toISOString() });
  cancelGameEnd(gameId);
  await store.addLogEntry(gameId, 'game_paused', {});
  await broadcastState(gameId);
  nsp.to(`game:${gameId}`).emit('game_paused', {});
}

async function processResume(gameId: string, socket: Socket, nsp: ReturnType<Server['of']>): Promise<void> {
  const game = await getGameOrThrow(gameId);
  if (game.status !== 'paused') throw new Error('Game is not paused');
  const pausedMs = game.pausedAt ? Date.now() - new Date(game.pausedAt).getTime() : 0;
  await store.updateGame(gameId, { status: 'active', pausedAt: undefined, totalPausedMs: game.totalPausedMs + pausedMs });
  await scheduleGameEnd(gameId);
  await store.addLogEntry(gameId, 'game_resumed', {});
  await broadcastState(gameId);
  nsp.to(`game:${gameId}`).emit('game_resumed', {});
}

async function processEnd(gameId: string, socket: Socket, nsp: ReturnType<Server['of']>): Promise<void> {
  const game = await getGameOrThrow(gameId);
  const teams = await store.getTeamsByGame(gameId);
  const states = await store.getLandmarkStates(gameId);
  const scores = computeScoreboard(teams, states);
  const result = computeWinner(scores);
  await store.updateGame(gameId, { status: 'ended' });
  cancelGameEnd(gameId);
  await store.addLogEntry(gameId, 'game_ended', result);
  await broadcastState(gameId);
  nsp.to(`game:${gameId}`).emit('game_ended', { ...result, scores });
}
