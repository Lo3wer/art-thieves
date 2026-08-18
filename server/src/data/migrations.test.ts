import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.DATABASE_PATH = path.join(os.tmpdir(), `vat-migration-test-${process.pid}.db`);
process.env.PERSIST = 'false';

describe('drizzle migrations', () => {
  test('apply cleanly to a fresh database including photo coordinates', async () => {
    const { initDb } = await import('./db');
    const db = initDb();
    assert.ok(db);

    const { store } = await import('./store-sqlite');
    const game = store.createGame('map-x', {
      duration: 60,
      vicinityRadius: 30,
      winThreshold: 20,
      reTagCooldown: 5,
      disputeWindow: 60,
      noTagPeriod: 10,
    });
    const team = store.addTeam(game.id, 'A', '#ff0000');
    const [landmark] = store.addLandmarks(game.id, [
      { name: 'LM', latitude: 49.28, longitude: -123.11, mapLandmarkIndex: 0 },
    ] as any);
    const photo = store.addPhoto({
      gameId: game.id,
      teamId: team.id,
      landmarkId: landmark.id,
      filename: 'f.jpg',
      url: '/uploads/f.jpg',
      latitude: 49.2845,
      longitude: -123.111,
    });
    assert.ok(photo.id);
    const fetched = store.getPhoto(photo.id);
    assert.equal(fetched?.latitude, 49.2845);
    assert.equal(fetched?.longitude, -123.111);

    const { closeDb } = await import('./db');
    closeDb();
    try {
      fs.rmSync(process.env.DATABASE_PATH!, { force: true });
      fs.rmSync(`${process.env.DATABASE_PATH!}-wal`, { force: true });
      fs.rmSync(`${process.env.DATABASE_PATH!}-shm`, { force: true });
    } catch {
      // Windows may keep the sqlite file locked; temp files are harmless
    }
  });
});
