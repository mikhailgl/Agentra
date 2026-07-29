import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultPool } from "../../../frontend/src/game/persistence.js";
import type { PersistentBot } from "../../../frontend/src/game/types.js";
import { ArenaService, type ArenaCheckpoint } from "../arenaService.js";

test("version 2 checkpoints preserve the persistent roster", () => {
  const service = new ArenaService();
  const customBot = createCustomBot();
  const snapshot = service.registerCustomBot(customBot, true);
  assert.ok(snapshot);
  assert.ok(snapshot.persistentBots?.some((bot) => bot.id === customBot.id));
  assert.equal(snapshot.arenaQueueIds?.[0], customBot.id);

  const checkpoint = service.getCheckpoint();
  assert.equal(checkpoint.version, 2);
  assert.ok(checkpoint.persistentBots?.some((bot) => bot.id === customBot.id));

  const restored = new ArenaService();
  restored.restore(checkpoint);
  const restoredSnapshot = restored.getSnapshot({ includeRoster: true });
  assert.ok(restoredSnapshot.persistentBots?.some((bot) => bot.id === customBot.id));
  assert.equal(restoredSnapshot.arenaQueueIds?.[0], customBot.id);
});

test("legacy checkpoints still restore without a persistent roster", () => {
  const service = new ArenaService();
  const current = service.getCheckpoint();
  const legacy: ArenaCheckpoint = { ...current, version: 1, persistentBots: undefined };
  const restored = new ArenaService();
  assert.doesNotThrow(() => restored.restore(legacy));
  assert.equal(restored.getSnapshot().arenaState.matchNumber, legacy.matchNumber);
});

test("finalizing a match persists progression and produces a match log", async () => {
  let loggedMatchNumber: number | null = null;
  const service = new ArenaService({ onMatchLogReady: (log) => { loggedMatchNumber = log.matchNumber; } });
  const checkpoint = service.getCheckpoint();
  checkpoint.match.ended = true;
  checkpoint.match.finalized = false;
  checkpoint.match.winnerId = checkpoint.match.bots[0].id;
  checkpoint.match.bots.forEach((bot, index) => {
    bot.alive = index === 0;
    bot.survivalTimeMs = 10_000 - index * 100;
  });
  service.restore(checkpoint);
  service.start();
  await new Promise((resolve) => setTimeout(resolve, 80));
  service.stop();

  const finalized = service.getCheckpoint();
  const winner = finalized.persistentBots?.find((bot) => bot.id === checkpoint.match.winnerId);
  assert.equal(loggedMatchNumber, checkpoint.matchNumber);
  assert.equal(winner?.career.matchesPlayed, 1);
  assert.equal(winner?.career.wins, 1);
  assert.equal(winner?.journal?.[0].matchNumber, checkpoint.matchNumber);
});

test("invalid custom bots are rejected", () => {
  const service = new ArenaService();
  assert.equal(service.registerCustomBot({ id: "not-custom", name: "Bad bot" }, true), null);
});

function createCustomBot(): PersistentBot {
  const base = createDefaultPool()[0];
  return {
    ...base,
    id: "custom-12345678-release",
    name: "Release Bot",
    custom: true,
    relationships: {},
    recentResults: [],
    journal: [],
  };
}
