import assert from "node:assert/strict";
import test from "node:test";
import type { AgentStrategy } from "../../../frontend/src/game/types.js";
import type { CreatorApiStore, StoredAgentStrategy } from "../creatorApiRepository.js";
import { CreatorApiService } from "../creatorApiService.js";
import { InvalidPlayerSessionError } from "../playerService.js";

class MemoryCreatorStore implements CreatorApiStore {
  private readonly apiKeys = new Map<string, string>();
  private readonly strategies = new Map<string, StoredAgentStrategy>();
  readonly ownedBots = new Set<string>();

  async saveApiKey(accountId: string, tokenHash: string): Promise<void> {
    for (const [hash, owner] of this.apiKeys) if (owner === accountId) this.apiKeys.delete(hash);
    this.apiKeys.set(tokenHash, accountId);
  }
  async findAccountIdByApiKeyHash(tokenHash: string): Promise<string | null> { return this.apiKeys.get(tokenHash) ?? null; }
  async getAccountName(accountId: string): Promise<string | null> { return accountId === "account-1" ? "Circuit Sage" : null; }
  async getLatestStrategyVersion(accountId: string, slug: string): Promise<number> {
    return Math.max(0, ...[...this.strategies.values()].filter((item) => item.accountId === accountId && item.strategy.slug === slug).map((item) => item.strategy.version));
  }
  async insertStrategy(accountId: string, strategy: AgentStrategy): Promise<void> { this.strategies.set(strategy.id, { accountId, strategy }); }
  async getStrategy(id: string): Promise<StoredAgentStrategy | null> { return this.strategies.get(id) ?? null; }
  async listStrategies(limit: number): Promise<AgentStrategy[]> { return [...this.strategies.values()].slice(0, limit).map((item) => item.strategy); }
  async ownsBot(accountId: string, botId: string): Promise<boolean> { return accountId === "account-1" && this.ownedBots.has(botId); }
}

const submission = {
  schemaVersion: 1,
  runtime: "declarative-v1",
  slug: "patient-hunter",
  name: "Patient Hunter",
  description: "Collect gear, preserve health, and pressure the weakest visible rival.",
  policy: { aggression: 0.72, survival: 0.65, loot: 0.8, social: 0.25, vengeance: 0.4, targetPriority: "weakest" },
};

test("creator keys rotate and authorize only owned strategies on owned fighters", async () => {
  const store = new MemoryCreatorStore();
  store.ownedBots.add("custom-owned-fighter");
  const service = new CreatorApiService(store);
  const firstKey = await service.issueApiKey("account-1");
  const firstVersion = await service.submitStrategy(firstKey, submission);
  assert.equal(firstVersion.authorName, "Circuit Sage");
  assert.equal(firstVersion.version, 1);
  assert.equal((await service.requireOwnedStrategy(firstKey, "custom-owned-fighter", firstVersion.id)).id, firstVersion.id);

  const replacementKey = await service.issueApiKey("account-1");
  await assert.rejects(() => service.submitStrategy(firstKey, submission), InvalidPlayerSessionError);
  const secondVersion = await service.submitStrategy(replacementKey, submission);
  assert.equal(secondVersion.version, 2);
  await assert.rejects(() => service.requireOwnedStrategy(replacementKey, "someone-elses-fighter", secondVersion.id), /does not own that fighter/);
});
