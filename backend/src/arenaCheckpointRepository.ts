import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArenaCheckpoint } from "./arenaService.js";

const CANONICAL_ARENA_ID = "canonical-arena";

export class ArenaCheckpointRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async load(): Promise<ArenaCheckpoint | null> {
    const response = await this.supabase.from("arena_states").select("state").eq("client_id", CANONICAL_ARENA_ID).maybeSingle();
    if (response.error) {
      throw response.error;
    }

    return isArenaCheckpoint(response.data?.state) ? response.data.state : null;
  }

  async save(checkpoint: ArenaCheckpoint): Promise<void> {
    const response = await this.supabase.from("arena_states").upsert({
      client_id: CANONICAL_ARENA_ID,
      state: checkpoint,
      updated_at: new Date().toISOString(),
    });
    if (response.error) {
      throw response.error;
    }
  }
}

function isArenaCheckpoint(value: unknown): value is ArenaCheckpoint {
  if (!value || typeof value !== "object") {
    return false;
  }

  const checkpoint = value as Partial<ArenaCheckpoint>;
  return (
    checkpoint.version === 1 &&
    typeof checkpoint.matchNumber === "number" &&
    Boolean(checkpoint.match && typeof checkpoint.match === "object") &&
    Boolean(checkpoint.arenaState && typeof checkpoint.arenaState === "object") &&
    Array.isArray(checkpoint.arenaQueueIds) &&
    Array.isArray(checkpoint.basicResults) &&
    typeof checkpoint.savedAt === "number"
  );
}
