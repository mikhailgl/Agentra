import assert from "node:assert/strict";
import test from "node:test";
import { progressAgentAction } from "./agentActions";
import { createMatchFromPool } from "./createMatch";
import { createLegacyWeaponLoot } from "./loot";
import { buildAgentObservation } from "./perception";
import { createDefaultPool } from "./persistence";
import type { AgentSpeech, MatchState } from "./types";

test("private observations include only visible people, witnessed events, and permitted speech", () => {
  const match = createTestMatch();
  const [observer, nearby, distant] = match.bots;
  place(observer, 100, 100);
  place(nearby, 130, 100);
  match.bots.slice(2).forEach((bot, index) => place(bot, 850 + (index % 3) * 35, 850 + Math.floor(index / 3) * 35));
  match.logEvents.push(
    { id: 80, timeMs: 10, message: "Nearby action", botId: nearby.id, x: 132, y: 100 },
    { id: 81, timeMs: 10, message: "Private distant action", botId: distant.id, x: 900, y: 900 },
    { id: 82, timeMs: 10, message: "Global secret without a location" },
  );
  const speech: AgentSpeech[] = [
    {
      id: "speech-nearby",
      speakerId: nearby.id,
      message: "Only you should hear this.",
      targetIds: [observer.id],
      position: { x: nearby.x, y: nearby.y },
      createdAtMs: match.elapsedMs,
      hearingRange: 80,
    },
    {
      id: "speech-distant",
      speakerId: distant.id,
      message: "Too far away.",
      position: { x: distant.x, y: distant.y },
      createdAtMs: match.elapsedMs,
      hearingRange: 80,
    },
  ];

  const observation = buildAgentObservation(match, observer.id, { speech });
  assert.deepEqual(observation.visiblePeople.map((person) => person.id), [nearby.id]);
  assert.deepEqual(observation.heardSpeech.map((utterance) => utterance.speechId), ["speech-nearby"]);
  assert.ok(observation.observedEvents.some((event) => event.eventId === 80));
  assert.ok(!observation.observedEvents.some((event) => event.eventId === 81 || event.eventId === 82));
  assert.equal("relationships" in observation.self, false);
  assert.equal(observation.knownRule, "Only one living participant can leave");
});

test("unseen targets and out-of-bounds movement are rejected without mutation", () => {
  const match = createTestMatch();
  const [actor, hiddenTarget] = match.bots;
  place(actor, 100, 100);
  place(hiddenTarget, 900, 900);
  actor.inventory.weapon = { name: "Test Blade", damage: 20, range: 50, cooldownMs: 100, accuracy: 1 };
  const observation = buildAgentObservation(match, actor.id);
  const initial = { x: actor.x, y: actor.y, targetHealth: hiddenTarget.health };

  const attack = progressAgentAction(match, observation, { type: "attack", targetId: hiddenTarget.id }, 100);
  const move = progressAgentAction(match, observation, { type: "move", destination: { x: -10, y: 20 } }, 100);

  assert.equal(attack.result.status, "rejected");
  assert.equal(move.result.status, "rejected");
  assert.deepEqual({ x: actor.x, y: actor.y, targetHealth: hiddenTarget.health }, initial);
});

test("a participant can take only a nearby object exposed by its observation", () => {
  const match = createTestMatch();
  const actor = match.bots[0];
  place(actor, 100, 100);
  const nearbyWeapon = createLegacyWeaponLoot("nearby-weapon", 110, 100, "Knife");
  const distantWeapon = createLegacyWeaponLoot("distant-weapon", 800, 800, "Spear");
  match.loot = [nearbyWeapon, distantWeapon];
  const observation = buildAgentObservation(match, actor.id);

  const taken = progressAgentAction(match, observation, { type: "take", objectId: nearbyWeapon.id }, 100);
  const hidden = progressAgentAction(match, observation, { type: "take", objectId: distantWeapon.id }, 100);

  assert.equal(taken.result.status, "completed");
  assert.equal(actor.inventory.weapon?.name, nearbyWeapon.name);
  assert.ok(!match.loot.some((item) => item.id === nearbyWeapon.id));
  assert.equal(hidden.result.status, "rejected");
  assert.ok(match.loot.some((item) => item.id === distantWeapon.id));
});

function createTestMatch(): MatchState {
  const pool = createDefaultPool();
  return createMatchFromPool(pool, pool.slice(0, 12));
}

function place(bot: MatchState["bots"][number], x: number, y: number): void {
  bot.x = x;
  bot.y = y;
}
