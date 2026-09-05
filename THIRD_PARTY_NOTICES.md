# Third-party source notices

BotArena remains an independent TypeScript/Three.js implementation. The files below adapt small ideas or protocols from the listed open-source projects; none of the upstream runtimes are vendored.

## AI Town

- Repository: https://github.com/a16z-infra/ai-town
- Revision: `7b242334bfbfef02f7718bded120d431e8f307df`
- License: MIT
- Copyright: 2023 a16z-infra
- Upstream elements: `convex/aiTown/agent.ts` (`inProgressOperation`, `startOperation`) and `convex/aiTown/agentOperations.ts` (operation-ID completion protocol)
- BotArena adaptation: `backend/src/agents/operationRegistry.ts` and the completion queue in `backend/src/agentRuntime.ts`

The MIT license text for AI Town is available at https://github.com/a16z-infra/ai-town/blob/7b242334bfbfef02f7718bded120d431e8f307df/LICENSE.

## Concordia

- Repository: https://github.com/google-deepmind/concordia
- Revision: `513c3d622d19cf99f1c2f63991b648ffd3d5fcb5`
- License: Apache License 2.0
- Upstream elements: `concordia/environment/engine.py` (`Engine` lifecycle), `concordia/typing/entity.py` (`ActionSpec` validation boundary), and `concordia/components/game_master/make_observation.py` (`ObservationQueue` semantics)
- BotArena adaptation: the observation/proposal/resolution boundary in `frontend/src/game/agentActions.ts`, `frontend/src/game/perception.ts`, and `backend/src/agentRuntime.ts`

The Apache License 2.0 text for Concordia is available at https://github.com/google-deepmind/concordia/blob/513c3d622d19cf99f1c2f63991b648ffd3d5fcb5/LICENSE.

## SOTOPIA

- Repository: https://github.com/sotopia-lab/sotopia
- Revision: `a0aaafb440e570e5e61b7c44a44e5e417c545383`
- License: MIT
- Copyright: 2023 Hao Zhu
- Upstream elements: `sotopia/messages/message_classes.py` (recipient/action validation) and `sotopia/envs/parallel.py` (per-viewer action visibility)
- BotArena adaptation: targeted speech validation and per-listener delivery in `frontend/src/game/agentActions.ts`, `frontend/src/game/perception.ts`, and `backend/src/agentRuntime.ts`

The MIT license text for SOTOPIA is available at https://github.com/sotopia-lab/sotopia/blob/a0aaafb440e570e5e61b7c44a44e5e417c545383/LICENSE.

## Aetheria

- Repository: https://github.com/mositron/Aetheria
- Revision reviewed: `300c1dc91feb0f412e42d05886086224aa685b7b`
- License: MIT
- Upstream inspiration: its procedural primitive-based Three.js approach to expressive characters, equipment, biome dressing, and effects without downloaded model packs.
- BotArena adaptation: original React Three Fiber geometry in `frontend/src/components/arena/` for articulated fighters, weapon silhouettes, creatures, pickups, and environmental dressing. No upstream source files or binary assets are included.

Aetheria's MIT license statement is available at https://github.com/mositron/Aetheria#license.

## EZ-Tree

- Repository: https://github.com/dgreenheck/ez-tree
- Revision reviewed: `dcf309bd86bd521083d9c70f01f2de45fdc7c457`
- License: MIT
- Upstream inspiration: deterministic tree generation, shared materials, geometry simplification, and LOD/instancing principles for dense vegetation.
- BotArena adaptation: original deterministic, instanced low-poly tree and foliage components in `frontend/src/components/arena/ArenaEnvironment.tsx`. The EZ-Tree package, textures, and source are not vendored.

The MIT license text for EZ-Tree is available at https://github.com/dgreenheck/ez-tree/blob/dcf309bd86bd521083d9c70f01f2de45fdc7c457/LICENSE.
