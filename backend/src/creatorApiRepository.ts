import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentStrategy } from "../../frontend/src/game/types.js";

export type StoredAgentStrategy = { accountId: string; strategy: AgentStrategy };

export interface CreatorApiStore {
  saveApiKey(accountId: string, tokenHash: string): Promise<void>;
  findAccountIdByApiKeyHash(tokenHash: string): Promise<string | null>;
  getAccountName(accountId: string): Promise<string | null>;
  getLatestStrategyVersion(accountId: string, slug: string): Promise<number>;
  insertStrategy(accountId: string, strategy: AgentStrategy): Promise<void>;
  getStrategy(id: string): Promise<StoredAgentStrategy | null>;
  listStrategies(limit: number): Promise<AgentStrategy[]>;
  ownsBot(accountId: string, botId: string): Promise<boolean>;
}

export class CreatorApiRepository implements CreatorApiStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async saveApiKey(accountId: string, tokenHash: string): Promise<void> {
    const response = await this.supabase.from("creator_api_keys").upsert(
      { account_id: accountId, token_hash: tokenHash, created_at: new Date().toISOString() },
      { onConflict: "account_id" },
    );
    if (response.error) throw response.error;
  }

  async findAccountIdByApiKeyHash(tokenHash: string): Promise<string | null> {
    const response = await this.supabase.from("creator_api_keys").select("account_id").eq("token_hash", tokenHash).maybeSingle();
    if (response.error) throw response.error;
    return response.data ? String(response.data.account_id) : null;
  }

  async getAccountName(accountId: string): Promise<string | null> {
    const response = await this.supabase.from("player_accounts").select("state").eq("id", accountId).maybeSingle();
    if (response.error) throw response.error;
    const state = response.data?.state as { accountName?: unknown } | undefined;
    return typeof state?.accountName === "string" ? state.accountName : null;
  }

  async getLatestStrategyVersion(accountId: string, slug: string): Promise<number> {
    const response = await this.supabase
      .from("agent_strategies")
      .select("version")
      .eq("account_id", accountId)
      .eq("slug", slug)
      .order("version", { ascending: false })
      .limit(1);
    if (response.error) throw response.error;
    return Number(response.data?.[0]?.version ?? 0);
  }

  async insertStrategy(accountId: string, strategy: AgentStrategy): Promise<void> {
    const response = await this.supabase.from("agent_strategies").insert({
      id: strategy.id,
      account_id: accountId,
      slug: strategy.slug,
      version: strategy.version,
      strategy,
      created_at: new Date(strategy.createdAt).toISOString(),
    });
    if (response.error) throw response.error;
  }

  async getStrategy(id: string): Promise<StoredAgentStrategy | null> {
    const response = await this.supabase.from("agent_strategies").select("account_id, strategy").eq("id", id).maybeSingle();
    if (response.error) throw response.error;
    return response.data ? { accountId: String(response.data.account_id), strategy: response.data.strategy as AgentStrategy } : null;
  }

  async listStrategies(limit: number): Promise<AgentStrategy[]> {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 50;
    const response = await this.supabase
      .from("agent_strategies")
      .select("strategy")
      .order("created_at", { ascending: false })
      .limit(normalizedLimit);
    if (response.error) throw response.error;
    return (response.data ?? []).map((row) => row.strategy as AgentStrategy);
  }

  async ownsBot(accountId: string, botId: string): Promise<boolean> {
    const response = await this.supabase.from("bot_ownerships").select("bot_id").eq("account_id", accountId).eq("bot_id", botId).maybeSingle();
    if (response.error) throw response.error;
    return Boolean(response.data);
  }
}
