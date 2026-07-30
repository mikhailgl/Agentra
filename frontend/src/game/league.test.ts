import assert from "node:assert/strict";
import test from "node:test";
import { createMatchFromPool } from "./createMatch";
import { advanceLeagueSeason, applyLeagueMatchResult, createLeagueState, getLeagueEntrantIds, MATCHES_PER_SEASON } from "./league";
import { createDefaultPool } from "./persistence";

test("league results build an ordered table with form, points, and ratings", () => {
  const pool = createDefaultPool();
  const match = createMatchFromPool(pool, pool.slice(0, 4));
  match.bots.forEach((bot, index) => {
    bot.alive = index === 0;
    bot.survivalTimeMs = 20_000 - index * 1_000;
    bot.kills = index === 0 ? 2 : 0;
    bot.damageDealt = index === 0 ? 120 : 30;
  });

  const league = applyLeagueMatchResult(createLeagueState(pool), match, 1_000);
  const leader = league.standings[0];
  assert.equal(league.matchesCompleted, 1);
  assert.equal(leader.botId, match.bots[0].id);
  assert.equal(leader.points, 14);
  assert.equal(leader.form[0], "W");
  assert.equal(leader.matchesPlayed, 1);
  assert.ok(leader.rating > 1_000);
});

test("headline and championship fields favor the highest-ranked fighters", () => {
  const pool = createDefaultPool();
  const match = createMatchFromPool(pool, pool.slice(0, 4));
  match.bots.forEach((bot, index) => {
    bot.survivalTimeMs = 20_000 - index * 1_000;
  });

  let league = createLeagueState(pool);
  for (let index = 0; index < 4; index += 1) {
    league = applyLeagueMatchResult(league, match, index);
  }

  assert.equal(league.currentEvent.type, "headline");
  assert.deepEqual(getLeagueEntrantIds(league, 2), league.standings.slice(0, 2).map((standing) => standing.botId));
});

test("a completed season crowns a champion and advances without losing history", () => {
  const pool = createDefaultPool();
  const match = createMatchFromPool(pool, pool.slice(0, 3));
  match.bots.forEach((bot, index) => {
    bot.alive = index === 0;
    bot.survivalTimeMs = 20_000 - index * 1_000;
    bot.kills = index === 0 ? 1 : 0;
  });

  let league = createLeagueState(pool, 1, [], 100);
  for (let index = 0; index < MATCHES_PER_SEASON; index += 1) {
    league = applyLeagueMatchResult(league, match, 1_000 + index);
  }

  assert.equal(league.status, "completed");
  assert.equal(league.currentEvent.type, "championship");
  assert.equal(league.champions[0].botId, match.bots[0].id);

  const next = advanceLeagueSeason(league, pool, 2_000);
  assert.equal(next.seasonNumber, 2);
  assert.equal(next.status, "active");
  assert.equal(next.matchesCompleted, 0);
  assert.equal(next.champions[0].botId, match.bots[0].id);
  assert.ok(next.standings.every((standing) => standing.points === 0));
});
