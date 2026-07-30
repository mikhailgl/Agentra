import assert from "node:assert/strict";
import test from "node:test";
import { createMatchFromPool } from "../../../frontend/src/game/createMatch.js";
import { createDefaultPool } from "../../../frontend/src/game/persistence.js";
import type { PlayerState } from "../../../frontend/src/game/types.js";
import type { PlayerAccountStore, StoredPlayerAccount } from "../playerAccountRepository.js";
import { InvalidPlayerSessionError, PlayerActionError, PlayerService } from "../playerService.js";

class MemoryPlayerStore implements PlayerAccountStore {
  private readonly accounts = new Map<string, StoredPlayerAccount>();
  private readonly botOwners = new Map<string, string>();

  async findByTokenHash(tokenHash: string): Promise<StoredPlayerAccount | null> {
    return clone([...this.accounts.values()].find((account) => account.tokenHash === tokenHash) ?? null);
  }

  async findByRecoveryTokenHash(tokenHash: string): Promise<StoredPlayerAccount | null> {
    return clone([...this.accounts.values()].find((account) => account.recoveryTokenHash === tokenHash) ?? null);
  }

  async create(id: string, tokenHash: string, recoveryTokenHash: string, state: PlayerState): Promise<StoredPlayerAccount> {
    const account = { id, tokenHash, recoveryTokenHash, state: clone(state), revision: 1 };
    this.accounts.set(id, account);
    return clone(account);
  }

  async rotateSessionToken(id: string, tokenHash: string): Promise<StoredPlayerAccount> {
    const account = this.accounts.get(id);
    if (!account) throw new Error("Missing account");
    const updated = { ...account, tokenHash };
    this.accounts.set(id, updated);
    return clone(updated);
  }

  async rotateRecoveryToken(id: string, recoveryTokenHash: string): Promise<StoredPlayerAccount> {
    const account = this.accounts.get(id);
    if (!account) throw new Error("Missing account");
    const updated = { ...account, recoveryTokenHash };
    this.accounts.set(id, updated);
    return clone(updated);
  }

  async save(id: string, state: PlayerState, expectedRevision: number): Promise<StoredPlayerAccount | null> {
    const current = this.accounts.get(id);
    if (!current || current.revision !== expectedRevision) return null;
    const saved = { ...current, state: clone(state), revision: expectedRevision + 1 };
    this.accounts.set(id, saved);
    return clone(saved);
  }

  async listSettlementCandidates(matchId: string, winnerBotId?: string): Promise<StoredPlayerAccount[]> {
    return clone([...this.accounts.values()].filter((account) =>
      account.state.bets.some((bet) => bet.matchId === matchId && bet.status === "pending") ||
      (winnerBotId ? this.botOwners.get(winnerBotId) === account.id : false),
    ));
  }

  async listFantasyCandidates(botIds: string[]): Promise<StoredPlayerAccount[]> {
    return clone([...this.accounts.values()].filter((account) => account.state.draftedBotIds.some((id) => botIds.includes(id))));
  }

  async listFantasyLeaderboard(seasonId: string, limit: number) {
    return clone([...this.accounts.values()]
      .filter((account) => account.state.fantasy.seasonId === seasonId && account.state.fantasy.points > 0)
      .sort((a, b) => b.state.fantasy.points - a.state.fantasy.points)
      .slice(0, limit)
      .map((account) => ({
        accountId: account.id,
        accountName: account.state.accountName,
        points: account.state.fantasy.points,
        rosterSize: account.state.draftedBotIds.length,
      })));
  }

  async claimBot(accountId: string, botId: string): Promise<boolean> {
    if (this.botOwners.has(botId)) return false;
    this.botOwners.set(botId, accountId);
    return true;
  }

  async releaseBot(accountId: string, botId: string): Promise<void> {
    if (this.botOwners.get(botId) === accountId) this.botOwners.delete(botId);
  }
}

test("opaque sessions restore the same server-authoritative player", async () => {
  const service = new PlayerService(new MemoryPlayerStore());
  const opened = await service.openSession(undefined, { ownedBotIds: ["custom-12345678-legacy"] });
  assert.ok(opened.sessionToken);
  assert.ok(opened.recoveryCode);
  assert.equal(opened.state.credits, 1_000);
  assert.deepEqual(opened.state.ownedBotIds, ["custom-12345678-legacy"]);

  const restored = await service.openSession(opened.sessionToken);
  assert.equal(restored.sessionToken, undefined);
  assert.equal(restored.state.accountId, opened.state.accountId);
});

test("recovery keys move an account to a new browser and rotate the old session", async () => {
  const service = new PlayerService(new MemoryPlayerStore());
  const opened = await service.openSession();
  assert.ok(opened.sessionToken);
  assert.ok(opened.recoveryCode);
  const originalRecoveryCode = opened.recoveryCode;
  const named = await service.updateAccountName(opened.sessionToken, "Iron Coach");
  assert.equal(named.accountName, "Iron Coach");

  const recovered = await service.recoverSession(originalRecoveryCode);
  assert.equal(recovered.state.accountId, opened.state.accountId);
  assert.equal(recovered.state.accountName, "Iron Coach");
  await assert.rejects(() => service.getState(opened.sessionToken), InvalidPlayerSessionError);
  assert.equal((await service.getState(recovered.sessionToken)).accountName, "Iron Coach");

  const replacement = await service.rotateRecoveryCode(recovered.sessionToken);
  await assert.rejects(() => service.recoverSession(originalRecoveryCode), InvalidPlayerSessionError);
  assert.ok(replacement.recoveryCode);
});

test("wallet mutations reject invalid sessions and insufficient funds", async () => {
  const service = new PlayerService(new MemoryPlayerStore());
  await assert.rejects(() => service.getState("missing-token-that-is-at-least-32-characters"), InvalidPlayerSessionError);
  const opened = await service.openSession();
  await assert.rejects(() => service.charge(opened.sessionToken, 1_001), PlayerActionError);
  assert.equal((await service.getState(opened.sessionToken)).credits, 1_000);
});

test("custom fighter ownership is exclusive across player accounts", async () => {
  const service = new PlayerService(new MemoryPlayerStore());
  const first = await service.openSession();
  const second = await service.openSession();
  await service.claimBot(first.sessionToken, "custom-exclusive-12345678", 250);
  await assert.rejects(
    () => service.claimBot(second.sessionToken, "custom-exclusive-12345678", 250),
    /already belongs to another player/,
  );
  assert.equal((await service.getState(second.sessionToken)).credits, 1_000);
});

test("predictions and owned-fighter prizes settle exactly once", async () => {
  const service = new PlayerService(new MemoryPlayerStore());
  const opened = await service.openSession();
  const token = opened.sessionToken;
  assert.ok(token);
  const pool = createDefaultPool();
  const match = createMatchFromPool(pool, pool.slice(0, 3));
  const winner = match.bots[0];
  winner.custom = true;
  winner.carriedCredits = 75;
  match.ended = true;
  match.winnerId = winner.id;
  match.bots.forEach((bot, index) => {
    bot.alive = index === 0;
    bot.survivalTimeMs = 10_000 - index * 1_000;
  });

  await service.claimBot(token, winner.id, 100);
  await service.placeBet(token, { ...match, ended: false }, { type: "winner", botId: winner.id, amount: 100, odds: 2 });
  await service.resolveMatch(match);
  const settled = await service.getState(token);
  assert.equal(settled.credits, 1_075);
  assert.equal(settled.betHistory[0].status, "won");
  assert.deepEqual(settled.settledMatchIds, [match.id]);

  await service.resolveMatch(match);
  assert.equal((await service.getState(token)).credits, 1_075);
});

test("fantasy rosters score each match once and reset with a new season", async () => {
  const service = new PlayerService(new MemoryPlayerStore());
  const opened = await service.openSession();
  const pool = createDefaultPool();
  const match = createMatchFromPool(pool, pool.slice(0, 3));
  match.bots.forEach((bot, index) => {
    bot.alive = index === 0;
    bot.survivalTimeMs = 12_000 - index * 1_000;
    bot.kills = index === 0 ? 2 : 0;
    bot.damageDealt = index === 0 ? 120 : 0;
  });
  await service.setFantasyRoster(opened.sessionToken, [match.bots[0].id], new Set(pool.map((bot) => bot.id)), "season-1");

  await service.scoreFantasyMatch(match, "season-1");
  await service.scoreFantasyMatch(match, "season-1");
  const scored = await service.getState(opened.sessionToken);
  assert.equal(scored.fantasy.points, 16);
  assert.equal(scored.fantasy.history.length, 1);

  const leaderboard = await service.listFantasyLeaderboard("season-1");
  assert.equal(leaderboard[0].accountName, scored.accountName);
  assert.equal(leaderboard[0].points, 16);

  const nextMatch = { ...match, id: `${match.id}-next` };
  await service.scoreFantasyMatch(nextMatch, "season-2");
  const reset = await service.getState(opened.sessionToken);
  assert.equal(reset.fantasy.seasonId, "season-2");
  assert.equal(reset.fantasy.points, 16);
  assert.equal(reset.fantasy.history.length, 1);
});

function clone<T>(value: T): T {
  return value === null ? value : JSON.parse(JSON.stringify(value)) as T;
}
