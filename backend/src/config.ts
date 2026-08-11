import "dotenv/config";
import type { AgentRuntimeMode } from "./agentRuntime.js";

export type AppConfig = {
  port: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  corsOrigins: string[];
  corsOriginSuffixes: string[];
  agentRuntimeMode: AgentRuntimeMode;
};

export function getConfig(): AppConfig {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required");
  }

  if (!supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }

  return {
    port: Number(process.env.PORT ?? 4000),
    supabaseUrl,
    supabaseServiceRoleKey,
    corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    corsOriginSuffixes: (process.env.CORS_ORIGIN_SUFFIXES ?? "")
      .split(",")
      .map((suffix) => suffix.trim())
      .filter(Boolean),
    agentRuntimeMode: parseAgentRuntimeMode(process.env.AGENT_RUNTIME),
  };
}

function parseAgentRuntimeMode(value: string | undefined): AgentRuntimeMode {
  if (!value || value === "legacy") return "legacy";
  if (value === "autonomous-fake") return value;
  throw new Error(`AGENT_RUNTIME must be legacy or autonomous-fake, received ${value}`);
}
