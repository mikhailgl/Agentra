import type { SupabaseClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;

export type GameStatePayload = {
  persistentBots?: unknown[];
  playerState?: JsonRecord;
  arenaState?: JsonRecord | null;
  arenaQueueIds?: string[];
  basicResults?: unknown[];
};

function assertClientId(clientId: string): string {
  const trimmed = clientId.trim();
  if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(trimmed)) {
    throw new Error("Invalid client id");
  }
  return trimmed;
}

function normalizePayload(payload: unknown): GameStatePayload {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const input = payload as GameStatePayload;
  const next: GameStatePayload = {};

  if (Array.isArray(input.persistentBots)) next.persistentBots = input.persistentBots;
  if (input.playerState && typeof input.playerState === "object" && !Array.isArray(input.playerState)) next.playerState = input.playerState;
  if (input.arenaState === null || (input.arenaState && typeof input.arenaState === "object" && !Array.isArray(input.arenaState))) next.arenaState = input.arenaState;
  if (Array.isArray(input.arenaQueueIds)) next.arenaQueueIds = input.arenaQueueIds.filter((id): id is string => typeof id === "string").slice(0, 100);
  if (Array.isArray(input.basicResults)) next.basicResults = input.basicResults.slice(0, 20);

  return next;
}

export class GameStateRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async load(clientId: string): Promise<GameStatePayload> {
    const id = assertClientId(clientId);
    const [bots, player, arena, queue, results] = await Promise.all([
      this.supabase.from("bot_pools").select("bots").eq("client_id", id).maybeSingle(),
      this.supabase.from("player_states").select("state").eq("client_id", id).maybeSingle(),
      this.supabase.from("arena_states").select("state").eq("client_id", id).maybeSingle(),
      this.supabase.from("arena_queues").select("queue_ids").eq("client_id", id).maybeSingle(),
      this.supabase.from("match_results").select("result").eq("client_id", id).order("match_number", { ascending: false }).limit(10),
    ]);

    for (const response of [bots, player, arena, queue, results]) {
      if (response.error) {
        throw response.error;
      }
    }

    return {
      persistentBots: Array.isArray(bots.data?.bots) ? bots.data.bots : undefined,
      playerState: (player.data?.state as JsonRecord | undefined) ?? undefined,
      arenaState: (arena.data?.state as JsonRecord | undefined) ?? undefined,
      arenaQueueIds: Array.isArray(queue.data?.queue_ids) ? queue.data.queue_ids : undefined,
      basicResults: results.data?.map((row) => row.result) ?? undefined,
    };
  }

  async save(clientId: string, rawPayload: unknown): Promise<GameStatePayload> {
    const id = assertClientId(clientId);
    const payload = normalizePayload(rawPayload);
    const writes: PromiseLike<unknown>[] = [];

    if (payload.persistentBots) {
      writes.push(this.supabase.from("bot_pools").upsert({ client_id: id, bots: payload.persistentBots, updated_at: new Date().toISOString() }));
    }

    if (payload.playerState) {
      writes.push(this.supabase.from("player_states").upsert({ client_id: id, state: payload.playerState, updated_at: new Date().toISOString() }));
    }

    if (payload.arenaState !== undefined) {
      writes.push(this.supabase.from("arena_states").upsert({ client_id: id, state: payload.arenaState, updated_at: new Date().toISOString() }));
    }

    if (payload.arenaQueueIds) {
      writes.push(this.supabase.from("arena_queues").upsert({ client_id: id, queue_ids: payload.arenaQueueIds, updated_at: new Date().toISOString() }));
    }

    if (payload.basicResults) {
      for (const result of payload.basicResults) {
        if (!result || typeof result !== "object" || typeof (result as { matchNumber?: unknown }).matchNumber !== "number") {
          continue;
        }
        writes.push(
          this.supabase.from("match_results").upsert({
            client_id: id,
            match_number: (result as { matchNumber: number }).matchNumber,
            result,
          }),
        );
      }
    }

    const responses = await Promise.all(writes);
    for (const response of responses) {
      const maybeError = response as { error?: Error | null };
      if (maybeError.error) {
        throw maybeError.error;
      }
    }

    return this.load(id);
  }
}
