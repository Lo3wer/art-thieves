# Deployment Plan — Oracle Cloud Always Free + GitHub Actions

Hosts the `server/` (Express + Socket.IO + SQLite) on an **Oracle Cloud Always Free** VM
(Ampere A1 ARM), with CI/CD via **GitHub Actions** that SSHes in, pulls, and rebuilds the
Docker containers on the VM ("build on VM", Strategy A).

- App domain: `https://oracle.leoswebsite.com`
- Repo: `github.com/Lo3wer/vancouver-art-thieves` (branch `main`)
- Stack: Node 22, Socket.IO, Express, better-sqlite3, Caddy (auto HTTPS), Docker Compose

## Architecture

```
push:main ──> GitHub Actions ──SSH(deploy_key)──> Oracle VM (ubuntu@<ip>)
                                                   │ /opt/art-thieves
                                                   │   git pull --ff-only
                                                   │   docker compose up -d --build   (native arm64)
                                                   ▼
                     Caddy :80/:443 (auto TLS) ──> app :3001 (Socket.IO/Express)
                                                      ├─ /data/vat.db    (bind mount, persistent)
                                                      └─ /app/uploads    (bind mount, persistent)
```

GitHub runners are x86; the VM builds the arm64 image natively so `better-sqlite3` compiles
for the right architecture with no emulation.

## 1. Domain

Use a **subdomain of the existing domain**: `oracle.leoswebsite.com`.

- Point a DNS `A` record `game` at the Oracle VM public IP.
- Does not affect the existing website.
- Caddy auto-provisions a Let's Encrypt certificate for the subdomain (required by the RN app).
- If DNS is managed by Cloudflare, create the record as **DNS-only (grey cloud)** so Caddy's
  certificate issuance and WebSocket upgrades stay simple.

> GitHub Pages (`leoswebsite.github.io`) **cannot** be used — static hosting only, no Node
> process, no WebSockets, no DNS pointing at the VM.

## 2. SSH hardening

Pinning SSH source-restriction to GitHub's runner IPs is impractical (the `actions` list is
thousands of changing CIDRs). Recommended posture:

- **Key-only auth** (OCI Ubuntu default): `PasswordAuthentication no`, `PermitRootLogin no`,
  `AllowUsers ubuntu` in `/etc/ssh/sshd_config`.
- **fail2ban** with an `sshd` jail to auto-ban brute-force attempts.
- **OCI security list**:
  - TCP `80` / `443` from `0.0.0.0/0`
  - TCP `22` from the admin's own public IP
- GitHub Actions connects via key-only auth with a dedicated deploy key.
- Optional extra: cron job on the VM that syncs `https://api.github.com/meta` ranges into
  `ufw` for SSH if source restriction is desired later.

## 3. Repo changes — exactly 2 commits

### Commit 1 — `feat: add /healthz endpoint` (code only)

`server/src/index.ts`: add a health route before `app.use('/api', routes)`:

```ts
app.get('/healthz', (_req, res) => res.json({ ok: true }));
```

### Commit 2 — `chore: oracle deploy infrastructure` (infra only)

**`server/Dockerfile`** (multi-stage):

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3001
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

`drizzle/` is committed and must ship — `initDb()` runs migrations from it (`server/src/data/db.ts`).

**`server/docker-compose.yml`**:

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    environment:
      PERSIST: "true"
      DATABASE_PATH: /data/vat.db
    volumes:
      - ./data:/data
      - ./uploads:/app/uploads
    expose: ["3001"]
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
  caddy_data:
  caddy_config:
```

Compose sets env directly, so no `.env` file is needed on the VM (dotenv never overrides
existing environment variables).

**`server/Caddyfile`** (auto HTTPS; WebSocket upgrades handled natively):

```
oracle.leoswebsite.com {
  reverse_proxy app:3001
}
```

**`server/.dockerignore`**:

```
node_modules
dist
data
uploads
.env
*.log
```

Do **not** exclude `drizzle/` — migrations must be in the image.

**`.github/workflows/deploy.yml`**:

```yaml
name: Deploy to Oracle
on:
  push:
    branches: [main]
    paths: ["server/**", ".github/workflows/deploy.yml"]
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.ORACLE_HOST }}
          username: ${{ secrets.ORACLE_USER }}
          key: ${{ secrets.ORACLE_SSH_KEY }}
          script: |
            cd /opt/art-thieves && git pull --ff-only
            cd server && docker compose up -d --build
            docker image prune -f
```

**(Optional) `server/scripts/oracle-setup.sh`** — automates step 5 below (docker install,
clone, docker group, fail2ban, sshd lockdown).

## 4. OCI console setup

1. Sign up (credit card required; stays free while under Always Free limits).
2. Create a VCN/subnet; default security list only opens SSH.
3. Add ingress rules:
   - TCP `80` from `0.0.0.0/0`
   - TCP `443` from `0.0.0.0/0`
   - TCP `22` from the admin public IP
4. Launch instance: **Ubuntu 24.04 (ARM64)**, shape **Ampere A1** (**1 OCPU / 6 GB** — the minimum, and safely under the 2 OCPU / 12 GB Always Free allocation), add SSH key.
   - Note: ARM shape can be "out of capacity" — retry or switch availability domain.
5. Note the public IP.

## 5. One-time VM setup (manual SSH: `ssh -i oci_key ubuntu@<ip>`)

1. Install Docker + Compose + fail2ban:
   ```sh
   sudo apt update && sudo apt install -y docker.io docker-compose-v2 fail2ban
   sudo usermod -aG docker ubuntu
   ```
2. Lock down sshd (`PasswordAuthentication no`, `PermitRootLogin no`, `AllowUsers ubuntu`);
   restart sshd; enable fail2ban.
3. Clone the repo:
   ```sh
   sudo mkdir -p /opt/art-thieves && sudo chown ubuntu /opt/art-thieves
   cd /opt/art-thieves && git clone https://github.com/Lo3wer/vancouver-art-thieves.git .
   ```
4. **VM → GitHub pull key** (so `git pull` works non-interactively):
   ```sh
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""
   ```
   Add the **public** key (`~/.ssh/id_ed25519.pub`) as a read-only **Deploy key**
   (GitHub repo → Settings → Deploy keys). Configure `~/.ssh/config` for `github.com`.
5. **Workflow → VM key** (allows GitHub Actions to SSH in):
   ```sh
   # locally:
   ssh-keygen -t ed25519 -a 100 -f deploy_key
   # on VM, append deploy_key.pub:
   echo "<deploy_key.pub contents>" >> ~/.ssh/authorized_keys
   ```
6. First build (runs migrations against `data/vat.db`):
   ```sh
   cd /opt/art-thieves/server && docker compose up -d --build
   ```

## 6. GitHub repo secrets

Settings → Secrets and variables → Actions:

| Name             | Value                          |
| ---------------- | ------------------------------ |
| `ORACLE_HOST`    | Oracle VM public IP            |
| `ORACLE_USER`    | `ubuntu`                       |
| `ORACLE_SSH_KEY` | private key of `deploy_key`    |

Never commit the private key.

## 7. DNS + app

1. Add DNS `A` record: `game` → Oracle VM public IP (DNS-only if Cloudflare).
2. Set the app API URL in `app/.env`:
   ```
   EXPO_PUBLIC_API_URL=https://oracle.leoswebsite.com/
   ```
   `EXPO_PUBLIC_*` values are baked at build time — rebuild:
   ```sh
   cd app && npx expo run:android
   ```
3. Verify the server: `curl https://oracle.leoswebsite.com/healthz`

## 8. Day-2 operations

- **Redeploy**: push to `main` (server-only paths) or run `workflow_dispatch`. DB/uploads
  survive every deploy (bind mounts).
- **Rollback**: on the VM, `git reset --hard <sha>` then `docker compose up -d --build`.
- **Backup**: cron `rsync` of `/opt/art-thieves/server/data` and `server/uploads`.
- **Uptime**: monitor `https://oracle.leoswebsite.com/healthz`.

## Cost check

Everything above is within Oracle Always Free limits: **2 ARM OCPUs / 12 GB RAM** (reduced
from 4/24 in July 2026), 200 GB boot volume, public IP. Node + Caddy will use well under 1 GB
RAM, so a single 1 OCPU / 6 GB instance is plenty.