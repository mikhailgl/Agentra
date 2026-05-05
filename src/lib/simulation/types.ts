export type CameraMode = "free" | "follow_bot" | "follow_action" | "follow_leader";

export type ArenaBotView = {
  id: string;
  name: string;
  position: [number, number, number];
  rotationY: number;
  health: number;
  alive: boolean;
  kills: number;
  damageDealt: number;
  survivalTimeMs: number;
  color: string;
  behavior: "seeking_loot" | "attacking" | "fleeing" | "wandering";
  level: number;
  traits: string[];
  weaponName: string;
  isDrafted: boolean;
  isBetOn: boolean;
  isSelected: boolean;
  isNudged: boolean;
  isWinner: boolean;
  targetPosition?: [number, number, number];
};

export type ArenaLootView = {
  id: string;
  name: string;
  type: "weapon" | "medkit" | "armor" | "tool" | "credits";
  rarity: "common" | "uncommon" | "rare" | "legendary";
  position: [number, number, number];
};

export type ArenaCreatureView = {
  id: string;
  name: string;
  position: [number, number, number];
  health: number;
  targetPosition?: [number, number, number];
};

export type ArenaEventView = {
  id: number;
  kind: string;
  message: string;
  label?: string;
  position?: [number, number, number];
  from?: [number, number, number];
  to?: [number, number, number];
  severity?: "minor" | "major" | "critical";
  eventType?: string;
};

export type ArenaMarkerView = {
  id: string;
  type: string;
  title: string;
  description: string;
  position?: [number, number, number];
  severity?: "minor" | "major" | "critical";
  radius?: number;
};

export type ArenaZoneView = {
  id: string;
  name: string;
  position: [number, number, number];
  size: [number, number];
  color: string;
};

export type ArenaViewModel = {
  bots: ArenaBotView[];
  loot: ArenaLootView[];
  creatures: ArenaCreatureView[];
  events: ArenaEventView[];
  arenaEvents: ArenaMarkerView[];
  zones: ArenaZoneView[];
  aliveCount: number;
  elapsedMs: number;
  ended: boolean;
  winnerId: string | null;
};
