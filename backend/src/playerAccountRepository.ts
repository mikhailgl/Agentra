import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePlayerState } from "../../frontend/src/game/player.js";
import type { FantasyLeaderboardEntry, PlayerState } from "../../frontend/src/game/types.js";

export type StoredPlayerAccount = {
  id: string;
  tokenHash: string;
  recoveryTokenHash: string;
  state: PlayerState;
  revision: number;
};

type PlayerAccountRow = {
  id: string;
  session_token_hash: string;
  recovery_token_hash: string;
  state: PlayerState;
  revision: number;
};

export interface PlayerAccountStore {
  findByTokenHash(tokenHash: string): Promise<StoredPlayerAccount | null>;
  findByRecoveryTokenHash(tokenHash: string): Promise<StoredPlayerAccount | null>;
  create(id: string, tokenHash: string, recoveryTokenHash: string, state: PlayerState): Promise<StoredPlayerAccount>;
  rotateSessionToken(id: string, tokenHash: string): Promise<StoredPlayerAccount>;
  rotateRecoveryToken(id: string, tokenHash: string): Promise<StoredPlayerAccount>;
  save(id: string, state: PlayerState, expectedRevision: number): Promise<StoredPlayerAccount | null>;
  listSettlementCandidates(matchId: string, winnerBotId?: string): Promise<StoredPlayerAccount[]>;
  listFantasyCandidates(botIds: string[]): Promise<StoredPlayerAccount[]>;
  listFantasyLeaderboard(seasonId: string, limit: number): Promise<FantasyLeaderboardEntry[]>;
  claimBot(accountId: string, botId: string): Promise<boolean>;
  releaseBot(accountId: string, botId: string): Promise<void>;
}

export class PlayerAccountRepository implements PlayerAccountStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async findByTokenHash(tokenHash: string): Promise<StoredPlayerAccount | null> {
    const response = await this.supabase
      .from("player_accounts")
      .select("id, session_token_hash, recovery_token_hash, state, revision")
      .eq("session_token_hash", tokenHash)
      .maybeSingle();
    if (response.error) throw response.error;
    return response.data ? fromRow(response.data as PlayerAccountRow) : null;
  }

  async findByRecoveryTokenHash(tokenHash: string): Promise<StoredPlayerAccount | null> {
    const response = await this.supabase
      .from("player_accounts")
      .select("id, session_token_hash, recovery_token_hash, state, revision")
      .eq("recovery_token_hash", tokenHash)
      .maybeSingle();
    if (response.error) throw response.error;
    return response.data ? fromRow(response.data as PlayerAccountRow) : null;
  }

  async create(id: string, tokenHash: string, recoveryTokenHash: string, state: PlayerState): Promise<StoredPlayerAccount> {
    const response = await this.supabase
      .from("player_accounts")
      .insert({ id, session_token_hash: tokenHash, recovery_token_hash: recoveryTokenHash, state, revision: 1 })
      .select("id, session_token_hash, recovery_token_hash, state, revision")
      .single();
    if (response.error) throw response.error;
    return fromRow(response.data as PlayerAccountRow);
  }

  async rotateSessionToken(id: string, tokenHash: string): Promise<StoredPlayerAccount> {
    const response = await this.supabase
      .from("player_accounts")
      .update({ session_token_hash: tokenHash, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, session_token_hash, recovery_token_hash, state, revision")
      .single();
    if (response.error) throw response.error;
    return fromRow(response.data as PlayerAccountRow);
  }

  async rotateRecoveryToken(id: string, tokenHash: string): Promise<StoredPlayerAccount> {
    const response = await this.supabase
      .from("player_accounts")
      .update({ recovery_token_hash: tokenHash, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, session_token_hash, recovery_token_hash, state, revision")
      .single();
    if (response.error) throw response.error;
    return fromRow(response.data as PlayerAccountRow);
  }

  async save(id: string, state: PlayerState, expectedRevision: number): Promise<StoredPlayerAccount | null> {
    const response = await this.supabase
      .from("player_accounts")
      .update({ state, revision: expectedRevision + 1, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("revision", expectedRevision)
      .select("id, session_token_hash, recovery_token_hash, state, revision")
      .maybeSingle();
    if (response.error) throw response.error;
    return response.data ? fromRow(response.data as PlayerAccountRow) : null;
  }

  async listSettlementCandidates(matchId: string, winnerBotId?: string): Promise<StoredPlayerAccount[]> {
    const ownerResponse = winnerBotId
      ? await this.supabase.from("bot_ownerships").select("account_id").eq("bot_id", winnerBotId).maybeSingle()
      : { data: null, error: null };
    if (ownerResponse.error) throw ownerResponse.error;
    const ownerId = ownerResponse.data?.account_id as string | undefined;
    const pendingRequest = this.supabase
      .from("player_accounts")
      .select("id, session_token_hash, recovery_token_hash, state, revision")
      // postgrest-js treats a JavaScript array as a PostgreSQL array. This
      // path points into JSONB, so serialize the JSON array explicitly.
      .contains("state->bets", JSON.stringify([{ matchId, status: "pending" }]));
    const [pendingResponse, ownerAccountResponse] = await Promise.all([
      pendingRequest,
      ownerId
        ? this.supabase.from("player_accounts").select("id, session_token_hash, recovery_token_hash, state, revision").eq("id", ownerId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (pendingResponse.error) throw pendingResponse.error;
    if (ownerAccountResponse.error) throw ownerAccountResponse.error;
    const rows = [...(pendingResponse.data ?? []), ...(ownerAccountResponse.data ? [ownerAccountResponse.data] : [])];
    const uniqueRows = new Map(rows.map((row) => [row.id as string, row as PlayerAccountRow]));
    return [...uniqueRows.values()].map(fromRow);
  }

  async claimBot(accountId: string, botId: string): Promise<boolean> {
    const response = await this.supabase.from("bot_ownerships").insert({ account_id: accountId, bot_id: botId });
    if (!response.error) return true;
    if (response.error.code === "23505") return false;
    throw response.error;
  }

  async listFantasyCandidates(botIds: string[]): Promise<StoredPlayerAccount[]> {
    if (botIds.length === 0) return [];
    const filters = botIds.map((botId) => `state->draftedBotIds.cs.${JSON.stringify([botId])}`).join(",");
    const response = await this.supabase
      .from("player_accounts")
      .select("id, session_token_hash, recovery_token_hash, state, revision")
      .or(filters);
    if (response.error) throw response.error;
    return (response.data ?? []).map((row) => fromRow(row as PlayerAccountRow));
  }

  async listFantasyLeaderboard(seasonId: string, limit: number): Promise<FantasyLeaderboardEntry[]> {
    const response = await this.supabase.rpc("get_fantasy_leaderboard", {
      p_season_id: seasonId,
      p_limit: Math.max(1, Math.min(100, Math.floor(limit))),
    });
    if (response.error) throw response.error;
    return (response.data ?? []).map((row: Record<string, unknown>) => ({
      accountId: String(row.account_id),
      accountName: String(row.account_name),
      points: Number(row.points),
      rosterSize: Number(row.roster_size),
    }));
  }

  async releaseBot(accountId: string, botId: string): Promise<void> {
    const response = await this.supabase.from("bot_ownerships").delete().eq("account_id", accountId).eq("bot_id", botId);
    if (response.error) throw response.error;
  }
}

function fromRow(row: PlayerAccountRow): StoredPlayerAccount {
  return { id: row.id, tokenHash: row.session_token_hash, recoveryTokenHash: row.recovery_token_hash, state: normalizePlayerState(row.state), revision: row.revision };
}
