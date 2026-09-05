import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { actionSchema } from "./provider.js";
import type { SurvivalWorld } from "../../../frontend/src/game/survival/types.js";

const point = {
  x: z.number().finite().min(0).max(24),
  z: z.number().finite().min(0).max(24),
};
const resource = z.object({
  ...point,
  id: z.string(),
  kind: z.enum(["tree", "rock", "bush"]),
  remaining: z.number().int().nonnegative(),
  regrowAt: z.number().nonnegative().nullable(),
});
const count = z.number().int().nonnegative();
const worldSchema = z.object({
  version: z.literal(1),
  size: z.literal(24),
  time: z.number().finite().nonnegative(),
  nextEvent: count,
  resources: z.array(resource).max(600),
  structures: z
    .array(
      z.object({
        ...point,
        id: z.string(),
        kind: z.enum(["wall", "shelter"]),
        builderId: z.string(),
      }),
    )
    .max(600),
  events: z
    .array(
      z.object({
        id: count,
        time: z.number(),
        botId: z.string(),
        model: z.string(),
        kind: z.enum(["action", "speech", "death"]),
        text: z.string(),
      }),
    )
    .max(150),
  bots: z
    .array(
      z.object({
        ...point,
        id: z.string(),
        name: z.string(),
        color: z.string(),
        disposition: z.string(),
        model: z.string(),
        health: z.number().min(0).max(100),
        hunger: z.number().min(0).max(100),
        inventory: z.object({
          wood: count,
          stone: count,
          berries: count,
          axe: count,
          shelter: count,
        }),
        plan: z.string(),
        decisions: count,
        memories: z
          .array(
            z.object({
              time: z.number(),
              source: z.enum(["result", "heard", "note"]),
              text: z.string(),
            }),
          )
          .max(48),
        knownResources: z.array(resource).max(600),
        task: z
          .object({
            action: actionSchema,
            path: z.array(z.object(point)).max(600),
            remaining: z.number(),
            model: z.string(),
          })
          .nullable(),
        speech: z.object({ message: z.string(), until: z.number() }).nullable(),
      }),
    )
    .length(4),
});
export const checkpointSchema = z.object({
  world: worldSchema,
  paused: z.boolean(),
  speed: z.number().min(0.25).max(8),
  decisions: count,
  inputTokens: count,
  outputTokens: count,
  savedAt: z.string(),
});
export type SurvivalCheckpoint = {
  world: SurvivalWorld;
  paused: boolean;
  speed: number;
  decisions: number;
  inputTokens: number;
  outputTokens: number;
  savedAt: string;
};
export interface SurvivalStore {
  load(): Promise<SurvivalCheckpoint | null>;
  save(checkpoint: SurvivalCheckpoint): Promise<void>;
}

export class SurvivalRepository implements SurvivalStore {
  constructor(private readonly supabase: SupabaseClient) {}
  async load(): Promise<SurvivalCheckpoint | null> {
    const { data, error } = await this.supabase
      .from("arena_states")
      .select("state")
      .eq("client_id", "survival-world-four")
      .abortSignal(AbortSignal.timeout(10_000))
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    // Invalid state is an error, never a reason to overwrite a saved world.
    return checkpointSchema.parse(data.state);
  }
  async save(checkpoint: SurvivalCheckpoint): Promise<void> {
    const { error } = await this.supabase
      .from("arena_states")
      .upsert({
        client_id: "survival-world-four",
        state: checkpoint,
        updated_at: checkpoint.savedAt,
      })
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) throw error;
  }
}
