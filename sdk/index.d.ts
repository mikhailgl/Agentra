export type TargetPriority = "nearest" | "weakest" | "rival" | "bounty";
export type StrategyPolicy = {
  aggression: number;
  survival: number;
  loot: number;
  social: number;
  vengeance: number;
  targetPriority: TargetPriority;
};
export type StrategyManifest = {
  schemaVersion: 1;
  runtime: "declarative-v1";
  slug: string;
  name: string;
  description: string;
  policy: StrategyPolicy;
};
export type PublishedStrategy = StrategyManifest & { id: string; version: number; authorName: string; createdAt: number };
export type BotArenaClient = {
  getSpec(): Promise<Record<string, unknown>>;
  listStrategies(limit?: number): Promise<{ strategies: PublishedStrategy[] }>;
  submitStrategy(manifest: StrategyManifest): Promise<{ strategy: PublishedStrategy }>;
  attachStrategy(fighterId: string, strategyId: string): Promise<{ fighterId: string; strategy: PublishedStrategy; snapshot: unknown }>;
};
export declare function defineStrategy(manifest: StrategyManifest): Readonly<StrategyManifest>;
export declare function createBotArenaClient(options: { baseUrl: string; apiKey?: string; fetch?: typeof globalThis.fetch }): BotArenaClient;
export declare class BotArenaApiError extends Error { status: number; constructor(message: string, status: number); }
