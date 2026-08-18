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

async function setupGame() {
  const maps = (await request(app).get('/api/maps')).body;
  const created = await request(app)
    .post('/api/games')
    .send({ mapId: maps[0].id, config: CONFIG });
  const joinCode = created.body.joinCode;
  const joined = await request(app)
    .post(`/api/games/join/${joinCode}`)
    .send({ name: 'A', color: '#ff0000' });
  const game = (await request(app).get(`/api/games/${created.body.id}`)).body;
  return { gameId: created.body.id, teamId: joined.body.team.id, landmarkId: game.landmarks[0].id };
}

describe('photo upload coordinates', () => {
  test('stores latitude/longitude when provided and tolerates their absence', async () => {
    const { gameId, teamId, landmarkId } = await setupGame();

    const withCoords = await request(app)
      .post(`/api/games/${gameId}/photos`)
      .field('teamId', teamId)
      .field('landmarkId', landmarkId)
      .field('latitude', '49.2845')
      .field('longitude', '-123.111')
      .attach('photo', fakeJpeg, { filename: 'selfie.jpg', contentType: 'image/jpeg' });
    assert.equal(withCoords.status, 201);

    const withoutCoords = await request(app)
      .post(`/api/games/${gameId}/photos`)
      .field('teamId', teamId)
      .field('landmarkId', landmarkId)
      .attach('photo', fakeJpeg, { filename: 'proof.jpg', contentType: 'image/jpeg' });
    assert.equal(withoutCoords.status, 201);

    const photos = (await request(app).get(`/api/games/${gameId}/photos`)).body;
    assert.equal(photos.length, 2);
    const geo = photos.find((p: any) => p.id === withCoords.body.photoId);
    assert.equal(geo.latitude, 49.2845);
    assert.equal(geo.longitude, -123.111);
    const plain = photos.find((p: any) => p.id === withoutCoords.body.photoId);
    assert.ok(plain.latitude === null || plain.latitude === undefined);
    assert.ok(plain.longitude === null || plain.longitude === undefined);
  });

  test('rejects non-numeric latitude', async () => {
    const { gameId, teamId, landmarkId } = await setupGame();
    const res = await request(app)
      .post(`/api/games/${gameId}/photos`)
      .field('teamId', teamId)
      .field('landmarkId', landmarkId)
      .field('latitude', 'north')
      .attach('photo', fakeJpeg, { filename: 'x.jpg', contentType: 'image/jpeg' });
    assert.equal(res.status, 400);
  });
});
