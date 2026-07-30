import type { AgentPolicy, AgentStrategy } from "./types";

export type AgentStrategySubmission = Pick<AgentStrategy, "schemaVersion" | "runtime" | "slug" | "name" | "description" | "policy">;

export const AGENT_STRATEGY_SCHEMA_VERSION = 1 as const;
export const AGENT_STRATEGY_RUNTIME = "declarative-v1" as const;

export function normalizeAgentStrategySubmission(value: unknown): AgentStrategySubmission | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const slug = typeof input.slug === "string" ? input.slug.trim().toLowerCase() : "";
  const name = cleanText(input.name, 48);
  const description = cleanText(input.description, 240);
  const policy = normalizePolicy(input.policy);
  if (
    input.schemaVersion !== AGENT_STRATEGY_SCHEMA_VERSION ||
    input.runtime !== AGENT_STRATEGY_RUNTIME ||
    !/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug) ||
    name.length < 3 ||
    description.length < 10 ||
    !policy
  ) {
    return null;
  }
  return { schemaVersion: 1, runtime: AGENT_STRATEGY_RUNTIME, slug, name, description, policy };
}

export function getAgentPolicy(value: { agentStrategy?: AgentStrategy }): AgentPolicy | null {
  return value.agentStrategy?.schemaVersion === 1 && value.agentStrategy.runtime === AGENT_STRATEGY_RUNTIME
    ? value.agentStrategy.policy
    : null;
}

function normalizePolicy(value: unknown): AgentPolicy | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const numericKeys = ["aggression", "survival", "loot", "social", "vengeance"] as const;
  if (!numericKeys.every((key) => typeof input[key] === "number" && Number.isFinite(input[key]) && input[key] >= 0 && input[key] <= 1)) {
    return null;
  }
  const targetPriority = input.targetPriority;
  if (targetPriority !== "nearest" && targetPriority !== "weakest" && targetPriority !== "rival" && targetPriority !== "bounty") {
    return null;
  }
  return {
    aggression: input.aggression as number,
    survival: input.survival as number,
    loot: input.loot as number,
    social: input.social as number,
    vengeance: input.vengeance as number,
    targetPriority,
  };
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}
