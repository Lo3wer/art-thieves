import './test-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import router from './index';
import { errorHandler } from '../middleware/errorHandler';

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

const fakeJpeg = Buffer.from('not-really-a-jpeg');

async function setupActiveGame() {
  const maps = (await request(app).get('/api/maps')).body;
  const created = await request(app)
    .post('/api/games')
    .send({ mapId: maps[0].id, config: CONFIG });
  const gameId = created.body.id;
  const host = await request(app)
    .post(`/api/games/join/${created.body.joinCode}`)
    .send({ name: 'Alpha', color: '#ff0000' });
  const rival = await request(app)
    .post(`/api/games/join/${created.body.joinCode}`)
    .send({ name: 'Beta', color: '#00ff00' });
  await request(app).post(`/api/games/${gameId}/start`).send({});
  const game = (await request(app).get(`/api/games/${gameId}`)).body;
  return {
    gameId,
    hostTeamId: host.body.team.id,
    rivalTeamId: rival.body.team.id,
    landmark: game.landmarks[0],
  };
}

describe('timeline replay payload', () => {
  test('is self-contained: teams, landmarks with final state, photos with coords fallback', async () => {
    const { gameId, hostTeamId, landmark } = await setupActiveGame();

    const claim = await request(app)
      .post(`/api/games/${gameId}/claim`)
      .send({
        landmarkId: landmark.id,
        teamId: hostTeamId,
        latitude: landmark.latitude,
        longitude: landmark.longitude,
      });
    assert.equal(claim.status, 200);

    const withCoords = await request(app)
      .post(`/api/games/${gameId}/photos`)
      .field('teamId', hostTeamId)
      .field('landmarkId', landmark.id)
      .field('latitude', String(landmark.latitude + 0.001))
      .field('longitude', String(landmark.longitude - 0.001))
      .attach('photo', fakeJpeg, { filename: 'geo.jpg', contentType: 'image/jpeg' });
    assert.equal(withCoords.status, 201);

    const withoutCoords = await request(app)
      .post(`/api/games/${gameId}/photos`)
      .field('teamId', hostTeamId)
      .field('landmarkId', landmark.id)
      .attach('photo', fakeJpeg, { filename: 'plain.jpg', contentType: 'image/jpeg' });
    assert.equal(withoutCoords.status, 201);

    const timeline = (await request(app).get(`/api/games/${gameId}/timeline`).expect(200)).body;

    assert.ok(Array.isArray(timeline.teams) && timeline.teams.length === 2);
    const teamNames = timeline.teams.map((t: any) => t.name).sort();
    assert.deepEqual(teamNames, ['Alpha', 'Beta']);

    const lm = timeline.landmarks.find((l: any) => l.id === landmark.id);
    assert.equal(lm.name, landmark.name);
    assert.equal(lm.finalStatus, 'claimed');
    assert.equal(lm.holderTeamId, hostTeamId);
    assert.equal(lm.locked, false);
    assert.ok(lm.claimedAt);
    assert.equal(timeline.landmarks.length, 40);

    assert.equal(timeline.photos.length, 2);
    const geo = timeline.photos.find((p: any) => p.id === withCoords.body.photoId);
    assert.equal(geo.teamName, 'Alpha');
    assert.equal(geo.teamColor, '#ff0000');
    assert.equal(geo.landmarkName, landmark.name);
    assert.equal(geo.latitude, landmark.latitude + 0.001);
    assert.equal(geo.longitude, landmark.longitude - 0.001);
    assert.ok(geo.takenAt);

    const fallback = timeline.photos.find((p: any) => p.id === withoutCoords.body.photoId);
    assert.equal(fallback.latitude, landmark.latitude);
    assert.equal(fallback.longitude, landmark.longitude);

    assert.ok(Array.isArray(timeline.events));
    assert.ok(timeline.events.some((e: any) => e.type === 'landmark_claimed'));
    assert.ok(Array.isArray(timeline.locations));
    assert.ok(timeline.winner);

    // cancel the scheduled game-end timer so the test process can exit promptly
    await request(app).put(`/api/games/${gameId}/end`).send({});
  });
});
