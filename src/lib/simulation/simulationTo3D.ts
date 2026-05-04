import { MAP_CENTER, MAP_SIZE } from "../../game/constants";
import type { Bet, Bot, GameEvent, LootItem, MapZone, MatchState } from "../../game/types";
import type { ArenaBotView, ArenaEventView, ArenaLootView, ArenaViewModel, ArenaZoneView } from "./types";

const ARENA_SCALE = 0.06;
const HALF_MAP = MAP_SIZE / 2;

const PERSONALITY_COLORS: Record<Bot["personality"], string> = {
  Berserker: "#ef4444",
  Coward: "#60a5fa",
  Scavenger: "#f59e0b",
  Hunter: "#22c55e",
  Survivor: "#a78bfa",
};

const ZONE_COLORS: Record<string, string> = {
  forest: "#214c32",
  open_field: "#465a31",
  ruins: "#53545a",
  swamp: "#29484a",
  high_ground: "#665437",
  industrial_yard: "#403f46",
  cave: "#24232b",
};

export function toArenaViewModel(
  match: MatchState,
  selectedBotId: string | null,
  draftedBotIds: string[],
  bets: Bet[],
): ArenaViewModel {
  const livingBets = new Set(
    bets.filter((bet) => bet.matchId === match.id && bet.status === "pending").map((bet) => bet.botId),
  );

  return {
    bots: match.bots.map((bot) => toArenaBot(bot, match, selectedBotId, draftedBotIds, livingBets)),
    loot: match.loot.map(toArenaLoot),
    events: match.events.map((event) => toArenaEvent(event, match)).filter(Boolean) as ArenaEventView[],
    zones: match.zones.map(toArenaZone),
    aliveCount: match.bots.filter((bot) => bot.alive).length,
    elapsedMs: match.elapsedMs,
    ended: match.ended,
    winnerId: match.winnerId,
  };
}

export function worldToArenaPoint(x: number, y: number, height = 0): [number, number, number] {
  return [(x - HALF_MAP) * ARENA_SCALE, height, (y - HALF_MAP) * ARENA_SCALE];
}

function toArenaBot(
  bot: Bot,
  match: MatchState,
  selectedBotId: string | null,
  draftedBotIds: string[],
  livingBets: Set<string>,
): ArenaBotView {
  const target = findBotTarget(bot, match);
  const dx = target ? target.x - bot.x : bot.wanderTarget ? bot.wanderTarget.x - bot.x : 0;
  const dy = target ? target.y - bot.y : bot.wanderTarget ? bot.wanderTarget.y - bot.y : 1;

  return {
    id: bot.id,
    name: bot.name,
    position: worldToArenaPoint(bot.x, bot.y),
    rotationY: Math.atan2(dx, dy),
    health: bot.health,
    alive: bot.alive,
    color: PERSONALITY_COLORS[bot.personality],
    behavior: bot.behavior,
    level: bot.level,
    traits: bot.traits,
    weaponName: bot.inventory.weapon?.name ?? "Unarmed",
    isDrafted: draftedBotIds.includes(bot.id),
    isBetOn: livingBets.has(bot.id),
    isSelected: selectedBotId === bot.id,
    isNudged: bot.activeInfluences.some((influence) => influence.expiresAtMs > match.elapsedMs),
    isWinner: match.winnerId === bot.id,
    targetPosition: target ? worldToArenaPoint(target.x, target.y) : undefined,
  };
}

function findBotTarget(bot: Bot, match: MatchState): Bot | null {
  const latestTargetId = match.events.find((event) => event.botId === bot.id && event.targetId)?.targetId;
  return latestTargetId ? match.bots.find((candidate) => candidate.id === latestTargetId) ?? null : null;
}

function toArenaLoot(item: LootItem): ArenaLootView {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    rarity: item.rarity,
    position: worldToArenaPoint(item.x, item.y, 0.28),
  };
}

function toArenaEvent(event: GameEvent, match: MatchState): ArenaEventView | null {
  const position = event.x !== undefined && event.y !== undefined ? worldToArenaPoint(event.x, event.y, 1.45) : undefined;
  const attacker = event.botId ? match.bots.find((bot) => bot.id === event.botId) : null;
  const target = event.targetId ? match.bots.find((bot) => bot.id === event.targetId) : null;
  return {
    id: event.id,
    kind: event.kind ?? "system",
    message: event.message,
    label: event.label,
    position,
    from: attacker ? worldToArenaPoint(attacker.x, attacker.y, 1.1) : undefined,
    to: target ? worldToArenaPoint(target.x, target.y, 1.1) : position,
  };
}

function toArenaZone(zone: MapZone): ArenaZoneView {
  const width = zone.width ?? (zone.radius ?? 120) * 2;
  const height = zone.height ?? (zone.radius ?? 120) * 2;
  const centerX = zone.width ? zone.x + width / 2 : zone.x;
  const centerY = zone.height ? zone.y + height / 2 : zone.y;

  return {
    id: zone.id,
    name: zone.name,
    position: worldToArenaPoint(centerX, centerY, 0.012),
    size: [width * ARENA_SCALE, height * ARENA_SCALE],
    color: ZONE_COLORS[zone.id] ?? "#31443a",
  };
}

export const ARENA_WORLD_SIZE = MAP_SIZE * ARENA_SCALE;
export const ARENA_WORLD_CENTER = MAP_CENTER * ARENA_SCALE;
