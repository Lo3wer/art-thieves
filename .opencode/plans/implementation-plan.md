# Implementation Plan — Landmarks Game

**Stack:** React Native (Expo SDK 57) · Express.js 5 · PostgreSQL · Socket.IO · Zustand · react-native-maps · Jest

---

## Development Approach

Every feature phase follows a **frontend-first pattern** with three sub-phases:

- **A — Client (with mocks):** Build all screens, components, stores, and navigation against a mock service layer. Mocks use the same TypeScript types as the real services, so switching later is a drop-in replacement.
- **B — Server (real implementation):** Build the actual backend endpoints, database queries, and Socket.IO event handlers.
- **C — Integration:** Wire the client's service layer to the real server, remove mock implementations, end-to-end verification.

The mock layer lives in `app/src/services/__mocks__/` and exposes the same interface as the real services. For Socket.IO, a mock socket emits local events to simulate server responses for testing.

---

## Phase 1 — Project Foundation & Infrastructure

### 1A — Client Scaffold

- Reorganize `app/` into feature-based structure:
  ```
  app/
  ├── App.tsx                # Root (providers, navigation container)
  ├── src/
  │   ├── navigation/
  │   │   └── AppNavigator.tsx
  │   ├── screens/           # One file per screen
  │   ├── components/        # Shared/reusable components
  │   ├── stores/            # Zustand stores
  │   ├── services/          # API client, Socket.IO client + mocks
  │   ├── hooks/             # Custom hooks
  │   ├── types/             # Shared TypeScript types
  │   └── utils/             # Helpers (distance calc, etc.)
  ```
- Add dependencies: `@react-navigation/native`, `@react-navigation/bottom-tabs`, `@react-navigation/native-stack`, `react-native-screens`, `react-native-safe-area-context`, `zustand`, `socket.io-client`, `react-native-maps`, `expo-camera`, `expo-location`, `expo-document-picker`, `expo-file-system`
- Add dev deps: `jest`, `@testing-library/react-native`, `@testing-library/jest-native`
- Bottom-tab navigator with 6 placeholder tabs: Game, Map, Claim, Tag, Log, Lobby
- Zustand store scaffold: `useGameStore`, `useLocationStore`, `useAuthStore`
- Define shared TypeScript types: `Game`, `Team`, `Landmark`, `Map`, `GameConfig`, `TagEvent`, `LogEntry` — used by both real and mock services

**Verify:**
- App builds and launches on Expo Go
- Tab navigation renders with 6 tabs with placeholder content
- Zustand stores importable with initial state
- Jest placeholder test passes

### 1B — Server Scaffold

- Reorganize `server/src/` into layered structure:
  ```
  server/src/
  ├── index.ts              # Entry point (Express + Socket.IO bootstrap)
  ├── config/
  │   └── db.ts             # PostgreSQL pool/client setup
  ├── db/
  │   └── migrations/       # SQL migration files
  ├── models/               # Data access layer (SQL queries)
  ├── routes/               # REST route definitions
  ├── middleware/            # Auth, error handling, validation (zod)
  ├── socket/               # Socket.IO event handlers
  └── game/
      └── logic.ts          # Pure game-logic functions
  ```
- Add dependencies: `pg`, `socket.io`, `uuid`, `dotenv`, `zod`
- Add dev deps: `jest`, `ts-jest`, `supertest`, `@types/jest`, `@types/supertest`
- Write migration: `001_create_tables.sql`
  - `maps` — id (uuid), name, center_lat, center_lng, default_zoom, default_vicinity_radius, win_threshold, data (jsonb — GeoJSON FeatureCollection), created_at
  - `games` — id (uuid), join_code (unique), map_id (fk nullable), status (lobby/active/paused/ended), config (jsonb: duration, vicinity_radius, win_threshold, re_tag_cooldown, dispute_window), created_at
  - `teams` — id (uuid), game_id (fk), name, color, created_at
  - `landmarks` — id (uuid), game_id (fk), name, latitude, longitude, image_url, challenge_text, map_landmark_index (int)
  - `landmark_state` — id (uuid), game_id (fk), landmark_id (fk), team_id (fk nullable), locked (boolean), claimed_at
  - `challenge_attempts` — id (uuid), game_id (fk), landmark_id (fk), team_id (fk), outcome, created_at
  - `location_pings` — id (uuid), game_id (fk), team_id (fk), latitude, longitude, timestamp
  - `tag_events` — id (uuid), game_id (fk), tagger_team_id (fk), target_team_id (fk), timestamp, disputed, voided
  - `event_log` — id (uuid), game_id (fk), type, data (jsonb), timestamp
- Run migrations on startup
- `.env` config: `DATABASE_URL`, `PORT`
- Seed script: insert bundled Vancouver Downtown map into `maps` table (40 landmarks as GeoJSON FeatureCollection)

**Verify:**
- Server starts and connects to PostgreSQL
- All tables created (`\dt`)
- Seed script inserts 40 landmarks
- Jest placeholder test passes

---

## Phase 2 — Lobby System (Pre-game)

### 2A — Client Lobby Screens (with mocks)

- **Mock service layer:**
  - `services/__mocks__/api.ts` — returns canned responses for game create/join, map list/upload
  - Mock map list includes: default Vancouver map + one fake imported map
  - Mock game create returns a fake join code; mock join returns team info
- **HostCreateScreen:**
  - Step 1: Choose map — lists available maps from mock API (name, landmark count, city)
  - Step 2 (optional): **Import Map** — file picker (`expo-document-picker`) → read file → validate shape client-side → POST to mock API → add to list
  - Step 3: Settings form (duration, vicinity radius, win threshold, cooldowns) → optionally preview/edit landmarks → Start Game
- **JoinScreen:** enter code → choose team name + color → waiting room
- **LobbyScreen:** game code display, roster, host controls (Start button for host only)
- **API service module** (`services/api.ts`): typed functions — `fetchMaps`, `importMap`, `createGame`, `joinGame`, `startGame`. Uses a flag to switch between mock and real implementations.
- Zustand store wired to lobby state

**Verify:**
- Host sees default Vancouver map + fake imported map in selector
- Host taps Import Map → file picker opens → selects a `.geojson` file → map appears in list
- Malformed file → error message, not added
- Host creates game → join code displayed
- Second device joins with code → appears in roster
- Host starts game → status transitions to `active` in store

### 2B — Server Lobby REST API

- `POST /api/maps` — Import a map (accept GeoJSON as JSON body, validate schema with zod, return map_id). Persist to `maps` table.
- `GET /api/maps` — List all available maps (metadata only, no full GeoJSON). Includes Vancouver default + user-imported.
- `GET /api/maps/:mapId` — Get full map data (GeoJSON + metadata) for preview.
- `POST /api/games` — Create game, accept `mapId`, snapshot landmarks from map into `landmarks` table, return game + join_code.
- `POST /api/games/:joinCode/join` — Team joins, return game + team info.
- `GET /api/games/:gameId` — Fetch game state (used for reconnection).
- `PUT /api/games/:gameId/config` — Host updates settings.
- `PUT /api/games/:gameId/landmarks` — Host edits landmarks before start.
- `POST /api/games/:gameId/start` — Host starts game (set status to `active`).
- Zod validation for map schema, error-handling middleware.

**Verify:**
- `POST /api/maps` with valid GeoJSON → 201 + map_id returned
- `POST /api/maps` with missing fields → 400 with descriptive error
- `GET /api/maps` returns Vancouver default + imported maps
- `POST /api/games` with mapId → game created with landmarks snapshot
- `POST /api/games/:joinCode/join` → team added, game returned
- `POST /api/games/:gameId/start` → status changes to `active`

### 2C — Lobby Integration

- Switch client `services/api.ts` from mock to real server URL
- Full flow: Host launches app → creates game → imports map → starts → team joins from separate device
- Remove mock API responses for lobby endpoints (keep other endpoint mocks for later phases)

**Verify:**
- Lobby flow works end-to-end with real server
- Map import → server validates → persisted → visible on reload
- Game create/join/start all round-trip correctly

---

## Phase 3 — Core Game State & WebSocket Layer

### 3A — Client Socket Service & State Sync (with mocks)

- **Mock socket service:** `services/__mocks__/socket.ts` — exposes `connect`, `disconnect`, `emit`, `on`, `off`. Internally uses a local event emitter. Provides helper methods like `simulateEvent(type, data)` for tests and manual dev to trigger server-like events without a server.
- **Real socket service scaffold:** `services/socket.ts` — connect/disconnect, event registration, reconnect logic (will connect to real server in 3C).
- Zustand stores updated by socket events:
  - `useGameStore` — game state, scores, clock, pause state
  - `useLocationStore` — all teams' current positions
  - `useTeamStore` — team info, freeze status, dispute availability
- Action queue: cache outgoing actions in AsyncStorage when offline, flush on reconnect
- Store tests: feed mock socket events → assert Zustand state transitions

**Verify:**
- Mock socket can connect and simulate events
- Dispatching a mock `state_update` event updates Zustand store
- Dispatching a mock `location_broadcast` updates team positions
- Dispatching a mock `tag_frozen` updates freeze state
- Action queue persists to AsyncStorage and flushes correctly

### 3B — Server Socket.IO Setup

- Initialize Socket.IO attached to Express, namespace `/game`
- Client→server events: `join_game`, `location_update`, `claim_landmark`, `steal_landmark`, `complete_challenge`, `fail_challenge`, `veto_challenge`, `tag_team`, `dispute_tag`, `pause_game`, `resume_game`, `end_game`
- Server→client events: `game_state_sync`, `state_update`, `location_broadcast`, `tag_frozen`, `tag_dispute_window`, `tag_voided`, `game_paused`, `game_resumed`, `game_ended`
- Room management: socket joins game-specific room on `join_game`, leaves on disconnect
- Reconnection: track socket→game+team mapping; on reconnect send `game_state_sync` with current state
- Idempotency: deduplicate actions by client-generated action ID

**Verify:**
- Client connects to Socket.IO server and joins game room
- Two clients in same room: one emits `location_update` → other receives `location_broadcast`
- Disconnect one client → reconnect → receives `game_state_sync`
- Multiple rooms don't cross-talk

### 3C — Socket Integration

- Switch client `services/socket.ts` from mock to real Socket.IO connection
- WebSocket lobby sync: when host starts game in Phase 2, socket broadcasts to all connected clients

**Verify:**
- Client connects to real server socket
- Location pings flow from client → server → broadcast to room
- Reconnect cycle works with real server
- All planned events round-trip correctly

---

## Phase 4 — Map Tab

### 4A — Client Map Screen (with mocks)

- **Mock data:** Provide hardcoded Vancouver GeoJSON fixture (40 landmarks + boundary polygon) from the client, simulating the API response that will come from the server.
- **Mock location:** Simulate 4-5 fake GPS positions near the landmarks so the map isn't empty during dev.
- **MapScreen:**
  - `react-native-maps` centered on map's `center` coordinates, zoomed to `defaultZoom`
  - Boundary polygon rendered as translucent overlay
  - Landmark markers colored by status (grey / team color / team color + lock icon)
  - Live team location markers (from Zustand `useLocationStore`, initially seeded by mock)
  - Bottom detail panel on marker tap: name, image, status text, **Claim** button (visible only when GPS within vicinity radius)
- **Location tracking:** `expo-location` GPS permission request, periodic pings into store (and to socket when integrated)
- **Boundary polygon rendering** helper in `MapUtils.ts`

**Verify:**
- Map renders with all 40 landmark markers from the Vancouver fixture
- Boundary polygon renders as overlay
- Map centers on Vancouver coordinates
- Tapping a landmark opens detail panel with correct info
- Claim button shows/hides based on whether GPS (or mock GPS) is within 30m
- Team location markers show at mock positions

### 4B — Server Landmark Endpoints & Vicinity

- `GET /api/games/:gameId/landmarks` — returns landmarks + map metadata (center, default zoom)
- `GET /api/games/:gameId/map` — returns the full GeoJSON data for rendering boundary polygon
- Haversine distance utility in `game/logic.ts`
- Vicinity check enforced server-side on all claim/challenge actions (reject if outside radius)

**Verify:**
- `GET /api/games/:gameId/landmarks` returns correct landmarks for the game
- Haversine returns correct distances (compare against known coordinate pairs)
- Vicinity check correctly allows/rejects based on radius

### 4C — Map Integration

- Wire `MapScreen` to real API endpoints for landmark/map data
- Wire location pings to real socket `location_update` event
- Team location markers now show real GPS positions from all connected clients

**Verify:**
- Landmark positions match real server data
- Boundary polygon renders from server GeoJSON
- Own GPS position appears and updates
- Other team members' positions visible after they join

---

## Phase 5 — Claim & Challenge System

### 5A — Client Claim Screen (with mocks)

- **Mock service:** `services/__mocks__/api.ts` responds to claim/challenge requests with success/failure based on simple in-memory state
- **ClaimScreen:**
  - Active only when GPS within a landmark's vicinity; otherwise show "Move closer to a landmark"
  - Shows landmark info (name, image)
  - **Camera flow:** `expo-camera` → take selfie → preview → confirm/retake
  - On confirm: POST claim → mock succeeds → update local landmark color
  - If landmark owned by other team: show "You will steal this Landmark from {team}" modal before confirming
  - **Challenge flow:** after successful claim, show challenge text + 3 buttons (Complete / Fail / Veto)
  - On challenge complete: show lock icon; on fail/veto: stays claimed
  - "Challenge Unavailable" if already attempted or locked
- Mock socket simulates `state_update` events so the Map tab colors update in response to claims

**Verify:**
- Walk within 30m of a landmark → Claim tab activates with correct landmark info
- Camera opens, takes photo, preview works, confirm processes claim
- Claim on rival's landmark → steal confirmation modal → claim transfers ownership
- Challenge buttons fire and update state correctly in store
- "Challenge Unavailable" when already attempted

### 5B — Server Claim & Challenge Logic

- `POST /api/games/:gameId/claim`:
  - Validate: game active, team not frozen, within vicinity, landmark exists
  - If unclaimed → assign to team
  - If claimed by other → transfer (steal)
  - Cannot claim own already-claimed landmark
- `POST /api/games/:gameId/challenge`:
  - Validate: within vicinity, one attempt per team per landmark, not already locked
  - Complete → set `landmark_state.locked = true`
  - Fail/Veto → record attempt, landmark stays unlocked
- Win check after every mutation: `count >= game.config.winThreshold` → emit `game_ended` with winner
- Log all events to `event_log`
- Emit `state_update` via socket to game room after every mutation

**Verify:**
- Claim unclaimed landmark → assigned to team, socket broadcasts update
- Steal from rival → ownership transfers, event logged
- Complete challenge → landmark locked, cannot be stolen
- Fail/Veto → landmark stays unlocked, no further attempts allowed for that team
- Attempt on locked landmark → rejected
- Frozen team claim → rejected
- Claim outside vicinity → rejected
- 20th claim (or threshold) → game ends immediately

### 5C — Claim Integration

- Swap client claim/challenge from mock to real API + socket
- End-to-end: claim flows through camera → API → server → socket broadcast → other clients see update

**Verify:**
- Full claim/steal/lock flow works end-to-end across multiple devices
- Win condition triggers on threshold
- Event log entries created on server

---

## Phase 6 — Tag System

### 6A — Client Tag Screen (with mocks)

- **Mock service:** mock API validates tag rules locally (no-tag period, freeze state, cooldowns) using in-memory state
- **TagScreen:**
  - If frozen: show freeze countdown timer, disable all action buttons (app-wide freeze overlay)
  - If not frozen: **Tag** button → team selector modal → confirm → send tag
  - Block tag button during no-tag period (show countdown to unlock)
  - **Dispute flow:** if recently tagged and within window → **Dispute** button + countdown → confirm → void
  - If window lapsed → show "Tag Confirmed" + freeze timer
  - Freeze overlay: blocks all claim/challenge/tag interactions app-wide
  - Re-tag cooldown display
- Mock socket simulates `tag_frozen`, `tag_dispute_window`, `tag_voided` events

**Verify:**
- First 10 min: Tag button shows "Tagging unavailable" with timer
- After 10 min: tag works → target shows frozen state
- Frozen team sees freeze overlay across all tabs
- Dispute within window → voided immediately
- Window lapses → freeze continues
- Same team re-tag blocked for 5 min cooldown

### 6B — Server Tag Logic

- `POST /api/games/:gameId/tag`:
  - Validate: game active, tagger not frozen, no-tag period elapsed, re-tag cooldown inactive
  - Create tag event, emit `tag_frozen` to target, start 60s dispute window
- `POST /api/games/:gameId/dispute`:
  - Validate: within dispute window, caller is the target
  - Set disputed + voided on tag record, emit `tag_voided` → target unfrozen immediately
- `POST /api/games/:gameId/acknowledge-tag` — target lets window lapse → tag confirmed
- Timer management: freeze end, re-tag cooldown (per tagger-target pair). Pause freezes all timers (store as remaining duration)
- Frozen state enforced server-side: reject claim/challenge/tag actions
- No-tag period enforced for first 10 min of game clock

**Verify:**
- Tag within no-tag period → rejected
- Tag creates freeze on target → socket event sent
- Dispute within window → voided, unfrozen
- Dispute after window → rejected
- Frozen team actions rejected
- Pause freezes timers, resume continues from correct remaining time
- Re-tag cooldown enforced

### 6C — Tag Integration

- Swap client tag from mock to real API + socket
- End-to-end: tag from device A → freeze on device B → dispute from B → void confirmed on A

**Verify:**
- Full tag/dispute flow works across multiple devices
- Freeze overlay correctly blocks claim/challenge/tag
- Timers sync correctly across all devices

---

## Phase 7 — Game Tab & Log Tab

### 7A — Client Game & Log Screens (with mocks)

- **Mock data:** mock scoreboard (fake rankings that update periodically), mock event log (canned entries)
- **GameScreen:**
  - Live scoreboard: teams ranked by claimed count, then locked count (updates via mock socket events)
  - Game clock countdown (synced with server via socket, but mocked initially)
  - Host-only: Pause / Resume / End Game buttons
  - Pause overlay: when game paused, show "Game Paused" banner across all screens
- **LogScreen:**
  - Chronological event FlatList
  - Filter dropdown by team
  - New entries appear at bottom as mock socket events arrive
- Mock socket simulates scoreboard updates, pause/resume, log entries

**Verify:**
- Scoreboard shows correct ranking
- Clock counts down
- Host buttons visible for host role, hidden for non-hosts
- Pause overlay shows when game is paused
- Log shows events, filter narrows by team

### 7B — Server Scoreboard, Log & Session Control

- `GET /api/games/:gameId/scoreboard` — teams sorted by claimed count, then locked count
- `GET /api/games/:gameId/log` — paginated event log, filterable by team
- `PUT /api/games/:gameId/pause` — set status to paused, emit `game_paused`, freeze clock
- `PUT /api/games/:gameId/resume` — set status to active, emit `game_resumed`, resume clock
- `PUT /api/games/:gameId/end` — set status to ended, emit `game_ended`, compute winner
- Server-side game clock: track `started_at` + accumulated `paused_duration` for accurate remaining time
- On game end: compute winner (most claimed → most locked → tie)

**Verify:**
- Scoreboard endpoint returns correct rankings
- Log endpoint paginates and filters correctly
- Pause/resume toggles game status, clock stops/restarts
- End computes winner correctly (normal case, tiebreaker, tie)

### 7C — Game & Log Integration

- Wire GameScreen and LogScreen to real server API + socket events
- Remove mock scoreboard/log data

**Verify:**
- Scoreboard updates in real-time from server events
- Clock reflects accurate server-side time, including pause/resume
- Host controls work across all connected devices
- Log shows all events from the game with correct timestamps

---

## Phase 8 — Reconnection & Edge Cases

### 8A — Client Offline Resilience (with simulated disconnect)

- **Action queue:** `services/actionQueue.ts` — caches outgoing actions (claim, challenge, tag, dispute) to AsyncStorage when socket is disconnected
- **Mock socket disconnect:** add a `simulateDisconnect()` method to mock socket to test offline behavior
- On reconnect: flush queue in order, show pending indicator for queued actions
- Zustand stores persist critical state to AsyncStorage (gameId, teamId, last known landmark states)
- On app launch: check AsyncStorage for active game → attempt reconnect

**Verify:**
- Mock disconnect → perform actions → reconnect → actions flushed in order
- State persists across app restart → reconnects to same game

### 8B — Server Backfill

- Per-team state versioning (increment counter on each mutation)
- On `join_game` from reconnecting client: send `game_state_sync` with full game config, clock state, all landmark states, team info + freeze statuses, scoreboard, recent log entries (last 100)
- Idempotent processing: reject or deduplicate actions with already-processed client-generated action IDs

**Verify:**
- Reconnecting client receives full state snapshot
- Duplicate action IDs ignored (no double-claims)

### 8C — Reconnection Integration

- Kill client connection → perform actions → reconnect → actions sent, state synced
- App relaunch mid-game → reconnects and receives full state
- Verify no data loss or inconsistencies

**Verify:**
- Full reconnect cycle works end-to-end
- No duplicate processing of actions
- All connected clients converge on same game state

---

## Phase 9 — Testing & Polish

### 9A — Server Tests (Jest + supertest)

- **Unit:** win condition calculation, vicinity check, tiebreaker logic, timer math
- **Integration:** all REST endpoints (map import, game CRUD, join, start, claim, challenge, tag, dispute, pause/resume/end, scoreboard, log)
- **Socket:** connect/disconnect, room join/leave, emit/receive round-trip, reconnection backfill
- **Edge cases:** frozen rejects claim, locked rejects steal, tag during no-tag period, tag cooldown enforcement, idempotent actions, map validation rejects invalid GeoJSON, instant win at threshold, tiebreaker scenarios, pause freezes timers correctly

### 9B — Client Tests (Jest + RNTL)

- **Component:** MapScreen renders markers, GameScreen shows scoreboard, TagScreen shows freeze overlay
- **Store:** Zustand state transitions on mock socket events for all event types
- **Service:** API client functions (mock + real), action queue persistence and flush, socket event registration
- **Navigation:** tab switching renders correct screens, lobby→game conditional flow
- **Mock integration:** full game flow using mock services (lobby → map → claim → tag → scoreboard)

### 9C — Polish

- Loading states and error boundaries across all screens
- GPS permission denied flow (show manual location entry fallback or instructional screen)
- Camera permission denied flow (show explanation, link to settings)
- Server disconnect banner with reconnection indicator
- Marker clustering or viewport filtering for large maps (dynamic, based on landmark count)
- Consistent color scheme: team colors, landmark status colors, UI accents
- Adequate hit targets for markers and buttons on mobile
- Graceful handling of empty states (no map loaded, no logs yet, no landmarks nearby)

**Verify:**
- `npm test` passes in both `app/` and `server/`
- Full manual walkthrough on device: lobby → select map → play → navigate map → claim → challenge → tag → dispute → check scoreboard → check log → game ends
- Edge cases: disconnect/reconnect mid-game, GPS permission denied, import invalid map file, tiebreaker win, instant win at threshold

---

## Architecture Decisions

| Decision | Choice |
|---|---|
| Database | PostgreSQL |
| Client state | Zustand |
| Real-time | Socket.IO |
| Maps library | react-native-maps |
| Map file format | GeoJSON FeatureCollection + metadata wrapper |
| Map import | expo-document-picker + expo-file-system |
| Camera | expo-camera |
| Server validation | zod |
| Server testing | Jest + supertest + socket.io-client |
| Client testing | Jest + @testing-library/react-native |
| Mock strategy | Shared TypeScript interfaces, flag-gated real vs mock service layer |
| Project structure | Feature-based (server: layered; client: screens/components/stores/services) |
| TypeScript | Strict mode in both projects |
