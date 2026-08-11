# Autonomous Arena implementation plan

## Target outcome

BotArena runs a persistent match in one fixed Three.js space with 12 autonomous, humanlike participants. Every participant knows one shared fact: exactly one living person can leave. Each participant perceives only local information, chooses its own actions, may speak to nearby people, and can cooperate, deceive, hide, fight, or wait without a scripted storyline. A gamemaster introduces world events. The match ends when one participant remains alive.

Three.js remains the presentation engine. The Node backend remains authoritative for world state, action validation, combat, death, events, persistence, and model credentials.

## Product guardrails

- No authored plot, quests, alliances, betrayals, or required dramatic beats.
- The gamemaster changes world conditions; it does not control participants or select story outcomes.
- Participants never receive the global match state. They know only their identity, the survival rule, their current condition, what they can perceive, and what they remember.
- Speech is a normal world action, not a separate scripted dialogue mode.
- The model proposes actions. Only the game engine can mutate state or decide whether an action succeeds.
- Player-authored directives such as “attack,” “defend,” “take revenge,” or other tactical nudges are not part of the autonomous base mode. Participants may still choose those behaviors themselves.
- No Unreal Engine, visual-model perception, complex physics library, voice synthesis, or long-term skill learning in the first playable version.
- Different simulation and cognition update cadences remain deferred. The existing simulation update continues; an agent waiting for a model response simply has no new action to apply.

## Existing foundation to retain

- `frontend/src/game/matchConfig.ts`: already defaults to 12 participants and one winner.
- `backend/src/arenaService.ts`: already owns the persistent, server-authoritative arena and checkpoints.
- `frontend/src/game/simulation.ts`: already resolves movement, combat, loot, health, and death.
- `frontend/src/game/arenaEvents.ts`: already provides a first gamemaster-like event system.
- `frontend/src/lib/simulation/simulationTo3D.ts`: already converts canonical state into a renderer-safe view model.
- `frontend/src/components/arena/ThreeArena.tsx`: remains the Three.js spectator surface.
- Supabase checkpoints and match logs remain the durable record.

## Exact open-source adoption plan

We will not fork another simulation or replace the current TypeScript/Three.js stack. Each external project has one of three roles: a pinned runtime dependency, a small source-level adaptation into BotArena, or a reference used only to design tests. The source revisions below are the versions inspected for this plan; implementation PRs must record any newer revision they actually use.

### 1. AI Town: memory and reliable asynchronous agent operations

Source: [a16z-infra/ai-town at `7b242334`](https://github.com/a16z-infra/ai-town/tree/7b242334bfbfef02f7718bded120d431e8f307df), MIT.

| Upstream code | What BotArena will use | BotArena destination | Phase |
| --- | --- | --- | --- |
| [`convex/aiTown/agent.ts`: `inProgressOperation` and `startOperation`](https://github.com/a16z-infra/ai-town/blob/7b242334bfbfef02f7718bded120d431e8f307df/convex/aiTown/agent.ts) | Adapt the operation-ID guard: only one decision may be in flight per participant, and a late response is applied only if its operation ID still matches. Add an explicit timeout and checkpoint the pending operation. | `backend/src/agents/operationRegistry.ts`, used by `backend/src/agentRuntime.ts` | 1–2 |
| [`convex/aiTown/agentOperations.ts`: operation completion carrying `operationId`](https://github.com/a16z-infra/ai-town/blob/7b242334bfbfef02f7718bded120d431e8f307df/convex/aiTown/agentOperations.ts) | Adapt the completion protocol, not the Convex scheduler: a provider response returns `{ agentId, operationId, action }`; the authoritative arena validates the token and action before mutation. | `backend/src/agents/operationRegistry.ts`, `backend/src/arenaService.ts` | 1–2 |
| [`convex/agent/memory.ts`: `rememberConversation`](https://github.com/a16z-infra/ai-town/blob/7b242334bfbfef02f7718bded120d431e8f307df/convex/agent/memory.ts) | Adapt first-person summaries of conversations separately for each listener. A summary can mention only utterances that participant heard. Keep links to the raw event IDs it summarizes. | `backend/src/agents/memory.ts` | 3 |
| [`convex/agent/memory.ts`: `searchMemories` and `rankAndTouchMemories`](https://github.com/a16z-infra/ai-town/blob/7b242334bfbfef02f7718bded120d431e8f307df/convex/agent/memory.ts) | When bounded recent memory proves inadequate, adapt per-agent retrieval and the relevance + importance + recency reranker. Keep AI Town's shape, but replace Convex vector search with a Supabase RPC and make the ranking weights configurable. | `backend/src/agents/memoryRetrieval.ts`; later Supabase migration/RPC | 7, conditional |
| [`convex/agent/conversation.ts`: `agentPrompts`, `previousConversationPrompt`, `relatedMemoriesPrompt`](https://github.com/a16z-infra/ai-town/blob/7b242334bfbfef02f7718bded120d431e8f307df/convex/agent/conversation.ts) | Adapt the prompt-context assembly: identity, current private observation, prior interaction with visible people, relevant first-person memories, and recent heard messages. | `backend/src/agents/promptContext.ts` | 2–3 |

We will **not** take AI Town's Convex schema/runtime, map, movement, rendering, random wandering, invitations, conversation state machine, or relationship scripts. Speech remains an ordinary BotArena action. Its [`HistoricalObject`](https://github.com/a16z-infra/ai-town/blob/7b242334bfbfef02f7718bded120d431e8f307df/convex/engine/historicalObject.ts) delta/run-length history encoding is only a documented fallback if replay storage becomes measurably expensive; it is not part of the planned build.

### 2. Concordia: separation between observation, proposal, and resolution

Source: [google-deepmind/concordia at `513c3d62`](https://github.com/google-deepmind/concordia/tree/513c3d622d19cf99f1c2f63991b648ffd3d5fcb5), Apache-2.0.

| Upstream code | What BotArena will use | BotArena destination | Phase |
| --- | --- | --- | --- |
| [`concordia/environment/engine.py`: `Engine`](https://github.com/google-deepmind/concordia/blob/513c3d622d19cf99f1c2f63991b648ffd3d5fcb5/concordia/environment/engine.py) | Port the contract sequence—make a private observation, request an action, validate/resolve it, distribute resulting observations, check termination—into existing server methods. This is an interface design, not a Python dependency or turn scheduler. | `backend/src/agentRuntime.ts`, `backend/src/arenaService.ts` | 1 |
| [`concordia/typing/entity.py`: `ActionSpec` validation and `Entity.observe`/`act`](https://github.com/google-deepmind/concordia/blob/513c3d622d19cf99f1c2f63991b648ffd3d5fcb5/concordia/typing/entity.py) | Port the typed-boundary idea as a TypeScript discriminated union plus Zod validation. BotArena's allowed actions are generated from actual nearby affordances. | `frontend/src/game/types.ts`, `frontend/src/game/agentActions.ts` | 1 |
| [`concordia/components/game_master/make_observation.py`: `ObservationQueue`](https://github.com/google-deepmind/concordia/blob/513c3d622d19cf99f1c2f63991b648ffd3d5fcb5/concordia/components/game_master/make_observation.py) | Port its per-entity add/get-and-clear queue semantics for heard speech, witnessed outcomes, and private action results. Queue entries must include provenance and be checkpointable. | `backend/src/agents/observationInbox.ts`, `frontend/src/game/perception.ts` | 1–3 |
| [`concordia/components/game_master/event_resolution.py`: `SendEventToRelevantPlayers`](https://github.com/google-deepmind/concordia/blob/513c3d622d19cf99f1c2f63991b648ffd3d5fcb5/concordia/components/game_master/event_resolution.py) | Port only the observer-routing idea: after the engine resolves an event, determine witnesses from location, visibility, and hearing, then enqueue distinct observations for them. | `frontend/src/game/perception.ts`, `backend/src/arenaService.ts` | 1–3 |

We will **not** use Concordia's generative world state, sequential engine, generative clock, LLM event resolution, NPC event narration, or LLM-based death component. BotArena's existing simulation remains continuously authoritative for physics, combat, health, and death. This is also where the previously discussed “two clocks” design stays deferred rather than entering through a framework choice.

### 3. SOTOPIA: private social visibility and later behavior evaluation

Source: [sotopia-lab/sotopia at `a0aaafb4`](https://github.com/sotopia-lab/sotopia/tree/a0aaafb440e570e5e61b7c44a44e5e417c545383), MIT.

| Upstream code | What BotArena will use | BotArena destination | Phase |
| --- | --- | --- | --- |
| [`sotopia/messages/message_classes.py`: `Observation` and `AgentAction`](https://github.com/sotopia-lab/sotopia/blob/a0aaafb440e570e5e61b7c44a44e5e417c545383/sotopia/messages/message_classes.py) | Adapt recipient validation and the rule that an agent receives only currently available actions. Keep BotArena's more specific physical action union instead of SOTOPIA's free-form `action` string. | `frontend/src/game/types.ts`, `frontend/src/game/agentActions.ts` | 1–3 |
| [`sotopia/envs/parallel.py`: `_actions_to_natural_language_for_viewer`](https://github.com/sotopia-lab/sotopia/blob/a0aaafb440e570e5e61b7c44a44e5e417c545383/sotopia/envs/parallel.py) | Adapt per-viewer delivery: public/local speech is visible to valid nearby listeners; targeted or whispered speech is visible only to sender and valid recipients. Physical acts are delivered only to witnesses. | `frontend/src/game/perception.ts`, `backend/src/agents/observationInbox.ts` | 3 |
| [`sotopia/database/evaluation_dimensions.py`: `SotopiaDimensions`](https://github.com/sotopia-lab/sotopia/blob/a0aaafb440e570e5e61b7c44a44e5e417c545383/sotopia/database/evaluation_dimensions.py) and [`sotopia/envs/evaluators.py`: `EpisodeLLMEvaluator`](https://github.com/sotopia-lab/sotopia/blob/a0aaafb440e570e5e61b7c44a44e5e417c545383/sotopia/envs/evaluators.py) | Later, adapt only the offline rubric structure for believability, relationship change, knowledge/provenance, secret leakage, and rule violations. Evaluation reads completed replays and never affects a live match. | `backend/src/evaluation/socialEpisodeEvaluator.ts` | 7, conditional |

We will not install SOTOPIA or run its Python environment in production. We will not use its financial-benefit or scripted-goal scores, since those would pull the product back toward authored scenarios.

### 4. Vercel AI SDK and Zod: the actual model-call dependency

Sources: [`vercel/ai`](https://github.com/vercel/ai), Apache-2.0, and [`colinhacks/zod`](https://github.com/colinhacks/zod), MIT. The inspected package baselines are `ai@7.0.58` and `zod@4.4.3`; the implementation commit will install exact versions and commit the lockfile.

- Use `generateText` with `Output.object({ schema })` to request exactly one `AgentAction` matching the Zod discriminated union.
- Put both packages in the backend only. The browser receives canonical results and never receives a provider credential or raw private prompt.
- Wrap the SDK in `backend/src/agents/modelProvider.ts`, so the simulation is not coupled to any specific model vendor.
- Do not use an SDK tool loop or let the model execute tools. The model proposes one action; `agentActions.ts` validates it and the arena applies it.
- Capture provider/model name, latency, usage, parse failure, and retry count without storing hidden chain-of-thought.

This is a normal package dependency, not copied source code.

### 5. Supabase pgvector: deferred storage for AI Town-style retrieval

Source: [`pgvector/pgvector`](https://github.com/pgvector/pgvector), PostgreSQL license, exposed through the existing Supabase database.

Only if bounded recent memory fails a concrete test, add an `agent_memories` embedding column and a `match_agent_memories(query_embedding, agent_id, match_threshold, match_count)` SQL function. The RPC performs per-agent cosine search using `<=>`; `backend/src/agents/memoryRetrieval.ts` then applies the adapted AI Town importance/recency reranking. PostgREST does not expose vector operators directly, so search stays behind the SQL function. No separate vector database or Python service is planned.

### 6. Melting Pot: test situations, not game-engine code

Source: [google-deepmind/meltingpot at `5d457aac`](https://github.com/google-deepmind/meltingpot/tree/5d457aac647a8d6d9323e8c1e8c390c822ada505), Apache-2.0.

We will not copy its Python/Lua Lab2D engine or substrate implementations. We will use the following substrate mechanics as inspiration for deterministic **test fixtures**, temporarily arranging BotArena's own objects and resources to see whether autonomous agents exhibit the behavior without being told a story:

| Upstream substrate | BotArena test derived from it |
| --- | --- |
| [`commons_harvest__open.py`](https://github.com/google-deepmind/meltingpot/blob/5d457aac647a8d6d9323e8c1e8c390c822ada505/meltingpot/configs/substrates/commons_harvest__open.py) | A scarce regenerating resource: measure hoarding, restraint, conflict, and depletion without assigning roles. |
| [`clean_up.py`](https://github.com/google-deepmind/meltingpot/blob/5d457aac647a8d6d9323e8c1e8c390c822ada505/meltingpot/configs/substrates/clean_up.py) | A spreading hazard that any participant can spend time clearing: measure free-riding and voluntary cooperation. |
| [`territory.py`](https://github.com/google-deepmind/meltingpot/blob/5d457aac647a8d6d9323e8c1e8c390c822ada505/meltingpot/configs/substrates/territory.py) | A defensible resource-rich room: measure occupancy, negotiation, trespass, and escalation. |
| [`stag_hunt_in_the_matrix__arena.py`](https://github.com/google-deepmind/meltingpot/blob/5d457aac647a8d6d9323e8c1e8c390c822ada505/meltingpot/configs/substrates/stag_hunt_in_the_matrix__arena.py) | A reward that is safer with two participants beside a smaller solo reward: measure spontaneous coordination and defection. |

These fixtures belong in `backend/src/evaluation/emergenceScenarios.test.ts`; they are development/evaluation setups, not plots, quests, or special rules shipped in the base arena.

### 7. Voyager: explicitly not part of the base plan

Source inspected: [MineDojo/Voyager at `55e45a88`](https://github.com/MineDojo/Voyager/tree/55e45a880755d0c8c66ca7fb5fe7962ac8974f89), MIT. We will not use [`voyager/agents/skill.py`](https://github.com/MineDojo/Voyager/blob/55e45a880755d0c8c66ca7fb5fe7962ac8974f89/voyager/agents/skill.py), its vector skill library, curriculum agent, or critic in the base game. If agents later fail because they cannot reliably perform repeated multi-step interactions, we may adapt only the `SkillManager` concept into a library of engine-authored, validated compound actions. Models will never generate or execute arbitrary JavaScript.

### Provenance and license requirements

- The first implementation slice adds `THIRD_PARTY_NOTICES.md` with repository URL, exact commit, source path/function, license, what was adapted, and the destination file.
- Preserve upstream copyright/license headers when source is copied or substantially adapted. Concept-only ports still receive a source note in the destination documentation or code comment.
- Pin runtime npm dependencies exactly in `package-lock.json`. Research repos are pinned by commit in this document; they are not vendored or installed.
- Any implementation PR that changes an upstream revision must review that revision's license and update both this plan and `THIRD_PARTY_NOTICES.md`.
- No open-source Humalike runtime or SDK was found to adopt. The linked Humalike demo remains a product reference, not a software dependency.

## Core contracts

### Private observation

Add an `AgentObservation` value constructed independently for each living participant:

```ts
type AgentObservation = {
  self: {
    id: string;
    name: string;
    health: number;
    position: Point;
    inventory: Inventory;
  };
  knownRule: "Only one living participant can leave";
  location: {
    biome: BiomeType;
    nearbyLandmarks: string[];
  };
  visiblePeople: ObservedPerson[];
  visibleObjects: ObservedObject[];
  heardSpeech: HeardUtterance[];
  observedEvents: ObservedEvent[];
  relevantMemories: AgentMemory[];
  availableActions: AvailableAction[];
};
```

The observation builder must enforce visibility, hearing distance, occlusion where the map supplies blockers, and event provenance. It must never copy the global event log or private state belonging to another participant.

### Autonomous action

The model returns one schema-validated `AgentAction`:

```ts
type AgentAction =
  | { type: "move"; destination: Point }
  | { type: "speak"; message: string; targetIds?: string[] }
  | { type: "inspect"; objectId: string }
  | { type: "take"; objectId: string }
  | { type: "use"; objectId: string; targetId?: string }
  | { type: "attack"; targetId: string; weaponId?: string }
  | { type: "wait" };
```

Every action passes through an `ActionExecutor`. It rejects unseen targets, impossible movement, unavailable items, invalid ranges, dead actors, and malformed model output. Rejection becomes a private result the participant can account for in its next decision; it never corrupts canonical state.

### Memory

Start with bounded structured memory inside the arena checkpoint:

- personally witnessed actions and outcomes;
- speech the participant actually heard;
- the participant's own attempted actions and results;
- concise model-authored recollections only when raw events become too numerous.

Do not add vector retrieval to the first playable slice. Add Supabase/pgvector only after the basic arena demonstrates that bounded recent memory is insufficient. When added, borrow AI Town's relevance + importance + recency ranking and first-person conversation summaries.

### Gamemaster event

Generalize the current arena events into data-driven definitions:

```ts
type GameMasterEventDefinition = {
  type: string;
  eligible: (state: MatchState) => boolean;
  weight: (state: MatchState) => number;
  apply: (state: MatchState, rng: Rng) => ArenaEvent;
};
```

Initial event catalogue:

- rare supply drop;
- localized danger zone;
- blackout or reduced visibility;
- environmental hazard;
- hostile creature arrival;
- temporary opening or closing of a route;
- sudden-death pressure if the arena has irreversibly stalled.

Selection is weighted from world conditions and seeded randomness. Events create real objects, hazards, visibility changes, or topology changes. They do not inject instructions such as "betray your ally."

## Implementation phases

### Phase 1: Offline autonomous-action harness

Build the contracts without making live model calls.

- Add observation, action, result, memory, speech, and world-object types.
- Implement private observation construction from the existing match state.
- Implement strict action validation and execution for the initial action set.
- Add a fake agent provider that returns deterministic actions for tests.
- Add an append-only decision trace containing observation identifiers, proposed action, validation result, and resulting world event. Do not store hidden chain-of-thought.
- Leave the current UI and production decision tree intact behind a runtime mode flag during this phase.

Acceptance:

- A test match with 12 fake agents reaches exactly one survivor.
- No agent can target a person or object it did not perceive.
- Speech is heard only by participants within the permitted hearing conditions.
- Invalid actions fail without mutating unrelated state.
- A seeded fake-agent run is replayable.

### Phase 2: Live autonomous participants

- Add a server-only, provider-neutral `AgentModelProvider`.
- Use schema-validated structured output for `AgentAction`.
- Give each participant its own identity/personality context, private observation, and bounded memory. Do not provide a tactical script or desired storyline.
- Request a decision whenever a living participant has completed its previous action and has no decision already in flight.
- Queue completed model responses for validation by the canonical simulation.
- Add timeouts, retry limits, and a safe `wait` result for provider failures.
- Record model, latency, token usage, parse failures, rejected actions, and chosen action type.

Acceptance:

- Twelve live-model participants can complete a match without manual control.
- Provider latency cannot corrupt or duplicate actions.
- A model outage is visible in diagnostics and does not silently switch participants back to the legacy combat AI.
- The only universally supplied world fact is the last-survivor exit rule.

### Phase 3: Social interaction and private belief

- Treat speaking as a spatial action with public, targeted, and whispered ranges.
- Deliver utterances only to valid listeners and store them from each listener's perspective.
- Let agents report events they witnessed; recipients remember the claim as hearsay, not verified truth.
- Track knowledge provenance: witnessed, heard from another participant, inferred, or action result.
- Keep existing numeric relationship fields only if they are derived from autonomous interactions; remove them as direct action-selection rules.

Acceptance:

- An agent can witness an event, tell another agent, and cause that information to appear in the listener's later private context.
- The listener does not automatically gain the original event as ground truth.
- Conversations can start and stop solely through ordinary agent actions.

### Phase 4: Fixed-space affordances in Three.js

- Turn the current flat biome arena into a fixed authored layout using lightweight geometry and reusable assets.
- Add canonical blockers, doors/routes, cover, landmarks, containers, pickups, and hiding/visibility volumes to world state.
- Render exactly the same definitions through React Three Fiber.
- Add speech bubbles, current declared action, interaction feedback, and clear event effects.
- Keep navigation and collision simple and deterministic. Add a physics dependency only if a specific interaction requires it.

Acceptance:

- Every rendered blocker and interactable has a canonical backend counterpart.
- Participants navigate around blockers and cannot perceive through configured occluders.
- A spectator can understand movement, speech, item interaction, combat, and gamemaster events without reading raw logs.

### Phase 5: RimWorld-style gamemaster

- Refactor the existing pacing logic into weighted event definitions and selection policy.
- Base eligibility and weight on observable arena metrics: survivor count, participant distribution, resource scarcity, health distribution, event history, and prolonged lack of consequential action.
- Add seeded simulation tests for every event's eligibility, application, expiry, and persistence.
- Expose a gamemaster debug panel showing candidate weights and the factual reason an event was selected.

Acceptance:

- The gamemaster produces varied matches from the same fixed arena.
- Every event has a concrete world effect and clean expiry or permanent-state transition.
- The gamemaster never changes participant goals, memories, relationships, or selected actions directly.

### Phase 6: Persistence, replay, and spectator product

- Version the arena checkpoint for pending actions, speech, memories, world objects, and gamemaster state.
- Extend match logs with validated decisions and knowledge provenance.
- Build replay from canonical results rather than rerunning model calls.
- Adapt profiles, leagues, fantasy, and generated recaps to consume completed autonomous matches.
- Remove or disable player nudges and tactical doctrine controls in autonomous mode. Sponsorship may remain only as a world event available on equal game-defined terms.

Acceptance:

- Restarting the backend restores the arena without losing or duplicating an action.
- A completed match can be replayed without model access.
- The spectator layer cannot mutate participant decisions.

### Phase 7: Quality and scale only after the base works

Evaluate concrete needs before adding:

- pgvector long-term memory;
- memory consolidation and forgetting;
- local/open-weight models;
- voice and lip sync;
- higher-fidelity human models and animation;
- learned compound skills inspired by Voyager;
- alternate arenas or more than 12 participants.

## First implementation slice

The first code change should stop before live model integration. It should include:

1. `AgentObservation`, `AgentAction`, `AgentActionResult`, `AgentMemory`, speech, and world-object types in `frontend/src/game/types.ts` or focused adjacent modules.
2. `frontend/src/game/perception.ts` for private, testable observation construction.
3. `frontend/src/game/agentActions.ts` for pure validation and canonical action application.
4. `backend/src/agentRuntime.ts` with a fake provider and in-flight action bookkeeping.
5. Integration in `backend/src/arenaService.ts` behind `AGENT_RUNTIME=legacy|autonomous-fake`.
6. Unit tests for information boundaries and action validation, plus a 12-agent completion/soak test.
7. `THIRD_PARTY_NOTICES.md` recording the exact AI Town, Concordia, and SOTOPIA source elements adapted in the slice.

This slice answers the most important engineering question before model cost or presentation work: can the existing BotArena world expose enough valid choices for 12 independent actors to produce a complete, inspectable match?

## Legacy systems during migration

The current `ai.ts`, `socialAI.ts`, declarative agent policies, tactical instructions, and player influences remain available only to legacy matches until the autonomous path satisfies the Phase 2 acceptance checks. They must not be blended into live autonomous decisions, because that would make it impossible to tell whether behavior came from the participant or from the old policy system.

After autonomous mode is proven, make it the canonical mode and remove the legacy decision path in a separate cleanup change.
