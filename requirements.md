# Landmarks — Game & App Requirements

**Stack:** React Native (client) · Express.js (backend) · WebSockets (real-time) · Database (persistence + location history)

---

## 1. Premise

Three teams compete to claim the most public art installations ("Landmarks") across a city map within a host-configured time limit. A default Vancouver map is included; hosts may import custom maps for other cities (see §2.6). All teams can see each other's live location throughout the game. First team to reach the configured win threshold of claimed Landmarks wins outright; otherwise the team with the most Landmarks when time expires wins.

---

## 2. Core Game Rules

### 2.1 Landmarks
- Landmarks are defined in the game's selected map (see §2.6). The default Vancouver map includes 40 landmarks; custom maps may have any number. Each landmark has an optional challenge.
- **Claim**: a team claims a Landmark by visiting it (within the vicinity radius) and taking a selfie in front of it.
- **Steal**: visiting a Landmark already claimed by another team transfers the claim to the visiting team. The app must show a confirmation ("You will steal this Landmark from {team}") before finalizing.
- **Lock**: completing a Landmark's challenge locks it — it can no longer be stolen. Failing or vetoing leaves it claimed but vulnerable to steal.
- **Notifications**: when a team's landmark is claimed or stolen, all members of that team receive a push notification ("{team} claimed {Landmark}" / "{team} stole {Landmark} from you").
- **Challenge attempts**: each team gets exactly one attempt (complete/fail/veto) per Landmark, tracked independently per team — a team that steals a Landmark gets its own fresh attempt regardless of the previous holder's outcome.
- **Vicinity radius**: default 30m from a Landmark's coordinates, host-configurable at setup. Required to claim or attempt a challenge.

### 2.2 Win Conditions
- **Instant win**: the moment a team's claimed-Landmark count reaches the configured win threshold (locked or unlocked both count), the game ends immediately. Threshold defaults to 20 and is host-configurable at setup.
- **Time-limit win**: if the timer expires first, the team with the most claimed Landmarks wins.
- **Tiebreaker**: most locked Landmarks. If still tied, both/all tied teams win.

### 2.3 Tagging (Honor System)
- Any team can tag any other team at any time by pressing **Tag** and selecting the target team — no GPS proximity check and no photo required.
- Tagging immediately freezes the target team.
- While frozen, a team cannot: move (in-game sense — no claim/challenge actions), claim Landmarks, attempt/complete/veto challenges, or tag other teams.
- Freeze duration: 10 minutes.
- **Dispute**: the tagged team sees a Dispute button for a short window after being tagged (default 60s). Pressing it auto-voids the tag immediately with no penalty to either side. Ignoring it means the tag stands.
- **Notifications**: the tagged team receives a push notification ("You've been tagged by {team}"). The tagging team receives a push notification if their tag is disputed or confirmed.
- **No-tag period**: first 10 minutes of the game, tagging is disabled entirely.
- **Re-tag cooldown**: a team cannot be tagged again by the same team for 5 minutes after a freeze ends (default, host-configurable), to prevent tag-camping lockouts.
- Multiple teams can be tagged in the same action only if each is tagged individually (one target per Tag press).

### 2.4 Live Location Sharing
- All teams' locations are visible to all other teams on the Map tab, updated near real-time (target: every few seconds).
- Location pings are persisted with timestamps per team for the duration of the game (see §5.3).

### 2.5 Transit
- Not tracked by the app. Teams manage their own transit/payment (e.g., Compass Card) outside the game system.

### 2.6 Maps & Geographies

Each game uses one **map** — a dataset that defines the playable area, its landmarks, and configuration defaults.

#### Map Contents
Every map includes:
- **Metadata**: city/area name, default center coordinates, default zoom level, default vicinity radius, and win threshold.
- **Geographic boundary**: a GeoJSON Polygon or MultiPolygon defining the playable area (informational; not enforced by GPS).
- **Landmarks**: an array of points, each with a name, coordinates (lat/lng), optional image URL, and optional challenge text.

#### GeoJSON Format
Maps are stored and imported as **GeoJSON FeatureCollections** wrapped in a metadata object:

```typescript
interface GameMap {
  name: string;
  center: { lat: number; lng: number };
  defaultZoom: number;
  defaultVicinityRadius: number; // metres
  winThreshold: number;          // claims needed to win (default 20)
  data: GeoJSON.FeatureCollection;
}
```

Within the FeatureCollection:
- `Point` features with `type: "landmark"` in properties represent landmarks. Required properties: `name`. Optional: `challengeText`, `imageUrl`.
- `Polygon` / `MultiPolygon` features with `type: "boundary"` in properties represent the playable boundary.

#### Default Map
The app ships with a built-in Vancouver Downtown map (40 landmarks) that is preloaded into the database on first run.

#### Importing Custom Maps
- During lobby setup, the host can tap **Import Map** to select a `.geojson` or `.json` file from the device.
- The file is validated on the server against the expected schema; malformed files are rejected with a descriptive error.
- On success, the map is persisted in the database and available for future games.
- The host can also browse and re-use previously imported maps.

#### Map Selection
- During game setup, the host chooses which map to use: the default Vancouver map, or any previously imported custom map.
- The selected map's landmarks and boundary are copied into the game record at game creation (snapshot, not live reference), so editing a map later doesn't affect running or finished games.

### 2.7 Game Session Control
- A host creates a lobby and receives a join code; other devices join as teams (name + color).
- Only the host can **Start / Pause / Resume / End** the game.
- Pausing freezes the game clock, all freeze timers, and disables all game actions (claim, challenge, tag) app-wide until resumed. This covers breaks (e.g., lunch) without a dedicated rule. All teams receive a push notification when the game is paused, resumed, or ended.
- Host configures at setup: map (select from default or previously imported), game duration, vicinity radius, win threshold, re-tag cooldown, dispute window length, and optionally imports a custom map (see §2.6).

### 2.8 Communication
- Opposing teams may communicate freely outside the app (no in-app restriction).

### 2.9 Push Notifications

Push notifications supplement real-time socket events for when the app is backgrounded or closed. They do not replace in-app state sync — socket events remain the source of truth for all game state.

#### Notification Triggers
- **Tag received**: the targeted team receives a notification ("You've been tagged by {team}! You have {disputeWindow}s to dispute.") with a deep link to the Tag tab.
- **Tag disputed/confirmed**: the tagging team is notified when the target disputes or confirms the tag.
- **Claim/Steal**: all members of a team receive a notification when one of their landmarks is claimed or stolen by another team.
- **Game paused/resumed/ended**: all players receive a notification with the current game status.

#### Delivery
- Notifications use Expo Push Notifications (FCM on Android, APNs on iOS).
- Each device registers its push token with the server during lobby join.
- The server sends push notifications via the Expo Push API when the corresponding game event occurs.
- Notifications are best-effort (no guarantees if the device is offline), but socket reconnection handles missed state on app reopen.

---

## 3. App Structure

Tab-based navigation, consistent across teams' devices; host device additionally has session controls.

### 3.1 Lobby (pre-game)
- Host: Create Game → generates join code → **select a map** (default Vancouver or previously imported) → optionally **Import Map** from a `.geojson`/`.json` file → configure settings (duration, vicinity radius, win threshold, cooldowns) → optionally review/edit landmarks → Start Game.
- Team devices: Enter join code → choose team name + color → wait for host to start.

### 3.2 "Game" Tab
- Scoreboard: teams ranked by total claimed Landmarks (live-updating).
- Game clock (counts down; reflects host pause/resume state).
- Host-only: Pause / Resume / End Game controls.

### 3.3 "Map" Tab
- Top section: pannable/zoomable map with:
  - Landmark waypoints, colored by status (grey = unclaimed, team color = claimed, lock icon + partial transparency = locked).
  - Live pins for all teams' current locations, updating in near real-time, distinct per team color.
- Bottom section: tapped-waypoint detail panel — name, image, status (unclaimed / claimed by {team} / locked by {team}), and a **Claim** button (only shown/enabled when the viewing team's GPS is within the vicinity radius) that navigates to the Claim tab.

### 3.4 "Claim" Tab
- Active only when the team's GPS is within a Landmark's vicinity radius; shows that Landmark's info (name, image).
- **Claim flow**: opens camera → team selfie → confirm/retake → on confirm, updates status to claimed (with steal confirmation if applicable).
- **Challenge flow**: displays challenge text with three buttons — **Complete**, **Fail**, **Veto**.
  - Complete → Landmark becomes locked.
  - Fail / Veto → Landmark stays claimed but vulnerable; logged distinctly; no further attempts allowed for this team.
  - If the Landmark is already locked, or this team has already failed/vetoed here, show **"Challenge Unavailable"** instead of the challenge.

### 3.5 "Tag" Tab
- **Tag** button + team selector (choose which rival team to tag) → immediate freeze on target, no camera/photo step.
- If this team is currently frozen: show countdown timer, disable Tag button and all challenge/claim actions.
- If this team was just tagged: show **Dispute** button for the configured dispute window; pressing it auto-voids the tag (logged); letting the window lapse confirms the tag.
- Confirmation is required for both tag and dispute.

### 3.6 "Log" Tab
- Chronological, timestamped event feed: claims, steals, locks, failed/vetoed challenges, tags (including disputes/voids), pauses/resumes, game start/end.
- Filterable by team.
- Push notifications supplement real-time socket events when the app is backgrounded (see §2.9).

---

## 4. Real-Time & Backend Architecture

- **Client**: React Native app (single codebase, host and team roles differentiated by lobby role, not separate builds). Uses `expo-notifications` for push notification registration and handling.
- **Server**: Express.js REST API for setup/config/auth-lite (join codes), a **WebSocket layer** for real-time state sync, and **push notifications** via Expo Push API for tag, claim, and pause events.
  - Live location broadcast (per-team position pushed every few seconds).
  - Live game-state sync (claims, steals, locks, tags, freezes, pause/resume, scoreboard, log entries) so all devices reflect state changes immediately without polling.
- **Reconnection handling**: given outdoor/downtown GPS and connectivity gaps are likely, clients should queue outgoing actions (claim/tag/challenge results) locally and resync on reconnect; server should backfill missed state to a reconnecting client rather than assume continuous connection.
- **Database**: persists —
  - Game/lobby metadata and settings (including selected map reference)
  - Teams (name, color, join info)
  - **Push tokens**: per-device Expo push tokens, associated with a team in a game (for targeted notifications)
  - **Maps**: imported map files (metadata + GeoJSON data), referenced by games but independent so a map can be reused across games
  - Landmarks (snapshot copied from the selected map at game creation: name, coordinates, image, challenge text)
  - Landmark state (status, holder, locked flag) and per-team challenge attempt records
  - **Location history**: timestamped location pings per team for the game's duration (supports the live feed, plus enables post-game route review/replay if desired)
  - Tag events (tagger, target, timestamp, disputed/void status)
  - Full event log (for the Log tab and any post-game audit)

---

## 5. Open Defaults (confirm or adjust)

These were set to sensible defaults during this process — flag if you want different values before implementation:

| Item | Default |
|---|---|---|
| Default map | Vancouver Downtown (40 landmarks, bundled with app) |
| Vicinity radius | 30m (per-map default, host-overridable) |
| Win threshold | 20 claims (host-configurable) |
| Freeze duration | 10 minutes |
| No-tag period at game start | 10 minutes |
| Dispute response window | 60 seconds |
| Re-tag cooldown (same team) | 5 minutes |
| Location update frequency | Every few seconds |
| Push notifications | Enabled (Expo Push API) |
| Token/transit tracking | Removed entirely |

---

## 6. Explicitly Descoped

- In-app transit token tracking (removed per latest change — teams self-manage transit).
- Photo-based tag verification (removed — honor system with dispute/void instead).