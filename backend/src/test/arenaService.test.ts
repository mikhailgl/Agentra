import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultPool } from "../../../frontend/src/game/persistence.js";
import type { PersistentBot } from "../../../frontend/src/game/types.js";
import { ArenaService, type ArenaCheckpoint } from "../arenaService.js";

test("version 4 checkpoints preserve the persistent roster, league, and agent runtime", () => {
  const service = new ArenaService();
  const customBot = createCustomBot();
  const snapshot = service.registerCustomBot(customBot, true);
  assert.ok(snapshot);
  assert.ok(snapshot.persistentBots?.some((bot) => bot.id === customBot.id));
  assert.equal(snapshot.persistentBots?.find((bot) => bot.id === customBot.id)?.tacticalInstruction, undefined);
  assert.equal(snapshot.arenaQueueIds?.[0], customBot.id);

  const checkpoint = service.getCheckpoint();
  assert.equal(checkpoint.version, 4);
  assert.equal(checkpoint.agentRuntime?.mode, "legacy");
  assert.ok(checkpoint.persistentBots?.some((bot) => bot.id === customBot.id));
  assert.ok(checkpoint.leagueState?.standings.some((standing) => standing.botId === customBot.id));

  const restored = new ArenaService();
  restored.restore(checkpoint);
  const restoredSnapshot = restored.getSnapshot({ includeRoster: true });
  assert.ok(restoredSnapshot.persistentBots?.some((bot) => bot.id === customBot.id));
  assert.equal(restoredSnapshot.arenaQueueIds?.[0], customBot.id);
  assert.equal(restoredSnapshot.leagueState.seasonId, checkpoint.leagueState?.seasonId);
});

test("autonomous-fake mode advances without invoking legacy bot thoughts", async () => {
  const service = new ArenaService({ agentRuntimeMode: "autonomous-fake" });
  service.start();
  await new Promise((resolve) => setTimeout(resolve, 130));
  service.stop();

  const checkpoint = service.getCheckpoint();
  assert.equal(checkpoint.agentRuntime?.mode, "autonomous-fake");
  assert.ok((checkpoint.agentRuntime?.activeActions.length ?? 0) > 0 || (checkpoint.agentRuntime?.decisionTrace.length ?? 0) > 0);
  assert.ok(checkpoint.match.bots.every((bot) => bot.thoughts.length === 0));
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

test("owner identity follows a custom fighter into public roster and league state", () => {
  const service = new ArenaService();
  const bot = { ...createCustomBot(), ownerId: "12345678-1234-1234-1234-123456789abc", ownerName: "First Coach" };
  assert.ok(service.registerCustomBot(bot, false));
  const renamed = service.updateOwnerName(bot.ownerId, "Legend Keeper");
  const publicBot = renamed.persistentBots?.find((candidate) => candidate.id === bot.id);
  const standing = renamed.leagueState.standings.find((candidate) => candidate.botId === bot.id);
  assert.equal(publicBot?.ownerName, "Legend Keeper");
  assert.equal(standing?.ownerName, "Legend Keeper");
});

test("a versioned external strategy becomes public fighter identity and persists in checkpoints", () => {
  const service = new ArenaService();
  const bot = { ...createCustomBot(), ownerId: "12345678-1234-1234-1234-123456789abc", ownerName: "Circuit Sage" };
  assert.ok(service.registerCustomBot(bot, false));
  const strategy = {
    id: "12345678-1234-1234-1234-123456789def",
    schemaVersion: 1 as const,
    runtime: "declarative-v1" as const,
    slug: "patient-hunter",
    name: "Patient Hunter",
    description: "Collect gear, preserve health, and pressure the weakest visible rival.",
    version: 2,
    authorName: "Circuit Sage",
    policy: { aggression: 0.72, survival: 0.65, loot: 0.8, social: 0.25, vengeance: 0.4, targetPriority: "weakest" as const },
    createdAt: 10_000,
  };
  const snapshot = service.updateBotAgentStrategy(bot.id, strategy);
  assert.equal(snapshot?.persistentBots?.find((candidate) => candidate.id === bot.id)?.agentStrategy?.id, strategy.id);
  assert.equal(service.getCheckpoint().persistentBots?.find((candidate) => candidate.id === bot.id)?.agentStrategy?.version, 2);
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
