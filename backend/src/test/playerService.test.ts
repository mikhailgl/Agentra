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

  async create(id: string, tokenHash: string, state: PlayerState): Promise<StoredPlayerAccount> {
    const account = { id, tokenHash, state: clone(state), revision: 1 };
    this.accounts.set(id, account);
    return clone(account);
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
  assert.equal(opened.state.credits, 1_000);
  assert.deepEqual(opened.state.ownedBotIds, ["custom-12345678-legacy"]);

  const restored = await service.openSession(opened.sessionToken);
  assert.equal(restored.sessionToken, undefined);
  assert.equal(restored.state.accountId, opened.state.accountId);
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

function clone<T>(value: T): T {
  return value === null ? value : JSON.parse(JSON.stringify(value)) as T;
}
