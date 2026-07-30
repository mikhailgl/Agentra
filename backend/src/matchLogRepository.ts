import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchLog } from "../../frontend/src/game/types.js";

const CANONICAL_ARENA_ID = "canonical-arena";
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export class MatchLogRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async saveCanonical(log: MatchLog): Promise<void> {
    await this.save(CANONICAL_ARENA_ID, log);
  }

  async save(clientId: string, log: MatchLog): Promise<void> {
    const response = await this.supabase.from("match_logs").upsert({
      client_id: clientId,
      match_number: log.matchNumber,
      match_id: log.matchId,
      log,
      created_at: new Date(log.endedAt).toISOString(),
    });
    if (response.error) {
      throw response.error;
    }
  }

  async listCanonical(limit: number): Promise<MatchLog[]> {
    const response = await this.supabase
      .from("match_logs")
      .select("log")
      .eq("client_id", CANONICAL_ARENA_ID)
      .order("match_number", { ascending: false })
      .limit(normalizeLimit(limit));

    if (response.error) {
      throw response.error;
    }

    return response.data?.map((row) => row.log).filter(isMatchLog) ?? [];
  }

  async getCanonical(matchNumber: number): Promise<MatchLog | null> {
    const response = await this.supabase
      .from("match_logs")
      .select("log")
      .eq("client_id", CANONICAL_ARENA_ID)
      .eq("match_number", matchNumber)
      .maybeSingle();
    if (response.error) throw response.error;
    return isMatchLog(response.data?.log) ? response.data.log : null;
  }
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function isMatchLog(value: unknown): value is MatchLog {
  if (!value || typeof value !== "object") {
    return false;
  }

  const log = value as Partial<MatchLog>;
  return (
    log.version === 1 &&
    typeof log.matchId === "string" &&
    typeof log.matchNumber === "number" &&
    Array.isArray(log.entrants) &&
    Array.isArray(log.botResults) &&
    Array.isArray(log.events) &&
    Array.isArray(log.highlights)
  );
}
