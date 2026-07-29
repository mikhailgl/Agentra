import type { MatchConfig, MatchState } from "./types";

export type MatchConfigInput = Partial<{
  id: string;
  name: string;
  roster: Partial<MatchConfig["roster"]>;
  arena: Partial<MatchConfig["arena"]>;
  loot: Partial<MatchConfig["loot"]>;
  rules: Partial<MatchConfig["rules"]>;
  ai: Partial<MatchConfig["ai"]>;
  events: Partial<MatchConfig["events"]>;
}>;

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  id: "standard",
  name: "Standard Arena",
  roster: {
    matchBotCount: 12,
    persistentBotCount: 20,
  },
  arena: {
    size: 1000,
    zoneBaseSize: 1000,
    spawnRadius: 390,
    lootZoneRadius: 180,
    edgePadding: 18,
    zones: [
      { biome: "forest", x: 30, y: 40, width: 330, height: 330 },
      { biome: "open_field", x: 365, y: 65, width: 330, height: 300 },
      { biome: "high_ground", x: 705, y: 20, width: 255, height: 335 },
      { biome: "swamp", x: 45, y: 410, width: 315, height: 320 },
      { biome: "ruins", x: 390, y: 390, radius: 170 },
      { biome: "industrial_yard", x: 655, y: 390, width: 300, height: 285 },
      { biome: "cave", x: 330, y: 735, width: 360, height: 210 },
    ],
  },
  loot: {
    initialCount: 10,
    bonusInitialLoot: 5,
    pickupRadius: 24,
    sponsorDropRadius: 48,
  },
  rules: {
    winnersRemaining: 1,
    finalPhaseBotCount: 3,
    maxVisibleEvents: 18,
  },
  ai: {
    visibleEnemyRange: 360,
    fleeEnemyRange: 150,
    wanderTargetRadius: 120,
    socialScanRange: 240,
    allianceMinMs: 22_000,
    allianceMaxMs: 42_000,
  },
  events: {
    firstEventMinMs: 30_000,
    eventCooldownMs: 18_000,
    maxActiveArenaEvents: 2,
    narrativeLimit: 8,
    activeEventLimit: 8,
    dangerDamagePerSecond: 4.5,
    dangerZoneRadius: 145,
    monsterPackSize: 3,
    allowedArenaEvents: ["monster_spawn", "rare_loot_drop", "danger_zone", "bounty_target", "sudden_death"],
  },
};

export function resolveMatchConfig(input?: MatchConfigInput, base: MatchConfig = DEFAULT_MATCH_CONFIG): MatchConfig {
  return {
    id: input?.id ?? base.id,
    name: input?.name ?? base.name,
    roster: { ...base.roster, ...input?.roster },
    arena: {
      ...base.arena,
      ...input?.arena,
      zones: input?.arena?.zones ? cloneZones(input.arena.zones) : cloneZones(base.arena.zones),
    },
    loot: { ...base.loot, ...input?.loot },
    rules: { ...base.rules, ...input?.rules },
    ai: { ...base.ai, ...input?.ai },
    events: {
      ...base.events,
      ...input?.events,
      allowedArenaEvents: input?.events?.allowedArenaEvents ? [...input.events.allowedArenaEvents] : [...base.events.allowedArenaEvents],
    },
  };
}

export function getMatchConfig(match?: Pick<MatchState, "config"> | null): MatchConfig {
  return resolveMatchConfig(match?.config);
}

export function getArenaCenter(config: MatchConfig = DEFAULT_MATCH_CONFIG): number {
  return config.arena.size / 2;
}

export function getArenaScale(config: MatchConfig = DEFAULT_MATCH_CONFIG): number {
  return config.arena.size / config.arena.zoneBaseSize;
}

export function getQueueTargetSize(config: MatchConfig = DEFAULT_MATCH_CONFIG): number {
  return Math.max(config.roster.matchBotCount * 2, config.roster.persistentBotCount);
}

function cloneZones(zones: MatchConfig["arena"]["zones"]): MatchConfig["arena"]["zones"] {
  return zones.map((zone) => ({ ...zone }));
}
