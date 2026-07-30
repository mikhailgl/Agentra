const TARGET_PRIORITIES = new Set(["nearest", "weakest", "rival", "bounty"]);
const POLICY_AXES = /** @type {const} */ (["aggression", "survival", "loot", "social", "vengeance"]);

/**
 * Validate and freeze a BotArena declarative strategy manifest.
 * External models may propose this data, but only this bounded policy reaches the arena.
 * @param {import('./index.d.ts').StrategyManifest} manifest
 */
export function defineStrategy(manifest) {
  if (!manifest || typeof manifest !== "object") throw new TypeError("A strategy manifest is required");
  if (manifest.schemaVersion !== 1 || manifest.runtime !== "declarative-v1") throw new TypeError("Use schemaVersion 1 and declarative-v1");
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(manifest.slug ?? "")) throw new TypeError("slug must be 3–40 lowercase letters, numbers, or dashes");
  if (typeof manifest.name !== "string" || manifest.name.trim().length < 3 || manifest.name.trim().length > 48) throw new TypeError("name must be 3–48 characters");
  if (typeof manifest.description !== "string" || manifest.description.trim().length < 10 || manifest.description.trim().length > 240) throw new TypeError("description must be 10–240 characters");
  if (!manifest.policy || !TARGET_PRIORITIES.has(manifest.policy.targetPriority)) throw new TypeError("targetPriority is invalid");
  for (const axis of POLICY_AXES) {
    const value = manifest.policy[axis];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new TypeError(`${axis} must be between 0 and 1`);
  }
  return Object.freeze({
    schemaVersion: 1,
    runtime: "declarative-v1",
    slug: manifest.slug,
    name: manifest.name.trim(),
    description: manifest.description.trim(),
    policy: Object.freeze({ ...manifest.policy }),
  });
}

/** @param {{baseUrl: string, apiKey?: string, fetch?: typeof globalThis.fetch}} options */
export function createBotArenaClient(options) {
  const baseUrl = options.baseUrl?.replace(/\/$/, "");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!baseUrl || typeof fetchImpl !== "function") throw new TypeError("baseUrl and fetch are required");

  /** @param {string} path @param {RequestInit} [init] */
  const request = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (init.body) headers.set("content-type", "application/json");
    if (options.apiKey) headers.set("authorization", `Bearer ${options.apiKey}`);
    const response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new BotArenaApiError(typeof body.error === "string" ? body.error : `BotArena request failed (${response.status})`, response.status);
    return body;
  };

  return Object.freeze({
    getSpec: () => request("/api/agent/v1/spec"),
    listStrategies: (limit = 50) => request(`/api/agent/v1/strategies?limit=${encodeURIComponent(String(limit))}`),
    submitStrategy: (/** @type {import('./index.d.ts').StrategyManifest} */ manifest) => request("/api/agent/v1/strategies", { method: "POST", body: JSON.stringify(defineStrategy(manifest)) }),
    attachStrategy: (/** @type {string} */ fighterId, /** @type {string} */ strategyId) => request(`/api/agent/v1/fighters/${encodeURIComponent(fighterId)}/strategy/${encodeURIComponent(strategyId)}`, { method: "PUT" }),
  });
}

export class BotArenaApiError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.name = "BotArenaApiError";
    this.status = status;
  }
}
