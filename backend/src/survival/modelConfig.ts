import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  AnthropicProvider,
  ChatCompletionsProvider,
  OpenAIProvider,
  type SurvivalProvider,
} from "./provider.js";

const actorSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("openai"),
      model: z.string().min(1),
      reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
    })
    .strict(),
  z
    .object({ provider: z.literal("anthropic"), model: z.string().min(1) })
    .strict(),
  z
    .object({
      provider: z.literal("chat-completions"),
      model: z.string().min(1),
      baseURL: z.url(),
      apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    })
    .strict(),
]);
export const actorsSchema = z
  .object({ moss: actorSchema, ember: actorSchema })
  .strict();
export type ActorControllers = Record<
  "moss" | "ember",
  { model: string; provider: SurvivalProvider | null }
>;

export function createActorControllers(
  config: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ActorControllers {
  const actors = actorsSchema.parse(config);
  const result = {} as ActorControllers;
  for (const id of ["moss", "ember"] as const) {
    const actor = actors[id];
    const keyName =
      actor.provider === "openai"
        ? "OPENAI_API_KEY"
        : actor.provider === "anthropic"
          ? "ANTHROPIC_API_KEY"
          : actor.apiKeyEnv;
    const key = env[keyName]?.trim();
    const provider = !key
      ? null
      : actor.provider === "openai"
        ? new OpenAIProvider(key, actor.model, actor.reasoningEffort)
        : actor.provider === "anthropic"
          ? new AnthropicProvider(key, actor.model)
          : new ChatCompletionsProvider(key, actor.model, actor.baseURL);
    result[id] = { model: actor.model, provider };
  }
  return result;
}

export function loadActorControllers(): ActorControllers {
  return createActorControllers(
    JSON.parse(
      readFileSync(
        new URL("../../survival.models.json", import.meta.url),
        "utf8",
      ),
    ),
  );
}
