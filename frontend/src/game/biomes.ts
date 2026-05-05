import { MAP_SIZE } from "./constants";
import type { BiomeDefinition, BiomeType, MapZone, Point } from "./types";

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

export function createMapZones(): MapZone[] {
  return [
    { ...BIOMES.forest, x: 30, y: 40, width: 330, height: 330 },
    { ...BIOMES.open_field, x: 365, y: 65, width: 330, height: 300 },
    { ...BIOMES.high_ground, x: 705, y: 20, width: 255, height: 335 },
    { ...BIOMES.swamp, x: 45, y: 410, width: 315, height: 320 },
    { ...BIOMES.ruins, x: 390, y: 390, radius: 170 },
    { ...BIOMES.industrial_yard, x: 655, y: 390, width: 300, height: 285 },
    { ...BIOMES.cave, x: 330, y: 735, width: 360, height: 210 },
  ];
}

export function getBiomeAt(point: Point, zones: MapZone[]): MapZone {
  return zones.find((zone) => isInsideZone(point, zone)) ?? zones.find((zone) => zone.id === "open_field") ?? createMapZones()[1];
}

export function getBiomeName(id: BiomeType | undefined): string {
  return id ? BIOMES[id].name : "Unknown";
}

export function clampToMap(point: Point): Point {
  return {
    x: Math.max(18, Math.min(MAP_SIZE - 18, point.x)),
    y: Math.max(18, Math.min(MAP_SIZE - 18, point.y)),
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
