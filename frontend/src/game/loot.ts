import { MEDKIT_HEAL, WEAPONS } from "./constants";
import { getBiomeAt } from "./biomes";
import { randomPointInCircle } from "./math";
import { pickOne } from "./random";
import type { BiomeType, EquipmentItem, LootItem, MapZone, Weapon } from "./types";

type LootTemplate =
  | { name: string; type: "weapon"; rarity: LootItem["rarity"]; preferredBiomes?: BiomeType[]; weapon: Weapon }
  | { name: string; type: "medkit"; rarity: LootItem["rarity"]; preferredBiomes?: BiomeType[]; healing: number }
  | { name: string; type: "armor" | "tool"; rarity: LootItem["rarity"]; preferredBiomes?: BiomeType[]; effects: EquipmentItem["effects"] };

const LOOT_TEMPLATES: LootTemplate[] = [
  { name: "Rusted Blade", type: "weapon", rarity: "common", weapon: { name: "Rusted Blade", damage: 11, range: 42, cooldownMs: 430, accuracy: 0.8 } },
  { name: "Hunting Bow", type: "weapon", rarity: "uncommon", preferredBiomes: ["forest", "high_ground"], weapon: { name: "Hunting Bow", damage: 14, range: 230, cooldownMs: 980, accuracy: 0.76, preferredBiomes: ["forest", "high_ground"] } },
  { name: "Scoped Rifle", type: "weapon", rarity: "rare", preferredBiomes: ["open_field", "high_ground"], weapon: { name: "Scoped Rifle", damage: 24, range: 335, cooldownMs: 1350, accuracy: 0.72, preferredBiomes: ["open_field", "high_ground"] } },
  { name: "Trap Kit", type: "tool", rarity: "uncommon", preferredBiomes: ["ruins", "industrial_yard"], effects: { trapPower: 0.22, accuracy: 0.03 } },
  { name: "Smoke Bomb", type: "tool", rarity: "common", effects: { stealth: 0.18, speed: 0.05 } },
  { name: "Camouflage Cloak", type: "tool", rarity: "rare", preferredBiomes: ["forest"], effects: { stealth: 0.28, speed: 0.03 } },
  { name: "Light Armor", type: "armor", rarity: "common", effects: { defense: 0.12 } },
  { name: "Heavy Vest", type: "armor", rarity: "uncommon", effects: { defense: 0.24, speed: -0.08 } },
  { name: "Med Kit", type: "medkit", rarity: "common", healing: MEDKIT_HEAL },
];

export function createRandomLoot(id: string, x: number, y: number, zones: MapZone[], rng: () => number): LootItem {
  const biome = getBiomeAt({ x, y }, zones);
  const weighted = LOOT_TEMPLATES.flatMap((template) => {
    const rarityWeight = template.rarity === "legendary" ? 1 : template.rarity === "rare" ? 2 : template.rarity === "uncommon" ? 4 : 7;
    const biomeWeight = template.preferredBiomes?.includes(biome.id) ? 4 : 1;
    return Array.from({ length: Math.max(1, Math.round(rarityWeight * biomeWeight * (biome.modifiers.lootDensity ?? 1))) }, () => template);
  });
  return createLootFromTemplate(id, x, y, pickOne(weighted, rng));
}

export function createLootFromTemplate(id: string, x: number, y: number, template: LootTemplate): LootItem {
  if (template.type === "weapon") {
    return {
      id,
      x,
      y,
      type: "weapon",
      name: template.name,
      category: "weapon",
      rarity: template.rarity,
      preferredBiomes: template.preferredBiomes,
      effects: { damage: template.weapon.damage, accuracy: template.weapon.accuracy, range: template.weapon.range },
      weapon: template.weapon,
    };
  }

  if (template.type === "medkit") {
    return {
      id,
      x,
      y,
      type: "medkit",
      name: template.name,
      category: "consumable",
      rarity: template.rarity,
      preferredBiomes: template.preferredBiomes,
      effects: { healing: template.healing },
      healAmount: template.healing,
    };
  }

  const item: EquipmentItem = {
    id,
    name: template.name,
    category: template.type,
    rarity: template.rarity,
    preferredBiomes: template.preferredBiomes,
    effects: template.effects,
  };
  if (template.type === "armor") {
    return {
      id,
      x,
      y,
      type: "armor",
      name: template.name,
      category: "armor",
      rarity: template.rarity,
      preferredBiomes: template.preferredBiomes,
      effects: template.effects,
      item,
    };
  }

  return {
    id,
    x,
    y,
    type: "tool",
    name: template.name,
    category: "tool",
    rarity: template.rarity,
    preferredBiomes: template.preferredBiomes,
    effects: template.effects,
    item,
  };
}

export function createInitialLoot(count: number, center: { x: number; y: number }, radius: number, zones: MapZone[], rng: () => number): LootItem[] {
  return Array.from({ length: count }, (_, index) => {
    const point = randomPointInCircle(center, radius, rng);
    return createRandomLoot(`loot-${index + 1}`, point.x, point.y, zones, rng);
  });
}

export function createLegacyWeaponLoot(id: string, x: number, y: number, weaponName: string): LootItem {
  const weapon = WEAPONS.find((candidate) => candidate.name === weaponName) ?? WEAPONS[0];
  return {
    id,
    x,
    y,
    type: "weapon",
    name: weapon.name,
    category: "weapon",
    rarity: "common",
    effects: { damage: weapon.damage, range: weapon.range, accuracy: weapon.accuracy },
    weapon,
  };
}
