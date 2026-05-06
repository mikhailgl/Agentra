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
- Backend health check: `http://localhost:4000/health`

If you want to run the frontend without backend persistence, leave `VITE_API_BASE_URL` empty. The app will still work with local cache only, but that mode is not production-durable.

## Deployment

Production branch convention:

- `main` deploys production.
- Pull requests and non-main branches are preview/staging-friendly through Vercel and Render native Git deploy flows.

### Supabase

1. Create a Supabase project.
2. Run `supabase/migrations/20260505000000_initial_game_state.sql` in the Supabase SQL editor, or apply it with the Supabase CLI.
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
2. Use the repo root as the Vercel project root. The committed `vercel.json` builds `frontend/` and outputs `frontend/dist`.
3. Set this Vercel environment variable:
   - `VITE_API_BASE_URL=https://your-render-service.onrender.com`
4. Vercel Git integration will create preview deployments for branches/PRs and production deployments from `main`.

### GitHub

The repo includes `.github/workflows/ci.yml`, which runs on pull requests and pushes to `main`:

```bash
npm ci
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
