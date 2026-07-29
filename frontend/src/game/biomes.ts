import { DEFAULT_MATCH_CONFIG, getArenaScale, resolveMatchConfig, type MatchConfigInput } from "./matchConfig";
import type { BiomeDefinition, BiomeType, MatchConfig, MapZone, Point } from "./types";

export const BIOMES: Record<BiomeType, BiomeDefinition> = {
  forest: {
    id: "forest",
    name: "Forest",
    description: "Low sight lines, thick cover, and strong stealth opportunities.",
    modifiers: { movementSpeed: 0.94, accuracy: -0.12, stealth: 0.18, visibility: -0.22, cover: 0.24, lootDensity: 0.95 },
  },
  open_field: {
    id: "open_field",
    name: "Open Field",
    description: "Long sight lines with little cover.",
    modifiers: { movementSpeed: 1.04, accuracy: 0.12, stealth: -0.18, visibility: 0.2, cover: -0.12, lootDensity: 0.85 },
  },
  ruins: {
    id: "ruins",
    name: "Ruins",
    description: "Broken structures with ambush angles and extra loot.",
    modifiers: { movementSpeed: 0.98, accuracy: -0.03, stealth: 0.08, visibility: -0.06, cover: 0.18, lootDensity: 1.35, ambushChance: 0.16 },
  },
  swamp: {
    id: "swamp",
    name: "Swamp",
    description: "Slow ground that punishes poor pathing.",
    modifiers: { movementSpeed: 0.76, accuracy: -0.06, stealth: 0.05, visibility: -0.1, staminaDrain: 0.18, cover: 0.08, lootDensity: 0.75 },
  },
  high_ground: {
    id: "high_ground",
    name: "High Ground",
    description: "Good visibility and strong ranged positions.",
    modifiers: { movementSpeed: 0.95, accuracy: 0.15, stealth: -0.05, visibility: 0.18, cover: 0.06, lootDensity: 0.9 },
  },
  industrial_yard: {
    id: "industrial_yard",
    name: "Industrial Yard",
    description: "Tools, traps, and noisy cover.",
    modifiers: { movementSpeed: 0.98, accuracy: 0.02, stealth: -0.04, visibility: 0.02, cover: 0.16, lootDensity: 1.25, ambushChance: 0.08 },
  },
  cave: {
    id: "cave",
    name: "Cave",
    description: "Close-range tunnel fighting with low visibility.",
    modifiers: { movementSpeed: 0.88, accuracy: -0.08, stealth: 0.12, visibility: -0.26, cover: 0.14, lootDensity: 0.95, ambushChance: 0.12 },
  },
};

export function createMapZones(configInput?: MatchConfigInput | MatchConfig): MapZone[] {
  const config = resolveMatchConfig(configInput);
  const scale = getArenaScale(config);
  return config.arena.zones.map((zone) => ({
    ...BIOMES[zone.biome],
    x: zone.x * scale,
    y: zone.y * scale,
    width: zone.width === undefined ? undefined : zone.width * scale,
    height: zone.height === undefined ? undefined : zone.height * scale,
    radius: zone.radius === undefined ? undefined : zone.radius * scale,
  }));
}

export function getBiomeAt(point: Point, zones: MapZone[]): MapZone {
  return zones.find((zone) => isInsideZone(point, zone)) ?? zones.find((zone) => zone.id === "open_field") ?? createMapZones()[1];
}

export function getBiomeName(id: BiomeType | undefined): string {
  return id ? BIOMES[id].name : "Unknown";
}

export function clampToMap(point: Point, config: MatchConfig = DEFAULT_MATCH_CONFIG): Point {
  return {
    x: Math.max(config.arena.edgePadding, Math.min(config.arena.size - config.arena.edgePadding, point.x)),
    y: Math.max(config.arena.edgePadding, Math.min(config.arena.size - config.arena.edgePadding, point.y)),
  };
}

function isInsideZone(point: Point, zone: MapZone): boolean {
  if (zone.radius) {
    const dx = point.x - zone.x;
    const dy = point.y - zone.y;
    return Math.sqrt(dx * dx + dy * dy) <= zone.radius;
  }
  return point.x >= zone.x && point.x <= zone.x + (zone.width ?? 0) && point.y >= zone.y && point.y <= zone.y + (zone.height ?? 0);
}
