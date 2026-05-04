export type CameraMode = "orbit" | "follow" | "auto";

export type ArenaBotView = {
  id: string;
  name: string;
  position: [number, number, number];
  rotationY: number;
  health: number;
  alive: boolean;
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
  type: "weapon" | "medkit" | "armor" | "tool";
  rarity: "common" | "uncommon" | "rare" | "legendary";
  position: [number, number, number];
};

export type ArenaEventView = {
  id: number;
  kind: string;
  message: string;
  label?: string;
  position?: [number, number, number];
  from?: [number, number, number];
  to?: [number, number, number];
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
  events: ArenaEventView[];
  zones: ArenaZoneView[];
  aliveCount: number;
  elapsedMs: number;
  ended: boolean;
  winnerId: string | null;
};
