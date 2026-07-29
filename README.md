# BotArena

BotArena is split into a Vite/React frontend and a stateless Node backend. The frontend runs the arena simulation and UI. The backend owns secrets and persists durable game state to Supabase.

## Architecture

The repo is a small npm workspace monorepo:

- `frontend/` contains the Vite React client, Three.js arena UI, and client-safe simulation code.
- `backend/` contains the Express API, CORS configuration, health check, and Supabase service-role access.
- `supabase/migrations/` contains the Postgres schema used for durable state.

Durable persistence lives in Supabase Postgres:

- `player_states` stores wallet, bets, betting history, and sponsor stats.
- `bot_pools` stores bot progression, custom bots, journals, relationships, traits, and doctrine.
- `arena_states` stores the current resumable arena phase snapshot.
- `arena_queues` stores queued bot ids.
- `match_results` stores recent match summaries.
- `match_logs` stores full completed-match timelines, highlights, entrants, and result stats for video/script generation.

The browser still keeps a localStorage cache so the app starts instantly and can migrate existing local state, but localStorage is no longer the production source of truth. When `VITE_API_BASE_URL` is configured, the frontend syncs durable mutations to the backend, and the backend writes them to Supabase. Redeploying Vercel or Render does not wipe game state because neither service stores important state on local disk.

Supabase row level security is enabled on all public tables. The frontend does not use Supabase keys directly; only the backend uses the server-only service role key.

## Local Development

Install dependencies:

```bash
npm install
```

Create local env files:

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

Run the backend:

```bash
npm run dev:backend
```

Run the frontend in another terminal:

```bash
npm run dev:frontend
```

Useful checks:

```bash
npm run typecheck
npm run build
```

Local URLs:

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:4000/health` (`ready: true` means the arena engine has restored its checkpoint and started)
- Recent match logs: `http://localhost:4000/api/match-logs`

The live arena requires `VITE_API_BASE_URL`. Browser localStorage is a startup cache for player and roster state, not a replacement for the authoritative arena engine.

## Match Configuration

Core match knobs live in `frontend/src/game/matchConfig.ts`.

Change `DEFAULT_MATCH_CONFIG` to adjust the default arena, or pass a partial config to `createMatch` / `createMatchFromPool` for one-off match variants. The config covers:

- Bot counts and persistent roster size.
- Arena size, spawn radius, loot-zone radius, edge padding, and biome zones.
- Initial loot count, pickup radius, and sponsor-drop radius.
- Win condition, final-phase threshold, and visible event log length.
- Bot AI ranges, wander radius, social scan range, and alliance timing.
- Arena event pacing, enabled event types, danger-zone damage/radius, and monster pack size.

Example:

```ts
createMatch(undefined, 0, {
  name: "Tiny Duel Pit",
  roster: { matchBotCount: 2 },
  arena: { size: 520, spawnRadius: 190 },
  loot: { initialCount: 3 },
  events: { allowedArenaEvents: ["rare_loot_drop", "danger_zone"] },
});
```

## Deployment

Production branch convention:

- `main` deploys production.
- Pull requests and non-main branches are preview/staging-friendly through Vercel and Render native Git deploy flows.

### Supabase

1. Create a Supabase project.
2. Apply every SQL file in `supabase/migrations/` in timestamp order using the Supabase SQL editor or CLI.
3. Copy the project URL.
4. Copy the service role key for the backend only. Never expose it in Vercel or frontend code.

No Supabase Storage bucket is required right now because the current app does not upload or persist files/assets. Add Storage later if uploads become product state.

### Render Deployment

1. Connect the GitHub repo in Render.
2. Use the committed `render.yaml` Blueprint. It creates:
   - `botarena-backend`: Node web service for the Express API.
   - `botarena-frontend`: static Vite site served by Render.
3. During Blueprint creation, set these backend secret environment variables when Render prompts for them:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. The Blueprint assumes these default public URLs:
   - Frontend: `https://botarena-frontend.onrender.com`
   - Backend: `https://botarena-backend.onrender.com`
5. If Render assigns different service hostnames or you add custom domains, update:
   - Backend `CORS_ORIGINS` to the final frontend URL.
   - Frontend `VITE_API_BASE_URL` to the final backend URL.

To create only the backend manually instead of using the Blueprint, create a Web Service with:
   - Build command: `npm ci --include=dev && npm run build --workspace backend`
   - Start command: `npm run start --workspace backend`
   - Health check path: `/health`
Then set these Render environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CORS_ORIGINS`
   - `CORS_ORIGIN_SUFFIXES=vercel.app,onrender.com`
   - `NODE_ENV=production`
Set `CORS_ORIGINS` to a comma-separated list of allowed frontend origins, for example:

```text
https://your-production-app.vercel.app,https://your-preview-app.vercel.app,http://localhost:5173
```

### Vercel Frontend

1. Import the GitHub repo in Vercel.
2. Set `frontend` as the Vercel project root. The committed `vercel.json` installs and builds from that directory and outputs `dist`.
3. Set this Vercel environment variable:
   - `VITE_API_BASE_URL=https://your-render-service.onrender.com`
4. Vercel Git integration will create preview deployments for branches/PRs and production deployments from `main`.

### GitHub

The repo includes `.github/workflows/ci.yml`, which runs on pull requests and pushes to `main`:

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Deployment itself is intentionally left to Vercel and Render native Git integrations. No deployment secrets are required in GitHub unless you later choose to deploy through GitHub Actions.

## Environment Variables

Frontend, set in `frontend/.env` locally and Vercel:

```text
VITE_API_BASE_URL=http://localhost:4000
```

Backend, set in `backend/.env` locally and Render:

```text
PORT=4000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
CORS_ORIGINS=http://localhost:5173,https://your-vercel-app.vercel.app
CORS_ORIGIN_SUFFIXES=vercel.app
```

## Migration From Local Persistence

Existing browser-local game state is migrated opportunistically:

1. Deploy Supabase and the backend.
2. Set `VITE_API_BASE_URL` in the frontend.
3. Open the app in a browser that already has BotArena localStorage data.
4. On startup, if no remote state exists for that browser client id, the frontend uploads the current local bot pool, player state, arena state, queue, and recent match results to the backend.

After that first sync, future durable updates are written through the backend to Supabase. Browser localStorage remains a cache, not the durable production store.
