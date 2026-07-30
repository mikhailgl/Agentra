import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAgentStrategySubmission } from "./agentStrategy";
import { decideBotAction } from "./ai";
import { createMatchFromPool } from "./createMatch";
import { createDefaultPool } from "./persistence";

const submission = {
  schemaVersion: 1,
  runtime: "declarative-v1",
  slug: "patient-hunter",
  name: "Patient Hunter",
  description: "Collect gear, preserve health, and pressure the weakest visible rival.",
  policy: { aggression: 0.72, survival: 0.65, loot: 0.8, social: 0.25, vengeance: 0.4, targetPriority: "weakest" },
};

test("agent strategy submissions are reduced to the bounded v1 contract", () => {
  const normalized = normalizeAgentStrategySubmission({ ...submission, ignoredExecutable: "while(true){}" });
  assert.deepEqual(normalized, submission);
  assert.equal("ignoredExecutable" in (normalized ?? {}), false);
});

test("agent strategy submissions reject out-of-range policy values and unknown runtimes", () => {
  assert.equal(normalizeAgentStrategySubmission({ ...submission, policy: { ...submission.policy, loot: 2 } }), null);
  assert.equal(normalizeAgentStrategySubmission({ ...submission, runtime: "javascript" }), null);
});

test("a linked target policy changes the fighter's server-side decision", () => {
  const pool = createDefaultPool();
  const match = createMatchFromPool(pool, pool.slice(0, 3));
  const [fighter, nearest, weakest] = match.bots;
  fighter.x = 0;
  fighter.y = 0;
  fighter.health = 100;
  fighter.inventory.weapon = { name: "Test Spear", damage: 20, range: 1_000, cooldownMs: 500 };
  fighter.psychology = { aggression: 0, loyalty: 0, opportunism: 0, selfPreservation: 0, ambition: 0, sociability: 0, vengefulness: 0, riskTolerance: 1 };
  fighter.agentStrategy = {
    id: "strategy-1",
    schemaVersion: 1,
    runtime: "declarative-v1",
    slug: "weakest-first",
    name: "Weakest First",
    description: "Always pressure the weakest visible rival before a closer healthy target.",
    version: 1,
    authorName: "Test Coach",
    policy: { aggression: 0.5, survival: 0.5, loot: 0.5, social: 0, vengeance: 0, targetPriority: "weakest" },
    createdAt: 1,
  };
  nearest.x = 80;
  nearest.y = 0;
  nearest.health = 100;
  weakest.x = 150;
  weakest.y = 0;
  weakest.health = 10;

  const decision = decideBotAction(fighter, match);
  assert.equal(decision.action, "attack");
  assert.equal("id" in decision.target ? decision.target.id : null, weakest.id);
});
