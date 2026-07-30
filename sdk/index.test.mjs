import assert from "node:assert/strict";
import test from "node:test";
import { createBotArenaClient, defineStrategy } from "./index.mjs";

const manifest = {
  schemaVersion: 1,
  runtime: "declarative-v1",
  slug: "patient-hunter",
  name: "Patient Hunter",
  description: "Survive the opening, collect gear, then pressure the weakest visible rival.",
  policy: { aggression: 0.72, survival: 0.65, loot: 0.8, social: 0.25, vengeance: 0.4, targetPriority: "weakest" },
};

test("defineStrategy accepts only the bounded declarative contract", () => {
  assert.equal(defineStrategy(manifest).policy.targetPriority, "weakest");
  assert.throws(() => defineStrategy({ ...manifest, policy: { ...manifest.policy, aggression: 1.1 } }), /between 0 and 1/);
});

test("client submits a locally validated manifest with bearer authentication", async () => {
  let request;
  const client = createBotArenaClient({
    baseUrl: "https://arena.example/",
    apiKey: "ba_live_test",
    fetch: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ strategy: { ...manifest, id: "strategy-1", version: 1, authorName: "Coach", createdAt: 1 } }), { status: 201, headers: { "content-type": "application/json" } });
    },
  });
  const result = await client.submitStrategy(manifest);
  assert.equal(result.strategy.version, 1);
  assert.equal(request.url, "https://arena.example/api/agent/v1/strategies");
  assert.equal(request.init.headers.get("authorization"), "Bearer ba_live_test");
});
