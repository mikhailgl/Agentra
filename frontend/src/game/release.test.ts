import assert from "node:assert/strict";
import test from "node:test";
import { createMatchFromPool } from "./createMatch";
import { createMatchLog } from "./matchLog";
import { DEFAULT_MATCH_CONFIG } from "./matchConfig";
import { moveAway } from "./math";
import { applyPersistentBotMatchResult, createDefaultPool } from "./persistence";
import { getSponsorDropCost, placeBet, resolveMatchBets } from "./player";
import { stepSimulation } from "./simulation";
import type { PlayerState } from "./types";

test("configured matches use their own geometry and allowed event set", () => {
  const pool = createDefaultPool();
  const match = createMatchFromPool(pool, pool.slice(0, 2), undefined, 0, {
    roster: { matchBotCount: 2 },
    arena: { size: 520, spawnRadius: 190 },
    events: {
      firstEventMinMs: 0,
      eventCooldownMs: 0,
      allowedArenaEvents: ["danger_zone"],
    },
  });

  assert.equal(match.config?.arena.size, 520);
  assert.equal(match.bots.length, 2);
  assert.ok(match.bots.every((bot) => bot.x >= 0 && bot.x <= 520 && bot.y >= 0 && bot.y <= 520));

  stepSimulation(match, 50);
  assert.equal(match.arenaEvents.length, 1);
  assert.equal(match.arenaEvents[0].type, "danger_zone");
});

test("coincident fighters separate inward and respect arena padding", () => {
  const next = moveAway({ x: 1_000, y: 1_000 }, { x: 1_000, y: 1_000 }, 40, DEFAULT_MATCH_CONFIG);

  assert.ok(next.x < 982);
  assert.ok(next.y < 982);
  assert.ok(next.x >= DEFAULT_MATCH_CONFIG.arena.edgePadding);
  assert.ok(next.y >= DEFAULT_MATCH_CONFIG.arena.edgePadding);
});

test("overtime deterministically resolves a stalled match", () => {
  const pool = createDefaultPool();
  const match = createMatchFromPool(pool, pool.slice(0, 3), undefined, 0, {
    roster: { matchBotCount: 3 },
    rules: { maxDurationMs: 1 },
  });
  match.bots[1].kills = 3;

  stepSimulation(match, 50);

  assert.equal(match.ended, true);
  assert.equal(match.winnerId, match.bots[1].id);
  assert.equal(match.bots.filter((bot) => bot.alive).length, 1);
});

test("bet settlement pays winners once and preserves ownership", () => {
  const pool = createDefaultPool();
  const match = createMatchFromPool(pool, pool.slice(0, 3));
  match.ended = true;
  match.winnerId = match.bots[0].id;
  match.bots[0].kills = 2;
  match.bots[0].survivalTimeMs = 10_000;
  match.bots[1].survivalTimeMs = 8_000;
  match.bots[2].survivalTimeMs = 4_000;

  const player = createPlayerState();
  const placed = placeBet(player, { ...match, ended: false }, "winner", match.bots[0].id, 100, 2);
  if (!placed) assert.fail("Expected a valid bet to be placed");
  const resolution = resolveMatchBets(placed, match);
  assert.equal(resolution.results.length, 1);
  assert.equal(resolution.results[0].bet.status, "won");
  assert.equal(resolution.state.credits, 1_100);
  assert.equal(resolution.state.bets.length, 0);
  assert.equal(resolveMatchBets(resolution.state, match).results.length, 0);
  assert.deepEqual(resolution.state.ownedBotIds, player.ownedBotIds);
});

test("sponsor drops have stable positive prices", () => {
  assert.deepEqual(
    ["Knife", "Spear", "Bow", "Medkit"].map((kind) => getSponsorDropCost(kind as "Knife" | "Spear" | "Bow" | "Medkit")),
    [35, 50, 65, 40],
  );
});

test("persistent progression updates career, affinities, and journal together", () => {
  const pool = createDefaultPool();
  const persistent = pool[0];
  const match = createMatchFromPool(pool, pool.slice(0, 2));
  const matchBot = match.bots[0];
  match.winnerId = matchBot.id;
  matchBot.alive = true;
  matchBot.kills = 1;
  matchBot.damageDealt = 80;
  matchBot.survivalTimeMs = 25_000;
  matchBot.biomeTimeMs.forest = 25_000;

  applyPersistentBotMatchResult(persistent, matchBot, match, 1, 42);

  assert.equal(persistent.career.matchesPlayed, 1);
  assert.equal(persistent.career.wins, 1);
  assert.equal(persistent.journal?.[0].matchNumber, 42);
  assert.ok((persistent.affinities.biomes.forest ?? 1) > 1);
  assert.deepEqual(matchBot.career, persistent.career);
});

test("match logs are complete and chronologically ordered", () => {
  const pool = createDefaultPool();
  const match = createMatchFromPool(pool, pool.slice(0, 2));
  match.logEvents = [
    { id: 3, timeMs: 300, message: "third" },
    { id: 2, timeMs: 100, message: "first" },
  ];
  match.elapsedMs = 1_000;
  match.ended = true;
  match.winnerId = match.bots[0].id;

  const log = createMatchLog(7, match, 10_000);
  assert.equal(log.matchNumber, 7);
  assert.equal(log.winnerBotId, match.bots[0].id);
  assert.deepEqual(log.events.map((event) => event.message), ["first", "third"]);
  assert.equal(log.startedAt, 9_000);
  assert.equal(log.entrants.length, 2);
});

function createPlayerState(): PlayerState {
  return {
    accountId: "guest:test-player",
    accountName: "Test player",
    credits: 1_000,
    ownedBotIds: ["custom-owned-bot"],
    favoriteBotIds: [],
    draftedBotIds: [],
    bets: [],
    betHistory: [],
    nudgeHistory: [],
    settledMatchIds: [],
    fantasy: { seasonId: null, points: 0, scoredMatchIds: [], history: [] },
    stats: {
      totalBetsPlaced: 0,
      totalBetWinnings: 0,
      totalSponsorshipsSent: 0,
      totalNudgesUsed: 0,
      biggestPayout: 0,
    },
  };
}
