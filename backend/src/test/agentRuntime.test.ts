import assert from "node:assert/strict";
import test from "node:test";
import { createMatchFromPool } from "../../../frontend/src/game/createMatch.js";
import { createDefaultPool } from "../../../frontend/src/game/persistence.js";
import { stepAutonomousSimulation } from "../../../frontend/src/game/simulation.js";
import type { MatchState } from "../../../frontend/src/game/types.js";
import { AgentRuntime } from "../agentRuntime.js";
import { AgentOperationRegistry } from "../agents/operationRegistry.js";

test("operation IDs reject late or duplicate provider completions", () => {
  const registry = new AgentOperationRegistry();
  const first = registry.start("agent-1", "observation-1", 100);
  assert.ok(first);
  assert.equal(registry.start("agent-1", "observation-2", 110), null);
  assert.equal(registry.accept("agent-1", "wrong-operation"), null);
  assert.equal(registry.accept("agent-1", first.operationId)?.observationId, "observation-1");
  assert.equal(registry.accept("agent-1", first.operationId), null);
});

test("active autonomous actions and private memory survive a checkpoint restore", () => {
  const match = createInitialMatch();
  const runtime = new AgentRuntime("autonomous-fake");
  stepAutonomousSimulation(match, 100);
  runtime.tick(match, 100, 1_000);
  stepAutonomousSimulation(match, 100);
  runtime.tick(match, 100, 1_100);
  const checkpoint = runtime.checkpoint();
  assert.ok(checkpoint.activeActions.length > 0);

  const restored = new AgentRuntime("autonomous-fake");
  restored.restore(checkpoint);
  const restoredCheckpoint = restored.checkpoint();
  assert.deepEqual(restoredCheckpoint.activeActions, checkpoint.activeActions);
  assert.deepEqual(restoredCheckpoint.memories, checkpoint.memories);
  assert.equal(restoredCheckpoint.operations.pending.length, 0);
});

test("twelve deterministic fake participants finish with exactly one survivor", () => {
  const initial = createInitialMatch();
  const first = runFakeMatch(cloneJson(initial));
  const second = runFakeMatch(cloneJson(initial));

  assert.equal(first.match.ended, true);
  assert.equal(first.match.bots.filter((bot) => bot.alive).length, 1);
  assert.equal(first.match.winnerId, first.match.bots.find((bot) => bot.alive)?.id);
  assert.equal(second.match.winnerId, first.match.winnerId);
  assert.deepEqual(
    second.match.bots.map(({ id, alive, health, kills, damageDealt }) => ({ id, alive, health, kills, damageDealt })),
    first.match.bots.map(({ id, alive, health, kills, damageDealt }) => ({ id, alive, health, kills, damageDealt })),
  );
  assert.ok(first.traceCount > 0);
});

function runFakeMatch(match: MatchState): { match: MatchState; traceCount: number } {
  const runtime = new AgentRuntime("autonomous-fake");
  const deltaMs = 100;
  let step = 0;
  while (!match.ended && step < 6_100) {
    stepAutonomousSimulation(match, deltaMs);
    runtime.tick(match, deltaMs, 10_000 + step * deltaMs);
    step += 1;
  }
  return { match, traceCount: runtime.checkpoint().decisionTrace.length };
}

function createInitialMatch(): MatchState {
  const pool = createDefaultPool();
  return createMatchFromPool(pool, pool.slice(0, 12));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
