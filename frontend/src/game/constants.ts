import type { Personality, Weapon } from "./types";
import { DEFAULT_MATCH_CONFIG, getArenaCenter } from "./matchConfig";

export const MAP_SIZE = DEFAULT_MATCH_CONFIG.arena.size;
export const MAP_CENTER = getArenaCenter(DEFAULT_MATCH_CONFIG);
export const BOT_COUNT = DEFAULT_MATCH_CONFIG.roster.matchBotCount;
export const PERSISTENT_BOT_COUNT = DEFAULT_MATCH_CONFIG.roster.persistentBotCount;
export const LOOT_COUNT = DEFAULT_MATCH_CONFIG.loot.initialCount;
export const LOOT_ZONE_RADIUS = DEFAULT_MATCH_CONFIG.arena.lootZoneRadius;
export const SPAWN_RADIUS = DEFAULT_MATCH_CONFIG.arena.spawnRadius;
export const BOT_RADIUS = 14;
export const LOOT_PICKUP_RADIUS = DEFAULT_MATCH_CONFIG.loot.pickupRadius;
export const VISIBLE_ENEMY_RANGE = DEFAULT_MATCH_CONFIG.ai.visibleEnemyRange;
export const FLEE_ENEMY_RANGE = DEFAULT_MATCH_CONFIG.ai.fleeEnemyRange;
export const WANDER_TARGET_RADIUS = DEFAULT_MATCH_CONFIG.ai.wanderTargetRadius;
export const MAX_EVENTS = DEFAULT_MATCH_CONFIG.rules.maxVisibleEvents;
export const EVENT_DEBOUNCE_MS = 1800;
export const MEDKIT_HEAL = 35;
export const SPONSOR_DROP_RADIUS = DEFAULT_MATCH_CONFIG.loot.sponsorDropRadius;
export const CONTEST_ENTRY_FEE = 25;
export const SOCIAL_SCAN_RANGE = DEFAULT_MATCH_CONFIG.ai.socialScanRange;
export const ALLIANCE_MIN_MS = DEFAULT_MATCH_CONFIG.ai.allianceMinMs;
export const ALLIANCE_MAX_MS = DEFAULT_MATCH_CONFIG.ai.allianceMaxMs;

export const WEAPONS: Weapon[] = [
  { name: "Knife", damage: 10, range: 42, cooldownMs: 420, accuracy: 0.86 },
  { name: "Spear", damage: 16, range: 88, cooldownMs: 750, accuracy: 0.8 },
  { name: "Bow", damage: 13, range: 210, cooldownMs: 980, accuracy: 0.74, preferredBiomes: ["forest", "high_ground"] },
  { name: "Axe", damage: 24, range: 52, cooldownMs: 1050, accuracy: 0.68 },
];

export const PERSONALITIES: Personality[] = [
  "Berserker",
  "Coward",
  "Scavenger",
  "Hunter",
  "Survivor",
];

export const BOT_NAMES = [
  "Ada",
  "Turing",
  "Grace",
  "Dijkstra",
  "Hopper",
  "Knuth",
  "Lovelace",
  "Minsky",
  "Noether",
  "Shannon",
  "Von",
  "Wirth",
  "Curie",
  "Tesla",
  "Franklin",
  "Lamarr",
  "Kepler",
  "Euclid",
  "Fermi",
  "Bohr",
];
