# Implementation Plan — Landmarks Game

**Stack:** React Native (Expo SDK 57) · Express.js 5 · SQLite via Drizzle ORM (Postgres-ready) · Socket.IO · Zustand · react-native-maps · Jest

---

## Development Order

1. **Part 1 — Full App (client with mocks):** Build every screen, component, store, and navigation. A mock service layer simulates all server responses so the entire app is navigable and testable without a backend.
2. **Part 2 — Server Business Logic (in-memory):** Build the entire Express + Socket.IO server with an in-memory data store. Same behaviour as the final system, but no database dependency. The client switches from mocks to the real server.
3. **Part 3 — Data Persistence & Drives:** Replace the in-memory store with SQLite via Drizzle ORM (swappable to PostgreSQL). Persist all game records, store app selfies to disk (optional, linked to claims), and add read-APIs (`/locations`, `/timeline`, `/photos`) for a separate post-game reconstruction tool. Everything else stays the same.

Verification steps at each part ensure you're never debugging client + server + DB at the same time.

---

## Part 1 — Client App (full implementation with mocks)

### Goal: A fully functional app that works end-to-end using mock services.

---

### 1.1 — Project Scaffold & Navigation

- Reorganize `app/` into feature-based structure:
  ```
  app/
  ├── App.tsx                # Root (providers, navigation container)
  ├── src/
  │   ├── navigation/
  │   │   └── AppNavigator.tsx
  │   ├── screens/           # Screen files
  │   ├── components/        # Shared components
  │   ├── stores/            # Zustand stores
  │   ├── services/          # API, Socket.IO, mocks
  │   ├── hooks/             # Custom hooks
  │   ├── types/             # Shared TypeScript types
  │   └── utils/             # Helpers (distance, timers, etc.)
  ```
- Add all dependencies:
  - Navigation: `@react-navigation/native`, `@react-navigation/bottom-tabs`, `@react-navigation/native-stack`, `react-native-screens`, `react-native-safe-area-context`
  - State: `zustand`
  - Network: `socket.io-client`
  - Maps: `react-native-maps`
   - Device: `expo-camera`, `expo-location`, `expo-document-picker`, `expo-file-system`, `expo-notifications`
- Add dev deps: `jest`, `@testing-library/react-native`, `@testing-library/jest-native`
- Define shared types: `Game`, `Team`, `Landmark`, `GameMap`, `GameConfig`, `TagEvent`, `LogEntry`
- Bottom-tab navigator with 6 tabs: Lobby, Game, Map, Claim, Tag, Log
- Navigation guard: if no active game, show Lobby tab; if game active, show the other 5 tabs (Lobby hidden)
- Zustand store scaffold: `useGameStore`, `useLocationStore`, `useTeamStore`, `useLobbyStore`
- Notification service scaffold: `services/notifications.ts` — push token registration via `expo-notifications`, permission request, handler for incoming notifications (deep link to relevant tab). Mock version records displayed notifications locally.

**Verify:**
- App builds and launches on Expo Go
- Tab navigation renders correctly (Lobby when no game; game tabs when active)
- Zustand stores importable with initial state
- Notification permission prompt fires on first launch
- Jest placeholder test passes

---

### 1.2 — Map Tab

- `react-native-maps` centered on map center from store
- Boundary polygon as translucent overlay (render helper in `MapUtils.ts`)
- Landmark markers colored by status:
  - Grey = unclaimed
  - Team color = claimed
  - Team color + lock icon + partial opacity = locked
- Landmark marker onPress → bottom detail panel:
  - Name, image, status text
  - **Claim** button (visible/enabled only when own GPS within vicinity radius)
- Live team location markers (colors match team colors)
- `expo-location` GPS permission request + periodic pings into `useLocationStore`
- Mock data: Vancouver GeoJSON fixture (40 landmarks + boundary) loaded into store on mount; mock team positions near a few landmarks
- Mock service updates marker colors when claim/challenge events fire locally

**Verify:**
- Map renders with 40 markers from the Vancouver fixture
- Boundary polygon renders
- Tapping a marker opens detail panel with correct info
- Claim button shows/hides based on vicinity (use a mock GPS position)
- Team location markers display at mock positions
- Markers don't overlap excessively (adjust viewport)

---

### 1.3 — Lobby Screens

- **HostCreateScreen:**
  - Step 1: Select map — list available maps (default Vancouver + any "previously imported" from mock)
  - Step 2: **Import Map** — `expo-document-picker` for `.geojson`/`.json` → read via `expo-file-system` → validate shape client-side → add to mock map list
  - Step 3: Settings form (duration, vicinity radius, win threshold, cooldowns) → preview landmarks → **Start Game**
- **JoinScreen:** enter join code → choose team name + color → waiting room
- **LobbyScreen:** game code display, team roster, Start button (host only)
- Mock service: `services/__mocks__/api.ts` provides canned responses for all lobby calls (create game returns fake join code, join returns team info, start transitions status)
- `services/api.ts`: typed interface — `fetchMaps`, `importMap`, `createGame`, `joinGame`, `startGame`. Mock impl behind a flag.

**Verify:**
- Host sees default Vancouver + any imported maps in selector
- Import Map → file picker → valid file → appears in list
- Malformed file → error message
- Create game → join code displayed
- Second device joins → appears in roster
- Start → lobby hidden, game tabs shown

---

### 1.4 — Claim Screen

- Active only when GPS within a landmark's vicinity (check `useLocationStore` distance to nearest landmark); otherwise show "Move closer to a landmark"
- Shows landmark info (name, image)
- **Claim flow:**
  - `expo-camera` opens → take selfie → preview → confirm/retake
  - On confirm: mock API succeeds → update marker color in store
  - If stealing: show "You will steal this Landmark from {team}" confirmation modal
- **Challenge flow** (after successful claim):
  - Display challenge text
  - 3 buttons: **Complete** / **Fail** / **Pass**
  - Complete → lock icon shown; Fail/Pass → stays claimed
  - If already locked or team already attempted: show "Challenge Unavailable"
- Mock service: `services/__mocks__/api.ts` tracks claim/challenge state in-memory per game
- Mock notifications: when a claim/steal succeeds on a rival's landmark, fire a local notification preview simulating what the pushed team would receive ("{team} claimed {Landmark}" / "{team} stole {Landmark} from you")

**Verify:**
- Within vicinity → Claim tab activates with correct landmark
- Camera opens, selfie preview works, confirm processes
- Steal confirmation modal appears for rival's landmark
- Challenge buttons update state correctly
- "Challenge Unavailable" when appropriate
- Local notification fires when claiming a rival's landmark

---

### 1.5 — Tag Screen

- **Tag flow:**
  - If frozen: show freeze countdown timer, disable all actions
  - If not frozen: **Tag** button → team selector modal → confirm → send tag
  - Block tag button during no-tag period (show countdown to unlock)
- **Dispute flow** (when recently tagged):
  - **Dispute** button + countdown
  - Confirm → tag voided, unfrozen immediately
  - Window lapses → "Tag Confirmed" + freeze proceeds
- Freeze overlay: blocks all interactions app-wide (claim, challenge, tag)
- Re-tag cooldown display
- Mock service: tracks no-tag period, freeze state, cooldowns in-memory
- Mock notifications: simulate tag notifications locally — "You've been tagged by {team}!" when targeted, "Your tag on {team} was disputed/confirmed" when tag resolves

**Verify:**
- No-tag period: tag button shows timer, disabled
- After no-tag period: tag button works → target frozen
- Frozen team sees overlay across all tabs
- Dispute within window → voided immediately
- Window lapses → freeze continues
- Re-tag cooldown enforced for same team
- Local notification fires on tag receive and dispute resolution

---

### 1.6 — Game Tab & Log Tab

- **GameScreen:**
  - Live scoreboard: teams ranked by claimed count, then locked count
  - Game clock countdown
  - Host-only: Pause / Resume / End Game buttons
  - Pause overlay: "Game Paused" banner across all screens
- **LogScreen:**
  - Chronological event FlatList (claim, steal, lock, challenge fail/pass, tag, dispute, pause/resume, game start/end)
  - Filter dropdown by team
  - Real-time new entries via mock socket events
- Mock scoreboard updates on claim/challenge events; mock clock ticks
- Mock notifications: local notification on pause/resume/end for non-host players

**Verify:**
- Scoreboard shows correct ranking, updates on claim events
- Clock counts down
- Host buttons visible for host, hidden for non-hosts
- Pause overlay shows when paused
- Log shows events, filter narrows by team
- Local notification fires on pause/resume/end for non-host devices

---

### 1.7 — Reconnection & Edge Cases (client-side)

- **Action queue:** `services/actionQueue.ts` — cache outgoing actions to AsyncStorage when offline
- Mock socket has `simulateDisconnect()` for testing offline behaviour
- On reconnect: flush queue in order, show pending indicator
- Zustand stores persist critical state (gameId, teamId) to AsyncStorage
- App launch → check AsyncStorage → attempt reconnect to active game

**Verify:**
- Mock disconnect → queue actions → reconnect → actions flushed
- App restart → reconnects to game
- State consistent after reconnect

---

### 1.8 — Client Tests

- **Component:** MapScreen markers, GameScreen scoreboard, TagScreen freeze overlay
- **Store:** Zustand transitions on all event types
- **Service:** API client (mock), action queue, socket event registration, notification token registration
- **Navigation:** tab switching, lobby→game conditional flow, notification deep linking (tap notification → opens correct tab)
- **Integration (mocked):** Full game walkthrough — lobby → map → claim → challenge → tag → scoreboard → log → game end, with local notifications at each trigger point

**Verify:**
- `npm test` passes in `app/`
- Manual walkthrough of all screens on device with mock data

---

## Part 2 — Server Business Logic (in-memory)

### Goal: Full server with REST + Socket.IO + game logic, backed by in-memory storage. Client switches from mocks to real server.

---

### 2.1 — Server Scaffold

- `server/` structure:
  ```
  server/src/
  ├── index.ts              # Entry point (Express + Socket.IO bootstrap)
  ├── data/
  │   └── store.ts          # In-memory data store (maps, games, teams, landmarks, state, events)
  ├── routes/               # REST route definitions
  ├── middleware/            # Zod validation, error handling
  ├── socket/               # Socket.IO event handlers
  └── game/
      └── logic.ts          # Pure game-logic functions
  ```
- Dependencies: `express`, `cors`, `socket.io`, `uuid`, `zod`
- Dev deps: `tsx`, `typescript`, `jest`, `ts-jest`, `supertest`, `@types/*`
- In-memory store: plain objects/arrays implementing the same interface that the DB layer will later use
- Seed the default Vancouver map on first request (or on startup)

**Verify:**
- Server starts on port 3001
- In-memory store seeded with Vancouver map
- Jest placeholder passes

---

### 2.2 — Lobby REST Endpoints

- `POST /api/maps` — Import map (validate zod schema, store in-memory)
- `GET /api/maps` — List all maps (metadata only)
- `GET /api/maps/:mapId` — Get full map data
- `POST /api/games` — Create game with mapId, snapshot landmarks, return game + join_code
- `POST /api/games/:joinCode/join` — Join game, return team info
- `GET /api/games/:gameId` — Fetch game state
- `PUT /api/games/:gameId/config` — Update settings
- `PUT /api/games/:gameId/landmarks` — Edit landmarks
- `POST /api/games/:gameId/start` — Start game
- `POST /api/games/:gameId/push-token` — Register device push token for a team (associates Expo push token with team+game for targeted notifications)

**Verify with** `supertest`**:** each endpoint returns correct status + body; rejects invalid input

---

### 2.3 — Socket.IO Setup

- Socket.IO on Express, namespace `/game`
- Rooms: socket joins game room on `join_game`
- Client→Server events: `location_update`, `claim_landmark`, `steal_landmark`, `complete_challenge`, `fail_challenge`, `pass_challenge`, `tag_team`, `dispute_tag`, `pause_game`, `resume_game`, `end_game`
- Server→Client events: `state_update`, `location_broadcast`, `game_ended`, `game_paused`, `game_resumed`
- `game_state_sync` on reconnect (full state snapshot from in-memory store)
- Idempotency by client action ID
- Push notification integration: socket event handlers also trigger Expo Push API calls for tag, claim/steal, and pause/resume/end events (see 2.4)

**Verify:**
- Connect → join room → events flow between clients in same room
- Reconnect → receives `game_state_sync`

---

### 2.4 — Game Logic

- **Claim/Steal:**
  - Validate vicinity (haversine), frozen state, game active
  - If unclaimed → assign; if other team's → steal; reject own duplicate
  - Emit `state_update`
- **Challenge:**
  - Validate vicinity, one attempt per team, not locked
  - Complete → lock; Fail/Pass → record attempt
  - Emit `state_update`
- **Win check:** after every claim/challenge, count claimed landmarks per team. If `>= winThreshold` → emit `game_ended`
- **Tag/Dispute:**
  - Validate no-tag period, frozen state, cooldowns
  - Create tag → frozen state → start dispute window timer
  - Dispute within window → void, unfreeze
  - Timers stored as remaining duration (pause-safe)
- **Session control:** pause/resume toggle status, end computes winner
- **Scoreboard:** computed from landmark_state
- **Event log:** append-only array of all mutations
- **Push notifications:**
  - Add `expo-notifications` server dependency (`expo-server-sdk` or fetch Expo Push API directly)
  - `services/notifications.ts`: helper to send push notifications via Expo Push API. Batches per-team tokens for efficiency. Handles invalid tokens (remove from store on 410/InvalidCredentials response).
  - Notification triggers:
    - **Tag received**: when a tag is created, send push to all devices on the target team ("You've been tagged by {team}! {disputeWindow}s to dispute.")
    - **Tag disputed/confirmed**: when a dispute is processed or window lapses, notify the tagging team.
    - **Claim/Steal**: when a landmark changes hands, notify all devices on the losing team ("{team} claimed {Landmark}" / "{team} stole {Landmark} from you").
    - **Game paused/resumed/ended**: when session control actions fire, notify all devices in the game.

**Verify:**
- All game rules enforced correctly (unit tests on `game/logic.ts`)
- Full game scenario: create → join → claim → steal → challenge → lock → tag → dispute → pause → resume → end
- Edge cases: frozen reject, locked reject, out-of-vicinity reject, no-tag period reject, instant win at threshold, tiebreaker
- Push notification sent to correct team devices on each trigger event
- Invalid push tokens detected and cleaned up

---

### 2.5 — Integration (Client → Real Server)

- Switch `services/api.ts` from mock to real server URL
- Switch `services/socket.ts` from mock to real socket connection
- Remove all mock implementations for game-related services

**Verify:**
- Full end-to-end flow on device: lobby → create game → join → map → claim → challenge → tag → scoreboard → log → end
- Multiple devices interact in the same game
- Disconnect/reconnect cycle works

---

### 2.6 — Server Tests

- **Unit:** game logic (win condition, vicinity, tiebreaker, timer math)
- **Integration:** all REST endpoints via supertest
- **Socket:** connect/disconnect, room events, reconnection
- **Edge cases:** frozen rejects claim, locked rejects steal, tag during no-tag period, cooldown enforcement, idempotent actions, map validation, instant win, tiebreaker
- **Notification tests:** push notification helper correctly formats and batches messages; invalid tokens are removed from store

**Verify:**
- `npm test` passes in `server/`

---

## Part 3 — Data Persistence & Drives

### Goal: Replace in-memory store with a relational DB (SQLite now, Postgres-ready) and persist
photos + expose read-APIs for post-game reconstruction. No behavioural change to the game
itself — everything that worked in Part 2 still works.

### Decisions (confirmed with owner)
| Decision | Choice |
|---|---|
| Database (now) | **SQLite** via **Repository + Drizzle ORM** (`better-sqlite3`) |
| Database (future) | **PostgreSQL / other relational** — swap Drizzle driver + connection + regenerate migrations; no repo/route changes |
| Data access | Repository layer per collection; existing `store` becomes a facade over repositories (routes/socket handlers unchanged) |
| Selfie storage | **Files on disk** under `server/uploads/<gameId>/`, path + metadata in DB, original quality (not downscaled), served via `express.static` |
| Photo scope | Only app selfies; **optional**, linked to a claim when present (a claim works without a photo) |
| Timeline access | Data stored server-side; a separate reconstruction tool reads the server read-APIs |
| Upload transport | Multipart/form-data (multer), scoped only to the `/photos` route; everything else stays JSON |

---

### 3.1 — Database Setup (SQLite via Drizzle)

- Add dependencies: `drizzle-orm`, `better-sqlite3`, `multer`; dev `@types/better-sqlite3`, `@types/multer`, `drizzle-kit`
- Add `src/data/db.ts`: `better-sqlite3` connection, Drizzle client, and `migrate()` run on boot. **Only dialect-specific file** (swap later for Postgres).
- Add `src/data/schema.ts` — Drizzle table definitions (all hold `text` UUID-ish ids, SQLite types):
  - `maps`, `games`, `teams`, `landmarks`, `landmark_state`, `challenge_attempts`,
    `location_pings`, `tag_events`, `push_tokens`, `event_log`, and
  - `photos` — `id`, `game_id`, `team_id`, `landmark_id`, `filename`, `url`, `created_at`,
    with an optional `photos.id` FK referenced by `landmark_state.claim_photo_id`.
- Add `drizzle.config.ts` for `drizzle-kit` (SQLite driver), migrations generated under `server/drizzle/`.
- Seed: insert Vancouver Downtown map on first run.
- Update `server/.gitignore` — ignore `server/data/*.db*` (and per the exchange, DB files) and `server/uploads/`.

**Verify:**
- Server boots, tables are created, Vancouver map seeded.
- `npm run db:generate`/migrate produce the schema with no errors.

---

### 3.2 — Replace In-Memory Store with Repositories

- Create `src/data/repositories.ts` (one repo per table) + an exposed `Store` facade that
  keeps the exact public API `store.ts` had:
  - `MapRepo` — insert, findAll, findById
  - `GameRepo` — create, findByJoinCode, findById, updateStatus, updateConfig
  - `TeamRepo` — create, findByGame
  - `LandmarkRepo` — bulkCreate (from map snapshot), findByGame
  - `LandmarkStateRepo` — upsert (claim, steal, lock), findByGame, findByTeam
  - `ChallengeAttemptRepo` — create, findByTeamAndLandmark
  - `LocationPingRepo` — create, findByGame (and time-ordered, for replay)
  - `TagEventRepo` — create, findActiveByTarget, updateDispute
  - `PushTokenRepo` — register, findByGameAndTeam, remove (invalid token cleanup)
  - `EventLogRepo` — insert, findByGame (paginated, filterable)
  - `PhotoRepo` — create (with static URL), findById, findByGame
- Route handlers and socket handlers keep calling `store.*`; only the implementation changes.
- Add indexes: `location_pings(game_id, timestamp)`, `event_log(game_id, type)`, `landmark_state(game_id, landmark_id)`.

**Verify:**
- All endpoints still return correct results (same supertest suite).
- All game logic unchanged (pure functions in `game/logic.ts` need no changes).
- Data persists across server restart.

---

### 3.3 — Selfie Photo Upload & Claim Linking

- Add `src/middleware/upload.ts`: multer disk storage to `server/uploads/<gameId>/`,
  original quality, `image/jpeg`|`image/png`, 10MB cap.
- Add route `POST /api/games/:id/photos` (multipart) → multer → `PhotoRepo.create` →
  returns `{ photoUrl }` where `photoUrl = /uploads/<gameId>/<file>`.
- Mount `express.static('/uploads')` in `src/index.ts` so files are publicly reachable.
- Claim flow gains an **optional** `photoId`/`photoUrl`: if a selfie was uploaded and linked, the
  claim's `landmark_state` and the emitted log entry carry `photoUrl`. Claims still succeed with no photo.
- Expose `GET /api/games/:id/photos` → list this game's uploaded selfies.

**Verify:**
- Upload writes a file and returns a reachable `/uploads/...` URL.
- Claim works with and without a linked photo; log entry includes `photoUrl` when present.

---

### 3.4 — Read-APIs for Post-Game Reconstruction

- `GET /api/games/:id/locations` → time-ordered `location_pings` for the game (already in 3.2).
- `GET /api/games/:id/timeline` → `{ game, scores, events:[{ timestamp, type, teamId?, data?, photoUrl? }] }`
  merging `event_log` (joined with any `photoUrl`) + `location_pings` + final scores/winner, chronological.
- `GET /api/games/:id/photos` (3.3) rounds out the read surface a separate tool can consume.

**Verify:**
- `/locations` and `/timeline` return populated, time-ordered data.
- `/photos` returns the game's selfies.

---

### 3.5 — Separate Reconstruction Tool (future / outline)

A standalone app or CLI (e.g. `tools/game-lab/`, web or CLI) that consumes the 3.4 read-APIs and
replays a game: animated map of team routes (from `location_pings`), claims/steals/locks, tags,
per-landmark selfie gallery, score-over-time chart, JSON export. Built entirely on the read-APIs; no new schema.

---

### 3.6 — Final Test Pass

- Run all server tests against SQLite (test database, reset between runs).
- Run all client tests (unchanged).
- Full manual walkthrough on device.
- Verify data persists: start game → make claims → restart server → rejoin → state intact.

**Verify:**
- `npm test` passes in both `app/` and `server/`.
- Full game flow works with persistent storage.
- Server restart doesn't lose game state, photos, or logs.

---

## Architecture Decisions

| Decision | Choice |
|---|---|
| Database | SQLite via Drizzle ORM (`better-sqlite3`), swappable to PostgreSQL (driver + migrations only) |
| Data access | Repository layer per collection; `store` facade over repositories |
| Selfie storage | Files on disk under `server/uploads/<gameId>/`, optional, linked to claims via `photos` table + `photoUrl` |
| Reconstruction | Separate tool consumes read-APIs (`/locations`, `/timeline`, `/photos`, `/log`) |
| Client state | Zustand |
| Real-time | Socket.IO |
| Maps library | react-native-maps |
| Map file format | GeoJSON FeatureCollection + metadata wrapper |
| Map import | expo-document-picker + expo-file-system |
| Camera | expo-camera |
| Push notifications | expo-notifications (client) + Expo Push API (server) |
| Server validation | zod |
| Server testing | Jest + supertest + socket.io-client |
| Client testing | Jest + @testing-library/react-native |
| Mock strategy | Shared TypeScript interfaces, flag-gated real vs mock service layer |
| In-memory → DB | Data access layer with swappable implementation (in-memory for Part 2, SQLite/Drizzle for Part 3, Postgres-ready) |
| Project structure | Feature-based (server: layered; client: screens/components/stores/services) |
| TypeScript | Strict mode in both projects |
