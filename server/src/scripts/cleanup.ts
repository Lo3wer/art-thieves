import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { getDb, getUploadsDir } from '../data/db';
import * as s from '../data/schema';

const CHILD_TABLES = [
  s.teams,
  s.landmarks,
  s.landmarkStates,
  s.challengeAttempts,
  s.penalties,
  s.locationPings,
  s.tagEvents,
  s.pushTokens,
  s.eventLog,
  s.photos,
];

function listGames(): void {
  const rows = getDb()
    .select({
      id: s.games.id,
      joinCode: s.games.joinCode,
      status: s.games.status,
      mapId: s.games.mapId,
      duration: s.games.config,
      createdAt: s.games.createdAt,
    })
    .from(s.games)
    .orderBy(s.games.createdAt)
    .all();
  if (rows.length === 0) {
    console.log('No games.');
    return;
  }
  for (const r of rows) {
    const duration = typeof r.duration === 'object' && r.duration ? (r.duration as any).duration : '?';
    console.log(`${r.joinCode}\t${r.status}\t${duration}s\t${r.mapId}\t${r.id}\t${r.createdAt}`);
  }
}

function deleteGame(ref: string): number {
  const db = getDb();
  const game = db
    .select()
    .from(s.games)
    .where(eq(s.games.id, ref))
    .all()[0] ?? db.select().from(s.games).where(eq(s.games.joinCode, ref)).all()[0];
  if (!game) {
    console.log(`Game ${ref} not found.`);
    return 0;
  }
  deletePhotoFiles(game.id);
  for (const table of CHILD_TABLES) {
    db.delete(table).where(eq(table.gameId, game.id)).run();
  }
  db.delete(s.games).where(eq(s.games.id, game.id)).run();
  console.log(`Deleted game ${game.joinCode} (${game.status}).`);
  return 1;
}

function deletePhotoFiles(gameId: string): void {
  const rows = getDb().select().from(s.photos).where(eq(s.photos.gameId, gameId)).all();
  if (rows.length === 0) return;
  const uploads = getUploadsDir();
  let removed = 0;
  for (const photo of rows) {
    const candidate = path.join(uploads, photo.filename);
    if (photo.filename && fs.existsSync(candidate)) {
      fs.unlinkSync(candidate);
      removed++;
    }
  }
  console.log(`Removed ${removed}/${rows.length} photo file(s).`);
}

function clearAll(): void {
  const db = getDb();
  for (const table of CHILD_TABLES) {
    db.delete(table).run();
  }
  db.delete(s.games).run();
  console.log('Cleared all games and related data.');
}

function parseArgs(): { command: string; target?: string } {
  const [, , command, target] = process.argv;
  return { command, target };
}

function main(): void {
  const { command, target } = parseArgs();
  switch (command) {
    case 'list':
      listGames();
      break;
    case 'delete':
      if (!target) {
        console.error('Usage: npm run cleanup -- delete <gameId|joinCode>');
        process.exit(1);
      }
      deleteGame(target);
      break;
    case 'clear':
      if (target !== '--yes') {
        console.error('This deletes ALL games and related data (maps are kept). Re-run with --yes to confirm.');
        process.exit(1);
      }
      clearAll();
      break;
    default:
      console.error('Usage:\n  npm run cleanup -- list\n  npm run cleanup -- delete <gameId|joinCode>\n  npm run cleanup -- clear --yes');
      process.exit(1);
  }
}

main();