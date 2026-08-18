import '../routes/test-env';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { Server } from 'socket.io';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { store } from '../data/store';
import { registerGameHandlers } from './handlers';

const CONFIG = {
  duration: 60,
  vicinityRadius: 30,
  winThreshold: 20,
  reTagCooldown: 5,
  disputeWindow: 60,
  noTagPeriod: 10,
};

let httpServer: http.Server;
let io: Server;
let clientA: ClientSocket;
let clientB: ClientSocket;
let clientC: ClientSocket;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function nextEvent(client: ClientSocket, event: string, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    client.once(event, (payload: any) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function expectNoEvent(client: ClientSocket, event: string, waitMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), waitMs);
    client.once(event, () => {
      clearTimeout(timer);
      reject(new Error(`unexpectedly received ${event}`));
    });
  });
}

async function join(client: ClientSocket, gameId: string, teamId: string): Promise<void> {
  const statePromise = nextEvent(client, 'state_update');
  client.emit('join_game', { gameId, teamId });
  await statePromise;
}

before(async () => {
  httpServer = http.createServer();
  io = new Server(httpServer, { cors: { origin: '*' } });
  registerGameHandlers(io);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  clientA?.close();
  clientB?.close();
  clientC?.close();
  await new Promise<void>((resolve) => io.close(resolve));
  await new Promise<void>((resolve) => httpServer.close(resolve));
});

describe('location hiding during an active challenge', () => {
  test('challenging team does not see rival locations; others still see the challenger', async () => {
    const url = `http://127.0.0.1:${(httpServer.address() as any).port}/game`;
    const game = store.createGame('map-x', CONFIG);
    const teamA = store.addTeam(game.id, 'A', '#ff0000');
    const teamB = store.addTeam(game.id, 'B', '#00ff00');
    const teamC = store.addTeam(game.id, 'C', '#0000ff');
    const [landmark] = store.addLandmarks(game.id, [
      { name: 'LM', latitude: 49.28, longitude: -123.11, mapLandmarkIndex: 0 },
    ] as any);

    // Team A has an in-progress challenge
    store.startChallengeSession(game.id, landmark.id, teamA.id);

    // Seed one ping per team before anyone joins
    store.addLocationPing(game.id, teamA.id, 1, 1);
    store.addLocationPing(game.id, teamB.id, 2, 2);

    clientA = Client(url, { transports: ['websocket'] });
    clientB = Client(url, { transports: ['websocket'] });
    clientC = Client(url, { transports: ['websocket'] });
    await Promise.all([
      nextEvent(clientA, 'connect'),
      nextEvent(clientB, 'connect'),
      nextEvent(clientC, 'connect'),
    ]);

    // A's join state must only include A's own location
    const statePromise = nextEvent(clientA, 'state_update');
    clientA.emit('join_game', { gameId: game.id, teamId: teamA.id });
    const stateA = (await statePromise) as any;
    assert.ok(Array.isArray(stateA.game.locations));
    assert.deepEqual(
      stateA.game.locations.map((l: any) => l.teamId),
      [teamA.id]
    );

    // B sees both teams' latest locations (no challenge for B)
    const stateBPromise = nextEvent(clientB, 'state_update');
    clientB.emit('join_game', { gameId: game.id, teamId: teamB.id });
    const stateB = (await stateBPromise) as any;
    assert.deepEqual(
      stateB.game.locations.map((l: any) => l.teamId).sort(),
      [teamA.id, teamB.id].sort()
    );

    await join(clientC, game.id, teamC.id);

    // Live updates: B's location must not reach A, but reaches C
    const cReceivesB = nextEvent(clientC, 'location_broadcast');
    clientB.emit('location_update', { latitude: 3, longitude: 3 });
    const atC = await cReceivesB;
    assert.equal(atC.teamId, teamB.id);
    await expectNoEvent(clientA, 'location_broadcast');

    // A's own location still reaches everyone
    const bReceivesA = nextEvent(clientB, 'location_broadcast');
    const cReceivesA = nextEvent(clientC, 'location_broadcast');
    clientA.emit('location_update', { latitude: 4, longitude: 4 });
    await bReceivesA;
    await cReceivesA;

    // Same-team devices of A are not cut off from each other
    // (covered by recipientTeamId !== senderTeamId condition)

    // Once A's challenge resolves, B's updates flow to A again
    store.resolveChallengeSession(game.id, landmark.id, teamA.id, 'complete');
    const aReceivesB = nextEvent(clientA, 'location_broadcast');
    clientB.emit('location_update', { latitude: 5, longitude: 5 });
    const atA = await aReceivesB;
    assert.equal(atA.teamId, teamB.id);
    assert.equal(atA.latitude, 5);
  });
});
