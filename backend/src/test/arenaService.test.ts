import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultPool } from "../../../frontend/src/game/persistence.js";
import type { PersistentBot } from "../../../frontend/src/game/types.js";
import { ArenaService, type ArenaCheckpoint } from "../arenaService.js";

test("version 3 checkpoints preserve the persistent roster and league", () => {
  const service = new ArenaService();
  const customBot = createCustomBot();
  const snapshot = service.registerCustomBot(customBot, true);
  assert.ok(snapshot);
  assert.ok(snapshot.persistentBots?.some((bot) => bot.id === customBot.id));
  assert.equal(snapshot.persistentBots?.find((bot) => bot.id === customBot.id)?.tacticalInstruction, undefined);
  assert.equal(snapshot.arenaQueueIds?.[0], customBot.id);

  const checkpoint = service.getCheckpoint();
  assert.equal(checkpoint.version, 3);
  assert.ok(checkpoint.persistentBots?.some((bot) => bot.id === customBot.id));
  assert.ok(checkpoint.leagueState?.standings.some((standing) => standing.botId === customBot.id));

  const restored = new ArenaService();
  restored.restore(checkpoint);
  const restoredSnapshot = restored.getSnapshot({ includeRoster: true });
  assert.ok(restoredSnapshot.persistentBots?.some((bot) => bot.id === customBot.id));
  assert.equal(restoredSnapshot.arenaQueueIds?.[0], customBot.id);
  assert.equal(restoredSnapshot.leagueState.seasonId, checkpoint.leagueState?.seasonId);
});

test("legacy checkpoints still restore without league state", () => {
  const service = new ArenaService();
  const current = service.getCheckpoint();
  const legacy: ArenaCheckpoint = { ...current, version: 2, leagueState: undefined };
  const restored = new ArenaService();
  assert.doesNotThrow(() => restored.restore(legacy));
  assert.equal(restored.getSnapshot().arenaState.matchNumber, legacy.matchNumber);
});

test("finalizing a match persists progression and produces a match log", async () => {
  let loggedMatchNumber: number | null = null;
  let loggedEventCount = 0;
  const service = new ArenaService({
    onMatchLogReady: (log) => {
      loggedMatchNumber = log.matchNumber;
      loggedEventCount = log.events.length;
    },
  });
  const checkpoint = service.getCheckpoint();
  checkpoint.match.logEvents.push({ id: 99_999, timeMs: 1_000, message: "Persist this event", kind: "system" });
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
  assert.ok(loggedEventCount > 0);
  assert.deepEqual(finalized.match.logEvents, []);
  assert.deepEqual(finalized.match.historyEvents, []);
  assert.deepEqual(finalized.match.learningEvents, []);
  assert.deepEqual(finalized.match.eventDebounce, {});
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
