# Implementation Plan — Landmarks Game

**Stack:** React Native (Expo SDK 57) · Express.js 5 · PostgreSQL · Socket.IO · Zustand · react-native-maps · Jest

---

## Development Order

1. **Part 1 — Full App (client with mocks):** Build every screen, component, store, and navigation. A mock service layer simulates all server responses so the entire app is navigable and testable without a backend.
2. **Part 2 — Server Business Logic (in-memory):** Build the entire Express + Socket.IO server with an in-memory data store. Same behaviour as the final system, but no database dependency. The client switches from mocks to the real server.
3. **Part 3 — Database Integration:** Replace the in-memory store with PostgreSQL. Add migrations, connection pooling, and schema queries. Everything else stays the same.

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
  - 3 buttons: **Complete** / **Fail** / **Veto**
  - Complete → lock icon shown; Fail/Veto → stays claimed
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
  - Chronological event FlatList (claim, steal, lock, challenge fail/veto, tag, dispute, pause/resume, game start/end)
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
- Client→Server events: `location_update`, `claim_landmark`, `steal_landmark`, `complete_challenge`, `fail_challenge`, `veto_challenge`, `tag_team`, `dispute_tag`, `pause_game`, `resume_game`, `end_game`
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
  - Complete → lock; Fail/Veto → record attempt
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

## Part 3 — Database Integration

### Goal: Replace in-memory store with PostgreSQL. No behavioural changes — everything that worked in Part 2 still works.

---

### 3.1 — Database Setup

- Add dependencies: `pg`
- Add `config/db.ts`: PostgreSQL pool creation from `DATABASE_URL`
- Create migration files (run on startup):
  ```sql
  -- 001_create_tables.sql
  CREATE TABLE maps (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    center_lat DOUBLE PRECISION NOT NULL,
    center_lng DOUBLE PRECISION NOT NULL,
    default_zoom INT NOT NULL,
    default_vicinity_radius INT NOT NULL,
    win_threshold INT NOT NULL DEFAULT 20,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE games ( ... );
  CREATE TABLE teams ( ... );
  CREATE TABLE landmarks ( ... );
  CREATE TABLE landmark_state ( ... );
  CREATE TABLE challenge_attempts ( ... );
  CREATE TABLE location_pings ( ... );
  CREATE TABLE tag_events ( ... );
  CREATE TABLE push_tokens (
    id UUID PRIMARY KEY,
    game_id UUID NOT NULL REFERENCES games(id),
    team_id UUID NOT NULL REFERENCES teams(id),
    token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(game_id, team_id, token)
  );
  CREATE TABLE event_log ( ... );
  ```
- Seed script: insert Vancouver Downtown map on first run

**Verify:**
- Server connects to PostgreSQL
- All tables created
- Vancouver map seeded

---

### 3.2 — Replace In-Memory Store with DB Queries

- Create `src/models/` with query functions for each table:
  - `MapModel` — insert, findAll, findById
  - `GameModel` — create, findByJoinCode, findById, updateStatus, updateConfig
  - `TeamModel` — create, findByGame
  - `LandmarkModel` — bulkCreate (from map snapshot), findByGame
  - `LandmarkStateModel` — upsert (claim, steal, lock), findByGame, findByTeam
  - `ChallengeAttemptModel` — create, findByTeamAndLandmark
  - `PushTokenModel` — register, findByGameAndTeam, remove (invalid token cleanup)
  - `LocationPingModel` — create, findByGame
  - `TagEventModel` — create, findActiveByTarget, updateDispute
  - `EventLogModel` — insert, findByGame (paginated, filterable)
- Models implement the same interface as the in-memory store, so route handlers and socket handlers don't change
- Replace `data/store.ts` references with model calls

**Verify:**
- All endpoints still return correct results (run the same supertest suite)
- All game logic unchanged (pure functions in `game/logic.ts` need no changes)
- Data persists across server restart

---

### 3.3 — Location History & Query Performance

- Add indexes: `location_pings(game_id, timestamp)`, `event_log(game_id, type)`, `landmark_state(game_id, landmark_id)`
- Location pings now persisted to DB (was optional in-memory). This enables post-game route replay.
- Verify query performance for 40 landmarks, 3 teams, 1000+ location pings

**Verify:**
- Location history query works
- Post-game route data available (no dedicated UI yet, but data exists)

---

### 3.4 — Final Test Pass

- Run all server tests against PostgreSQL (test database, reset between runs)
- Run all client tests (unchanged)
- Full manual walkthrough on device
- Verify data persists: start game → make claims → restart server → rejoin → state intact

**Verify:**
- `npm test` passes in both `app/` and `server/`
- Full game flow works with persistent storage
- Server restart doesn't lose game state

---

## Architecture Decisions

| Decision | Choice |
|---|---|
| Database | PostgreSQL (added last via model layer) |
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
| In-memory → DB | Data access layer with swappable implementation (in-memory for Part 2, SQL for Part 3) |
| Project structure | Feature-based (server: layered; client: screens/components/stores/services) |
| TypeScript | Strict mode in both projects |
