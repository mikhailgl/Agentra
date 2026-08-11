# BotArena design decisions

## 2026-08-09: Autonomous arena foundation

The base game engine is a fixed space containing 12 autonomous, humanlike agents. The only fact every agent knows for certain is that exactly one survivor can leave. Agents decide for themselves how to respond. A RimWorld-style gamemaster introduces world events but does not prescribe storylines, alliances, betrayals, or outcomes.

Stories are observations made after events emerge from the simulation; they are not inputs used to steer the agents.

### Deferred suggestion: different update cadences

We discussed running world execution and high-level agent deliberation at different update frequencies. This is not part of the base design. Revisit it only if a concrete issue—such as model latency blocking the world, excessive inference cost, unstable repeated decisions, or interrupted action execution—shows that the added mechanism solves a real problem.

## Open-source starting points

Research checked on 2026-08-09:

- **AI Town** (`a16z-infra/ai-town`, MIT, TypeScript): strongest source for reusable agent memory, first-person conversation summaries, memory retrieval, conversations, and persistent shared-world patterns. Borrow selected patterns; do not replace the existing Express/Supabase backend with Convex.
- **Concordia** (`google-deepmind/concordia`, Apache-2.0, Python): strongest reference architecture for autonomous entities, observations, actions, event resolution, termination/death, and a separate Game Master entity. Port the relevant contracts to TypeScript rather than adopting its Python runtime wholesale.
- **Vercel AI SDK** (`vercel/ai`, TypeScript): suitable provider-neutral plumbing for schema-validated agent actions and model calls. It is infrastructure, not the agent mind or game engine.
- **pgvector** through the existing Supabase Postgres database: suitable for retrieving relevant private memories without adding another database. Keep authoritative world state and action validation in the BotArena backend.
- **Sotopia** (`sotopia-lab/sotopia`, MIT, Python) and **Melting Pot** (`google-deepmind/meltingpot`, Apache-2.0, Python): useful later for social-behavior test ideas and evaluation, not as the production arena runtime.
- **Voyager** (`MineDojo/Voyager`, MIT): useful later if agents need to acquire and reuse compound physical skills. It is not needed for the first arena.
- **SimWorld** (`SimWorld-AI/SimWorld`, Apache-2.0): relevant only if BotArena later moves from its web/Three.js world to an Unreal Engine embodied simulation.

No official open-source repository or public SDK was found for Humalike's GTA roleplay implementation.

Exact pinned revisions, upstream functions, BotArena destination files, exclusions, and license handling are maintained in [`autonomous-arena-plan.md`](./autonomous-arena-plan.md#exact-open-source-adoption-plan).
