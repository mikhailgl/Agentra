import { createHash, randomBytes, randomUUID } from "node:crypto";
import { normalizeAgentStrategySubmission } from "../../frontend/src/game/agentStrategy.js";
import type { AgentStrategy } from "../../frontend/src/game/types.js";
import type { CreatorApiStore } from "./creatorApiRepository.js";
import { InvalidPlayerSessionError, PlayerActionError } from "./playerService.js";

const API_KEY_PREFIX = "ba_live_";

export class CreatorApiService {
  constructor(private readonly store: CreatorApiStore) {}

  async issueApiKey(accountId: string): Promise<string> {
    const apiKey = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    await this.store.saveApiKey(accountId, hashToken(apiKey));
    return apiKey;
  }

  async submitStrategy(rawApiKey: string | undefined, value: unknown): Promise<AgentStrategy> {
    const accountId = await this.requireCreatorAccount(rawApiKey);
    const submission = normalizeAgentStrategySubmission(value);
    if (!submission) throw new PlayerActionError("Strategy must satisfy the declarative-v1 contract");
    const authorName = await this.store.getAccountName(accountId);
    if (!authorName) throw new InvalidPlayerSessionError();
    const version = await this.store.getLatestStrategyVersion(accountId, submission.slug) + 1;
    const strategy: AgentStrategy = { ...submission, id: randomUUID(), version, authorName, createdAt: Date.now() };
    await this.store.insertStrategy(accountId, strategy);
    return strategy;
  }

  listStrategies(limit = 50): Promise<AgentStrategy[]> {
    return this.store.listStrategies(limit);
  }

  async requireOwnedStrategy(rawApiKey: string | undefined, botId: string, strategyId: string): Promise<AgentStrategy> {
    const accountId = await this.requireCreatorAccount(rawApiKey);
    const [stored, ownsBot] = await Promise.all([this.store.getStrategy(strategyId), this.store.ownsBot(accountId, botId)]);
    if (!ownsBot) throw new PlayerActionError("The API key does not own that fighter");
    if (!stored || stored.accountId !== accountId) throw new PlayerActionError("The API key does not own that strategy");
    return stored.strategy;
  }

  private async requireCreatorAccount(rawApiKey: string | undefined): Promise<string> {
    if (!rawApiKey || !rawApiKey.startsWith(API_KEY_PREFIX) || rawApiKey.length < 40 || rawApiKey.length > 120) throw new InvalidPlayerSessionError();
    const accountId = await this.store.findAccountIdByApiKeyHash(hashToken(rawApiKey));
    if (!accountId) throw new InvalidPlayerSessionError();
    return accountId;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
