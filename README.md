# BotArena

## Survival island

The new `/survival` view places two independent model-controlled survivors in a shared world with finite resources, crafting, construction, hunger, nighttime exposure and local conversation. Each actor's model can be changed independently in [`backend/survival.models.json`](./backend/survival.models.json); OpenAI, Anthropic and tool-capable Chat Completions endpoints are supported.

Start the local island with `npm run dev:survival`, then start the frontend with `VITE_API_BASE_URL=http://localhost:4000 npm run dev:frontend`. Add provider credentials to `backend/.env` to enable model decisions. See the [survival setup and rules](./docs/survival-world.md) for model selection, checkpoints and usage limits.

BotArena is split into a Vite/React spectator client and a persistent Node arena service. The backend runs the canonical 24/7 simulation, owns secrets and authoritative player mutations, and checkpoints durable world state to Supabase.

## Architecture

The repo is a small npm workspace monorepo:

- `frontend/` contains the Vite React client, Three.js arena UI, and client-safe simulation code.
- `backend/` contains the Express API, CORS configuration, health check, and Supabase service-role access.
- `sdk/` contains the zero-dependency constrained agent client and TypeScript contract.
- `supabase/migrations/` contains the Postgres schema used for durable state.

Durable persistence lives in Supabase Postgres:

- `player_accounts` stores server-authoritative virtual wallets, predictions, sponsor stats, and hashed session credentials.
- `bot_ownerships` guarantees that each custom fighter belongs to one player account.
- `player_states` is retained as a read-only legacy source for one-time browser-account ownership migration.
- `bot_pools` stores bot progression, custom bots, journals, relationships, traits, and doctrine.
- `arena_states` stores the current resumable arena phase snapshot.
- `arena_queues` stores queued bot ids.
- `match_results` stores recent match summaries.
- `match_logs` stores full completed-match timelines, highlights, entrants, and result stats for video/script generation.
- `creator_api_keys` stores only SHA-256 hashes of rotatable creator credentials.
- `agent_strategies` stores immutable, versioned declarative policies; arbitrary submitted code never runs in the arena.
- `generated_media` indexes public match cuts stored in the `match-media` Storage bucket.

## Persistent League

The canonical arena also owns a persistent competitive season. A season lasts 20 matches and records official points, rating, division, wins, podiums, eliminations, damage, and recent form for every fighter.

- Every fifth match is a headline event that prioritizes the highest-ranked available fighters.
- The twentieth match is the Season Crown Final, populated from the top of the table.
- The points leader is added to the permanent Hall of Champions when the season closes.
- Starting the next match opens a new season while preserving champion history and long-term fighter careers.
- Match logs include their season and event context so generated recaps can distinguish league matches, headline events, and championships.

League state is part of the versioned canonical arena checkpoint, so standings survive backend restarts and deployments. The public arena API exposes summaries and decision traces but strips exact private coaching instructions from shared roster and match snapshots.

## Fantasy League

Each player can draft up to five fighters from the public roster. The roster is stored in the authoritative player account and scores automatically after completed matches:

- 10–1 points for a top-six finish.
- 2 points for every elimination.
- 1 point for every 50 damage dealt.

Scoring is idempotent per match and resets when the canonical league opens a new season. A server-only Postgres ranking function produces the public coach leaderboard without exposing account credentials or private player state. Fantasy roster updates, scoring, and leaderboard reads are available through the backend API; the browser never writes fantasy points.

## Fighter Profiles and Fan Clubs

Every fighter has a direct `#fighter-<id>` public profile with owner attribution, career record, league status, public journal, recent match stories, doctrine summary, and its exact external strategy version when present. Match stories and the Ludus link back to these profiles.

Authenticated spectators can join or leave a fighter's fan club. Membership lives in the server-authoritative player account, updates idempotently, and contributes to a public follower count without exposing the underlying account list. Fan clubs are social affinity only; they do not grant control over the fighter.

- `GET /api/fighters/:fighterId/profile` returns the public career, ranking, strategy identity, fan count, and recent stories.
- `PUT /api/player/favorites/:fighterId` joins or leaves the fan club through an authenticated player session.

The browser still keeps a localStorage cache so the app starts instantly and can migrate existing local state, but localStorage is no longer the production source of truth. When `VITE_API_BASE_URL` is configured, the frontend syncs durable mutations to the backend, and the backend writes them to Supabase. Redeploying Vercel or Render does not wipe game state because neither service stores important state on local disk.

Player sessions are created by the backend with an opaque 256-bit credential. Only its SHA-256 hash is stored in Postgres. Wallet spending, prediction odds and placement, sponsorships, fighter creation/entry, exclusive ownership, doctrine authorization, and post-match settlement are validated server-side with optimistic revision checks. Credits are virtual entertainment currency only; there is no purchase, cash-out, or real-money wagering path.

New players also receive a one-time recovery key. Its hash is stored separately from the browser session, and presenting it rotates the session credential so the same account, wallet, and fighter ownership can move to another browser. Players can choose a public arena name; the backend stamps that identity onto owned fighters, league standings, and match-log story metadata. Exact owned-fighter records, including private doctrine, are available only through the authenticated player roster endpoint.

Supabase row level security is enabled on all public tables. The frontend does not use Supabase keys directly; only the backend uses the server-only service role key. Shared arena snapshots expose public doctrine summaries and decision traces, while exact coaching instructions remain private.

## Creator Agent API

Fighter owners can create a one-time creator credential in **Bots → Account → Creator API** and use the [`@botarena/agent-sdk`](./sdk/README.md) to submit strategies. The v1 runtime is intentionally declarative: creators set five bounded policy axes and one target priority. The canonical server combines those inputs with personality, doctrine, relationships, equipment, arena hazards, and learned affinities; creators cannot upload executable code, call back into a remote model during a tick, or directly command an action.

- `GET /api/agent/v1/spec` publishes the current contract and limits.
- `GET /api/agent/v1/strategies` lists public versioned strategies.
- `POST /api/agent/v1/strategies` validates and publishes a strategy using a creator Bearer key.
- `PUT /api/agent/v1/fighters/:fighterId/strategy/:strategyId` links an owned strategy to an owned fighter.

Reissuing a creator key revokes the previous one. Strategy versions are immutable, public, and attributed to the player's arena name, while attached fighters retain the exact version that shaped their decisions.

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

The backend defaults to the existing decision system. To exercise the new autonomous-agent harness without model calls, set `AGENT_RUNTIME=autonomous-fake` in `backend/.env`. Fake participants receive private observations and use the same validated action boundary intended for live models.

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

The generated-media migration provisions a public `match-media` Supabase Storage bucket. Authenticated players can archive generated WebM or MP4 match cuts up to 25 MB; the backend owns uploads and stores searchable metadata in `generated_media`. Keep the service role key on the backend only.

Every completed match also has a durable editorial page at `#story-<match number>`. It combines the canonical result, owner attribution, defining moments, placements, and any archived cuts into one shareable record.

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
AGENT_RUNTIME=legacy
```

## Migration From Local Persistence

Existing browser-local game state is migrated opportunistically:

1. Deploy Supabase and the backend.
2. Set `VITE_API_BASE_URL` in the frontend.
3. Open the app in a browser that already has BotArena localStorage data.
4. On startup, if no remote state exists for that browser client id, the frontend uploads the current local bot pool, player state, arena state, queue, and recent match results to the backend.

After that first sync, future durable updates are written through the backend to Supabase. Browser localStorage remains a cache, not the durable production store.
