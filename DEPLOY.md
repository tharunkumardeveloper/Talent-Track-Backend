# Deploying the backend to Render

## What changed, and why it matters

The Render instance at `rec-backend-yi7u.onrender.com` was running the
**`rec-backend-main/`** copy of the backend, not `server/`. The two had diverged:
production never had face verification, the fuller connections router, or the
dedupe script.

`server/` is now the single canonical backend. `rec-backend-main/` has been
deleted, but **the three routes only it had were ported across first**, because
the frontend calls all three:

| Route | Used by |
|---|---|
| `GET /api/users/:userId` | `EnhancedProfilePageNew` |
| `GET /api/sessions/user/:userId` | `EnhancedProfilePageNew` |
| `GET /api/sessions/:sessionId` | `WorkoutDetailPage` |

Verified before deleting: `server/` is a strict superset — 0 routes lost, 3
gained (`POST /api/verify-face`, `POST /api/sessions/:sessionId/verification`,
`GET /api/users/:userId/profile-image`), plus the new collab endpoints.

## Deploying

Point the Render service at this directory.

- **Build command:** `npm install`
- **Start command:** `npm start` (runs `migrate-and-start.js`)
- **Root directory:** `server` (if deploying from the monorepo root)

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | yes | Server starts without it but falls back to no-DB mode |
| `PORT` | no | Render sets this automatically |
| `CLOUDINARY_URL` | for media | Video/PDF/screenshot upload |

### Collab mode needs WebSockets

Collab attaches a WebSocket server at `/collab` on the same port as the REST API.
Render supports WebSockets on web services with no extra configuration, but note:

- The server must be started via `http.createServer(app)` rather than
  `app.listen` — already done in `server.js`.
- `ws` is a dependency (added for this). Ensure `npm install` runs on deploy.
- Rooms are **in-memory**. A restart or a redeploy drops any active session.
  That is deliberate — a workout room is ephemeral — but it does mean collab is
  unavailable during a deploy.
- **A single instance only.** Rooms live in one process's memory, so if the
  service is ever scaled to multiple instances, two people could be routed to
  different processes and never see each other. Scaling out would need a shared
  store (Redis pub/sub) for room state.

## Verifying a deploy

```bash
BASE=https://rec-backend-yi7u.onrender.com

# Health (first call may take ~20s on free tier - see cold starts below)
curl "$BASE/api/health"

# Routes that must survive the switch
curl -o /dev/null -w "%{http_code}\n" "$BASE/api/sessions/all-athletes"   # 200
curl -o /dev/null -w "%{http_code}\n" "$BASE/api/users/all"               # 200

# New: collab. 404 with a JSON body means the route exists.
curl "$BASE/api/collab/rooms/NOPE"    # {"success":false,"error":"Room not found"}

# Create a real room
curl -X POST "$BASE/api/collab/rooms" \
  -H 'Content-Type: application/json' \
  -d '{"hostName":"Test","activityName":"Push-ups","targetReps":20}'
```

An HTML `Cannot GET /api/collab/...` response means the deploy did **not** pick
up `collab.js`.

## Cold starts

Render's free tier spins the instance down after inactivity. The first request
then takes roughly 20 seconds while it boots (measured: 21s).

The app mitigates this by pinging `/api/health` on launch and whenever it returns
to the foreground (`src/services/backendWarmup.ts`), so the instance is usually
awake before the first real request. Client timeouts for backend calls are 45s
(`REQUEST_TIMEOUT_MS` in `src/config/env.ts`) to allow for a cold boot.

This does **not** affect the app's core: recording, rep counting, scoring,
history and reports all run on-device. Only sync, login and collab need the
server.

To remove cold starts entirely, either upgrade off the free tier or add an
external uptime pinger — but note a keep-alive consumes free-tier instance hours.

## Pointing the app elsewhere

`VITE_BACKEND_URL` in `.env.local` controls which backend the app uses.

```
VITE_BACKEND_URL=https://rec-backend-yi7u.onrender.com   # deployed
VITE_BACKEND_URL=http://localhost:3001                   # local dev
VITE_BACKEND_URL=http://10.0.2.2:3001                    # Android emulator
```

`10.0.2.2` is the host machine as seen from the Android emulator; `localhost`
there refers to the emulated device itself.

For a **physical phone** on the same wifi, use the machine's LAN address
(e.g. `http://192.168.1.20:3001`). Android blocks cleartext HTTP by default, so
that also needs a network security config — HTTPS or the Render URL avoids the
issue.
