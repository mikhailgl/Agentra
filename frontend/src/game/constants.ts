import type { Personality, Weapon } from "./types";

export const MAP_SIZE = 1000;
export const MAP_CENTER = MAP_SIZE / 2;
export const BOT_COUNT = 12;
export const PERSISTENT_BOT_COUNT = 20;
export const LOOT_COUNT = 10;
export const LOOT_ZONE_RADIUS = 180;
export const SPAWN_RADIUS = 390;
export const BOT_RADIUS = 14;
export const LOOT_PICKUP_RADIUS = 24;
export const VISIBLE_ENEMY_RANGE = 360;
export const FLEE_ENEMY_RANGE = 150;
export const WANDER_TARGET_RADIUS = 120;
export const MAX_EVENTS = 18;
export const EVENT_DEBOUNCE_MS = 1800;
export const MEDKIT_HEAL = 35;
export const SPONSOR_DROP_RADIUS = 48;
export const CONTEST_ENTRY_FEE = 50;
export const SOCIAL_SCAN_RANGE = 240;
export const ALLIANCE_MIN_MS = 22_000;
export const ALLIANCE_MAX_MS = 42_000;

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
