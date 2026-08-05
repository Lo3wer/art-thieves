# Environment Variables

Central reference for every environment variable used in the Vancouver Art Thieves monorepo.

There are **two independent environments** — the **app** (Expo / React Native client) and the
**server** (Node.js + Express + Socket.IO backend). Each reads its **own** `.env` file; they do not share one.

## Environment files

| File | Purpose | Loaded by | Gitignored |
|---|---|---|---|
| `app/.env` | App settings | Expo, at build/dev time | yes |
| `app/.env.example` | App template (all options documented) | — | no |
| `server/.env` | Server settings | dotenv, at server startup | yes |
| `server/.env.example` | Server template (all options documented) | — | no |

### How loading works

**Server** (`server/.env`)
- `dotenv` loads `<server>/.env` automatically via `import 'dotenv/config'` in `src/index.ts`.
- Shell variables take precedence over `.env` — dotenv never overwrites variables already set in your environment.
- Loading order: `.env` is read **before** the store backend is selected, so `PERSIST` / `DATABASE_PATH` are always honored.

**App** (`app/.env`)
- Only variables prefixed with `EXPO_PUBLIC_` are embedded into the client bundle at build/dev time.
- After editing, restart Metro or rebuild the app: `npx expo run:android`.
- When `EXPO_PUBLIC_API_URL` is unset, the base URL is auto-detected (see below).

## Server variables (`server/.env`)

| Variable | Default | Values | Description |
|---|---|---|---|
| `PERSIST` | `true` | `true` / `false` | `false` switches to an **in-memory store**: no SQLite database and no `uploads/` folder; all data (games, logs, photos) is ephemeral and lost on restart. |
| `DB_IN_MEMORY` | — | `1` | Alternative way to force in-memory mode (equivalent to `PERSIST=false`). |
| `DATABASE_PATH` | `./data/vat.db` | file path | SQLite database file location (persistent mode only). |
| `MIGRATIONS_DIR` | `./drizzle` | folder path | Folder containing generated Drizzle migrations (persistent mode only). |
| `PORT` | `3001` | number | Port the HTTP/Socket.IO server listens on. |

### Run mode matrix

| Goal | Command |
|---|---|
| Persistent (default) | `npm run dev` or `npm start` |
| In-memory (ephemeral) | `npm run dev:memory` |
| In-memory via shell | PowerShell: `$env:PERSIST='false'; npm run dev` · macOS/Linux: `PERSIST=false npm run dev` |
| Override `.env` from shell | set the var in your terminal before `npm run dev` (shell wins) |

Persistent mode stores data in:
- `server/data/vat.db` — all relational data (games, teams, landmarks, logs, location pings, photos index).
- `server/uploads/` — uploaded selfie files, served at `/uploads/...`.

In-memory mode stores nothing on disk: photos go to a temporary OS directory and vanish with the process.

## App variables (`app/.env`)

| Variable | Default | Description |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | auto-detected | Base URL of the game server. Unset: iOS simulator / web → `http://localhost:3001`, Android emulator → `http://10.0.2.2:3001`. Set to your LAN IP (e.g. `http://192.168.1.50:3001`) for a physical device. |
| `EXPO_PUBLIC_MAP_STYLE` | (built-in style) | MapLibre tile style URL, e.g. `https://tiles.openfreemap.org/styles/liberty`. |
| `EXPO_PUBLIC_USE_MOCK_LOCATION` | `false` | `true` simulates GPS movement for at-home testing: auto-walks a route between landmarks and adds a dev panel on the Map screen to jump between landmarks. |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | — | **Unused** — kept for reference only (MapLibre is used instead of Google Maps). |

## Quick reference

```sh
# Server — run with an ephemeral in-memory store
cd server
npm run dev:memory

# Server — run persistent (default), with a custom DB location
cd server
$env:DATABASE_PATH = "./data/other.db"; npm run dev   # Windows PowerShell
DATABASE_PATH=./data/other.db npm run dev             # macOS / Linux

# App — point the client at a server on your LAN
cd app
# set EXPO_PUBLIC_API_URL=http://<your-lan-ip>:3001 in app/.env
npx expo run:android --device
```
