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
