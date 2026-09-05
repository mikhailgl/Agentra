# Survival island

Two independent model-controlled inhabitants share a finite 24 × 24 island. The backend owns every resource, item transfer, path, structure, injury and utterance. React Three Fiber renders the canonical world at `/survival`. The spectator API is read-only; opening a browser does not start extra agents.

## Run locally

1. Add `OPENAI_API_KEY` to `backend/.env` for the default Astra actors. Keep keys out of frontend environment variables and model configuration files.
2. Run `npm run dev:survival` from the repository root.
3. Run `VITE_API_BASE_URL=http://localhost:4000 npm run dev:frontend` in another terminal.
4. Open `http://localhost:5173/survival`.

This development command uses an atomic JSON checkpoint at `backend/.local/survival-world.json`. It does not require Supabase or start the competitive league. The normal production backend serves the same `/api/survival` endpoint and saves the island under the `survival-world` key in the existing Supabase `arena_states` table. Run only one backend writer for a given world.

Missing provider keys pause the island without simulated decisions. Provider failures pause the world with a visible error. An unreachable or invalid saved checkpoint is never silently replaced with a new world.

## Change the actors' models

Edit **`backend/survival.models.json`**. Both actors start with Astra:

```json
{
  "moss": {
    "provider": "openai",
    "model": "gpt-6-astra",
    "reasoningEffort": "low"
  },
  "ember": {
    "provider": "openai",
    "model": "gpt-6-astra",
    "reasoningEffort": "low"
  }
}
```

Change either `model` independently. The local development command watches this file and restarts the service, preserving the island, inventories, memories, and usage count. In production, restart the backend after editing it. Actions already underway finish with their original model attribution; subsequent decisions use the new assignment.

Supported provider configurations:

| Provider                    | Actor configuration                                                                                                                  | Credential in `backend/.env` |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| OpenAI Responses            | `{"provider":"openai","model":"gpt-6-astra","reasoningEffort":"low"}`                                                                | `OPENAI_API_KEY`             |
| Anthropic Messages          | `{"provider":"anthropic","model":"<model ID available to your account>"}`                                                            | `ANTHROPIC_API_KEY`          |
| Chat Completions compatible | `{"provider":"chat-completions","model":"<model ID>","baseURL":"https://your-provider.example/v1","apiKeyEnv":"EXPERIMENT_API_KEY"}` | `EXPERIMENT_API_KEY`         |

Use actual model IDs supported by your account. OpenAI `reasoningEffort` is optional; omit it for models that do not support reasoning settings. Compatible endpoints must support function tools and forced tool choice. Unsupported models fail visibly; there is no model substitution. All adapters use the same rules, observation shape, action schema and output-token ceiling.

The inspector shows the assigned model, and journal entries include the model that selected the action. These are behavioral experiments, not controlled benchmarks: actor dispositions, starting locations and model latency can affect outcomes. To run a fresh local experiment, stop the backend and move `backend/.local/survival-world.json` to a separately named archive before restarting. Keeping the file continues the existing world instead.

## Usage and timing

`SURVIVAL_DECISION_LIMIT` is a **total paid attempt limit for the saved island**, default 120 across both actors. Reservations are checkpointed before API calls. Raise the number and restart to continue a capped run; restarting alone does not reset the count. Each call has a 1,800 output-token ceiling, a 60-second timeout, and no automatic SDK retries. This is a request cap, not a dollar budget. Token totals reflect completed successful provider responses and may omit failed or interrupted requests that the provider still bills.

Only one decision may be in flight per actor. Model calls run independently. Physics and timed actions tick at 250 ms; decisions are requested after action completion, at least six seconds apart. No catch-up hunger or exposure is applied while the server is offline. Speech interrupts resting, and being attacked cancels the current physical action; new observations arrive at the next decision.

## First-slice rules

- Trees, rocks and berry bushes have finite supplies. Trees and rocks block walking until depleted.
- Harvesting yields up to two items; an axe increases wood yield to three and speeds up harvesting.
- Craft an axe from 2 wood + 2 stone, or a shelter kit from 6 wood + 2 stone.
- Place a shelter kit on one clear land cell, then enter it for protection. Multiple survivors may share it.
- Build a wall from two wood. Walls block navigation and sight. Dismantling structures returns only part of their wood.
- Berries restore hunger. Starvation and outdoor exposure at night reduce health. Resting inside a shelter with sufficient food heals.
- Speech is heard within six cells. Giving transfers actual items. Attacks cause damage.
- Day lasts ten simulation minutes and night lasts five. The island pauses when both inhabitants die or its decision cap is reached.

This slice uses prefab shelter placement and ground-level wall blocks. Arbitrary vertical voxel construction, agriculture, resource regrowth, voice, and larger populations are not implemented.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run build`. Survival tests cover the gather/craft/build loop, resource contention, private information, speech range, invalid actions, local persistence, model assignment changes, request isolation, failure pauses, and the official SDK request contract. Mocked model tests verify wiring, not live model behavior; live access requires valid provider credentials.
