import './test-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import router from './index';
import { errorHandler } from '../middleware/errorHandler';
import { store } from '../data/store';

const app = express();
app.use(express.json());
app.use('/api', router);
app.use(errorHandler);

const CONFIG = {
  duration: 60,
  vicinityRadius: 30,
  winThreshold: 20,
  reTagCooldown: 5,
  disputeWindow: 60,
  noTagPeriod: 10,
};

async function setupGame() {
  const maps = (await request(app).get('/api/maps')).body;
  const created = await request(app)
    .post('/api/games')
    .send({ mapId: maps[0].id, config: CONFIG });
  const gameId = created.body.id;
  const host = await request(app)
    .post(`/api/games/join/${created.body.joinCode}`)
    .send({ name: 'Host', color: '#ff0000' });
  const rival = await request(app)
    .post(`/api/games/join/${created.body.joinCode}`)
    .send({ name: 'Rival', color: '#00ff00' });
  const game = (await request(app).get(`/api/games/${gameId}`)).body;
  return {
    gameId,
    hostTeamId: host.body.team.id,
    rivalTeamId: rival.body.team.id,
    landmarkId: game.landmarks[0].id as string,
  };
}

describe('host debug endpoints', () => {
  test('host can set claim holder and lock a landmark', async () => {
    const { gameId, hostTeamId, rivalTeamId, landmarkId } = await setupGame();

    const res = await request(app)
      .put(`/api/games/${gameId}/debug/landmark-state`)
      .send({ teamId: hostTeamId, landmarkId, holderTeamId: rivalTeamId, locked: true });
    assert.equal(res.status, 200);

    const state = (await request(app).get(`/api/games/${gameId}`)).body.landmarkStates.find(
      (s: any) => s.landmarkId === landmarkId
    );
    assert.equal(state.teamId, rivalTeamId);
    assert.equal(state.locked, true);

    const log = (await request(app).get(`/api/games/${gameId}/log`)).body;
    assert.ok(log.some((e: any) => e.type === 'debug_adjusted' && e.data.kind === 'landmark-state'));
  });

  test('host can clear a claim entirely', async () => {
    const { gameId, hostTeamId, landmarkId } = await setupGame();
    await request(app)
      .put(`/api/games/${gameId}/debug/landmark-state`)
      .send({ teamId: hostTeamId, landmarkId, holderTeamId: hostTeamId, locked: false });

    const res = await request(app)
      .put(`/api/games/${gameId}/debug/landmark-state`)
      .send({ teamId: hostTeamId, landmarkId, holderTeamId: null, locked: false });
    assert.equal(res.status, 200);

    const states = (await request(app).get(`/api/games/${gameId}`)).body.landmarkStates;
    assert.ok(!states.some((s: any) => s.landmarkId === landmarkId));
  });

  test('host can clear and re-open a challenge attempt', async () => {
    const { gameId, hostTeamId, landmarkId } = await setupGame();
    const session = store.startChallengeSession(gameId, landmarkId, hostTeamId);
    store.resolveChallengeSession(gameId, landmarkId, hostTeamId, 'fail');
    assert.equal(store.getChallengeSession(gameId, landmarkId, hostTeamId)?.status, 'fail');

    const clear = await request(app)
      .put(`/api/games/${gameId}/debug/challenge-attempt`)
      .send({ teamId: hostTeamId, landmarkId, targetTeamId: hostTeamId, action: 'clear-attempt' });
    assert.equal(clear.status, 200);
    assert.equal(store.getChallengeSession(gameId, landmarkId, hostTeamId), null);

    const reopen = await request(app)
      .put(`/api/games/${gameId}/debug/challenge-attempt`)
      .send({ teamId: hostTeamId, landmarkId, targetTeamId: hostTeamId, action: 'set-pending' });
    assert.equal(reopen.status, 200);
    assert.equal(store.getChallengeSession(gameId, landmarkId, hostTeamId)?.status, 'ready');
  });

  test('non-host callers get 403', async () => {
    const { gameId, rivalTeamId, landmarkId } = await setupGame();
    const res = await request(app)
      .put(`/api/games/${gameId}/debug/landmark-state`)
      .send({ teamId: rivalTeamId, landmarkId, holderTeamId: rivalTeamId, locked: false });
    assert.equal(res.status, 403);

    const res2 = await request(app)
      .put(`/api/games/${gameId}/debug/challenge-attempt`)
      .send({ teamId: rivalTeamId, landmarkId, targetTeamId: rivalTeamId, action: 'clear-attempt' });
    assert.equal(res2.status, 403);
  });
});
