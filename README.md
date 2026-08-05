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
