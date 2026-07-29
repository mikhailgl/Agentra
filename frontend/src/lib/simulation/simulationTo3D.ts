import { MAP_CENTER, MAP_SIZE } from "../../game/constants";
import { getArenaCenter, getMatchConfig } from "../../game/matchConfig";
import type { ArenaEvent, Bet, Bot, Creature, GameEvent, LootItem, MapZone, MatchConfig, MatchState } from "../../game/types";
import type { ArenaBotView, ArenaCreatureView, ArenaEventView, ArenaLootView, ArenaMarkerView, ArenaViewModel, ArenaZoneView } from "./types";

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
  const config = getMatchConfig(match);
  const livingBets = new Set(
    bets.filter((bet) => bet.matchId === match.id && bet.status === "pending").map((bet) => bet.botId),
  );

  return {
    worldSize: config.arena.size * ARENA_SCALE,
    bots: match.bots.map((bot) => toArenaBot(bot, match, selectedBotId, draftedBotIds, livingBets, config)),
    loot: match.loot.map((item) => toArenaLoot(item, config)),
    creatures: (match.creatures ?? []).map((creature) => toArenaCreature(creature, match, config)),
    events: match.events.map((event) => toArenaEvent(event, match, config)).filter(Boolean) as ArenaEventView[],
    arenaEvents: (match.arenaEvents ?? []).map((event) => toArenaMarker(event, config)),
    zones: match.zones.map((zone) => toArenaZone(zone, config)),
    aliveCount: match.bots.filter((bot) => bot.alive).length,
    elapsedMs: match.elapsedMs,
    ended: match.ended,
    winnerId: match.winnerId,
  };
}

export function worldToArenaPoint(x: number, y: number, height = 0, config?: MatchConfig): [number, number, number] {
  const center = config ? getArenaCenter(config) : HALF_MAP;
  return [(x - center) * ARENA_SCALE, height, (y - center) * ARENA_SCALE];
}

function toArenaBot(
  bot: Bot,
  match: MatchState,
  selectedBotId: string | null,
  draftedBotIds: string[],
  livingBets: Set<string>,
  config: MatchConfig,
): ArenaBotView {
  const target = findBotTarget(bot, match);
  const dx = target ? target.x - bot.x : bot.wanderTarget ? bot.wanderTarget.x - bot.x : 0;
  const dy = target ? target.y - bot.y : bot.wanderTarget ? bot.wanderTarget.y - bot.y : 1;

  return {
    id: bot.id,
    name: bot.name,
    position: worldToArenaPoint(bot.x, bot.y, 0, config),
    rotationY: Math.atan2(dx, dy),
    health: bot.health,
    alive: bot.alive,
    kills: bot.kills,
    damageDealt: bot.damageDealt,
    survivalTimeMs: bot.survivalTimeMs,
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
    targetPosition: target ? worldToArenaPoint(target.x, target.y, 0, config) : undefined,
  };
}

function findBotTarget(bot: Bot, match: MatchState): Bot | null {
  const latestTargetId = match.events.find((event) => event.botId === bot.id && event.targetId)?.targetId;
  return latestTargetId ? match.bots.find((candidate) => candidate.id === latestTargetId) ?? null : null;
}

function toArenaLoot(item: LootItem, config: MatchConfig): ArenaLootView {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    rarity: item.rarity,
    position: worldToArenaPoint(item.x, item.y, 0.28, config),
  };
}

function toArenaCreature(creature: Creature, match: MatchState, config: MatchConfig): ArenaCreatureView {
  const target = creature.targetBotId ? match.bots.find((bot) => bot.id === creature.targetBotId) : null;
  return {
    id: creature.id,
    name: creature.name,
    position: worldToArenaPoint(creature.x, creature.y, 0.42, config),
    health: creature.health,
    targetPosition: target ? worldToArenaPoint(target.x, target.y, 1.05, config) : undefined,
  };
}

function toArenaEvent(event: GameEvent, match: MatchState, config: MatchConfig): ArenaEventView | null {
  const position = event.x !== undefined && event.y !== undefined ? worldToArenaPoint(event.x, event.y, 1.45, config) : undefined;
  const attacker = event.botId ? match.bots.find((bot) => bot.id === event.botId) : null;
  const target = event.targetId ? match.bots.find((bot) => bot.id === event.targetId) : null;
  return {
    id: event.id,
    kind: event.kind ?? "system",
    message: event.message,
    label: event.label,
    position,
    from: attacker ? worldToArenaPoint(attacker.x, attacker.y, 1.1, config) : undefined,
    to: target ? worldToArenaPoint(target.x, target.y, 1.1, config) : position,
  };
}

function toArenaMarker(event: ArenaEvent, config: MatchConfig): ArenaMarkerView {
  return {
    id: event.id,
    type: event.type,
    title: event.title,
    description: event.description,
    position: event.location ? worldToArenaPoint(event.location.x, event.location.z, 0.08, config) : undefined,
    severity: event.severity,
    radius: event.type === "danger_zone" ? (event.radius ?? config.events.dangerZoneRadius) * ARENA_SCALE : event.type === "rare_loot_drop" ? 72 * ARENA_SCALE : 96 * ARENA_SCALE,
  };
}

function toArenaZone(zone: MapZone, config: MatchConfig): ArenaZoneView {
  const width = zone.width ?? (zone.radius ?? 120) * 2;
  const height = zone.height ?? (zone.radius ?? 120) * 2;
  const centerX = zone.width ? zone.x + width / 2 : zone.x;
  const centerY = zone.height ? zone.y + height / 2 : zone.y;

  return {
    id: zone.id,
    name: zone.name,
    position: worldToArenaPoint(centerX, centerY, 0.012, config),
    size: [width * ARENA_SCALE, height * ARENA_SCALE],
    color: ZONE_COLORS[zone.id] ?? "#31443a",
  };
}

export const ARENA_WORLD_SIZE = MAP_SIZE * ARENA_SCALE;
export const ARENA_WORLD_CENTER = MAP_CENTER * ARENA_SCALE;
