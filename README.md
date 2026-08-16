# Art Thieves

Multiplayer location-based tag game built with Expo (React Native) and a Node.js/Socket.IO server.

## Prerequisites

- Node.js 18+
- npm
- Android Emulator (AVD) or physical Android device
- Windows (for included scripts) or manual configuration for macOS/Linux

## Setup

```sh
# Install server dependencies
cd server
npm install

# Install app dependencies
cd ../app
npm install
```

## Running (development)

### 1. Start the server

```sh
cd server
npm run dev
```

Starts on `http://localhost:3001`.

### 2. Start the app

```sh
cd app
npx expo run:android
```

Builds and installs the app on the first available emulator. To install on a second emulator, use:

```sh
npx expo run:android          # installs on emulator 1
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Then open the app manually on the second emulator. Both instances reload from the same Metro dev server.

### Physical device

Set `EXPO_PUBLIC_API_URL` in `app/.env` to your computer's LAN IP on port 3001, start the server, then:

```sh
cd app
npx expo run:android --device
```

## Architecture

- `server/` — Express + Socket.IO backend with in-memory data store
- `app/` — Expo React Native app with Zustand stores, MapLibre maps, and Socket.IO client

### Physical device

Set `EXPO_PUBLIC_API_URL` in `app/.env` to your computer's LAN IP on port 3001, start the server, then:

```sh
cd app
npx expo run:android --device
```

## Configuration

All environment variables for the **app** (`app/.env`) and the **server** (`server/.env`)
are documented in **[ENV.md](ENV.md)** — including persistence mode (`PERSIST`), the database
path, the API base URL, and the map style. Templates with every option live in
`app/.env.example` and `server/.env.example`.

Game settings (duration, vicinity radius, no-tag grace period, etc.) are configurable by the host when creating a game.

## Self-host the server (Docker)

A ready-to-run image is published to GitHub Container Registry as
`ghcr.io/lo3wer/vancouver-art-thieves-server` (multi-arch: `linux/amd64` + `linux/arm64`),
tagged on each `v*` release plus a rolling `latest`. No build tools needed on the host.

### Quick start

```sh
docker run -d --name art-thieves \
  -p 3001:3001 \
  -v art-thieves-data:/data \
  -v art-thieves-uploads:/app/uploads \
  ghcr.io/lo3wer/vancouver-art-thieves-server:latest
```

The server listens on `http://<host>:3001`. On first start it creates the SQLite database,
runs migrations, and seeds a default map. The database lives in the `art-thieves-data`
volume and uploaded photos in `art-thieves-uploads` — both survive restarts and upgrades.

### Environment variables

| Variable         | Default           | Purpose                                        |
| ---------------- | ----------------- | ---------------------------------------------- |
| `PORT`           | `3001`            | HTTP/Socket.IO listen port                     |
| `PERSIST`        | `true`            | `false` = in-memory store (ephemeral)          |
| `DATABASE_PATH`  | `/data/vat.db`    | SQLite database file path                      |
| `MIGRATIONS_DIR` | `./drizzle`       | Drizzle migrations folder (in the image)       |
| `UPLOADS_DIR`    | `/app/uploads`    | Folder for uploaded game photos                |

### HTTPS (production)

The image serves plain HTTP on port 3001. Put a reverse proxy in front for TLS. Example with
Caddy (auto HTTPS):

```yaml
services:
  app:
    image: ghcr.io/lo3wer/vancouver-art-thieves-server:latest
    restart: unless-stopped
    volumes:
      - art-thieves-data:/data
      - art-thieves-uploads:/app/uploads
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [app]
volumes:
  art-thieves-data:
  art-thieves-uploads:
  caddy_data:
  caddy_config:
```

with a `Caddyfile` like:

```
your.domain.com {
  reverse_proxy app:3001
}
```

### Point the app at your server

Set `EXPO_PUBLIC_API_URL` in `app/.env` to your server URL (e.g. `https://your.domain.com/`)
and rebuild the app. `EXPO_PUBLIC_*` values are baked in at build time.
