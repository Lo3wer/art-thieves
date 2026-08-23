import fs from 'fs';
import path from 'path';
import { store } from '../data/store';
import { getUploadsDir } from '../data/db';

async function listGames(): Promise<void> {
  const games = await store.getGames();
  if (games.length === 0) {
    console.log('No games.');
    return;
  }
  for (const game of games) {
    console.log(`${game.joinCode}\t${game.status}\t${game.config.duration}s\t${game.mapId}\t${game.id}\t${game.createdAt}`);
  }
}

async function deletePhotoFiles(gameId: string): Promise<void> {
  const photos = await store.getPhotosByGame(gameId);
  const uploads = path.join(getUploadsDir(), gameId);
  let removed = 0;
  for (const photo of photos) {
    const candidate = path.join(uploads, photo.filename);
    if (photo.filename && fs.existsSync(candidate)) {
      fs.unlinkSync(candidate);
      removed++;
    }
  }
  if (photos.length > 0) console.log(`Removed ${removed}/${photos.length} photo file(s).`);
}

async function deleteGame(ref: string): Promise<void> {
  const game = (await store.getGame(ref)) ?? (await store.getGameByJoinCode(ref));
  if (!game) {
    console.log(`Game ${ref} not found.`);
    return;
  }
  await deletePhotoFiles(game.id);
  await store.deleteGame(game.id);
  console.log(`Deleted game ${game.joinCode} (${game.status}).`);
}

async function main(): Promise<void> {
  const [, , command, target] = process.argv;
  switch (command) {
    case 'list':
      await listGames();
      return;
    case 'delete':
      if (!target) throw new Error('Usage: npm run cleanup -- delete <gameId|joinCode>');
      await deleteGame(target);
      return;
    case 'clear':
      if (target !== '--yes') {
        throw new Error('This deletes ALL games and related data (maps are kept). Re-run with --yes to confirm.');
      }
      await store.clearGames();
      console.log('Cleared all games and related data.');
      return;
    default:
      throw new Error('Usage:\n  npm run cleanup -- list\n  npm run cleanup -- delete <gameId|joinCode>\n  npm run cleanup -- clear --yes');
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
