import type { ArenaEvent, Bot, LootItem, MatchEvent, MatchState, NarrativeMoment, Weapon } from "./types";

export const MAX_MATCH_EVENTS = 12;
export const LOW_HP_THRESHOLD = 25;

type MatchEventBase = {
  id: string;
  timestamp: number;
};

export function createKillEvent(killer: Bot, victim: Bot, base: MatchEventBase): MatchEvent {
  return {
    ...base,
    type: "kill",
    botId: killer.id,
    targetBotId: victim.id,
    message: `${killer.name} eliminated ${victim.name}.`,
    importance: 7,
    metadata: { killerName: killer.name, victimName: victim.name, killerKills: killer.kills },
  };
}

export function createFirstBloodEvent(killer: Bot, victim: Bot, base: MatchEventBase): MatchEvent {
  return {
    ...base,
    type: "first_blood",
    botId: killer.id,
    targetBotId: victim.id,
    message: `First blood: ${killer.name} takes down ${victim.name}.`,
    importance: 9,
    metadata: { killerName: killer.name, victimName: victim.name },
  };
}

export function createKillStreakEvent(bot: Bot, streak: number, base: MatchEventBase): MatchEvent {
  return {
    ...base,
    type: "kill_streak",
    botId: bot.id,
    message: `${bot.name} is on a ${streak} kill streak.`,
    importance: Math.min(10, 7 + streak),
    metadata: { botName: bot.name, streak },
  };
}

export function createLowHpEvent(bot: Bot, base: MatchEventBase): MatchEvent {
  return {
    ...base,
    type: "low_hp",
    botId: bot.id,
    message: `${bot.name} is barely standing at ${Math.max(0, Math.round(bot.health))} HP.`,
    importance: 6,
    metadata: { botName: bot.name, health: bot.health },
  };
}

export function createNearDeathEscapeEvent(bot: Bot, base: MatchEventBase): MatchEvent {
  return {
    ...base,
    type: "near_death_escape",
    botId: bot.id,
    message: `${bot.name} survives a near-death escape.`,
    importance: 8,
    metadata: { botName: bot.name, health: bot.health },
  };
}

export function createWeaponPickupEvent(bot: Bot, weapon: Weapon | LootItem, base: MatchEventBase): MatchEvent {
  const weaponName = "weapon" in weapon ? weapon.weapon.name : weapon.name;
  return {
    ...base,
    type: "weapon_pickup",
    botId: bot.id,
    message: `${bot.name} picked up ${weaponName}.`,
    importance: getPickupImportance(weaponName),
    metadata: { botName: bot.name, weaponName },
  };
}

export function createSponsorDropEvent(bot: Bot, item: LootItem, base: MatchEventBase): MatchEvent {
  return {
    ...base,
    type: "sponsor_drop",
    botId: bot.id,
    message: `${bot.name} received a sponsor drop: ${item.name}.`,
    importance: 6,
    metadata: { botName: bot.name, itemName: item.name },
  };
}

export function createArenaMatchEvent(event: ArenaEvent, base: MatchEventBase): MatchEvent {
  return {
    ...base,
    type: "arena_event",
    message: event.description,
    importance: event.severity === "critical" ? 10 : event.severity === "major" ? 9 : 7,
    metadata: { arenaEventId: event.id, title: event.title, arenaType: event.type, regionName: event.regionName },
  };
}

export function createNarrativeMatchEvent(moment: NarrativeMoment, base: MatchEventBase): MatchEvent {
  return {
    ...base,
    type: "narrative",
    botId: moment.relatedBotIds?.[0],
    message: moment.description ? `${moment.title}: ${moment.description}` : moment.title,
    importance: moment.severity === "epic" ? 9 : moment.severity === "danger" ? 8 : 6,
    metadata: { title: moment.title, severity: moment.severity },
  };
}

export function createMatchWinnerEvent(bot: Bot, base: MatchEventBase): MatchEvent {
  return {
    ...base,
    type: "match_winner",
    botId: bot.id,
    message: `${bot.name} is the new champion.`,
    importance: 10,
    metadata: { botName: bot.name, kills: bot.kills },
  };
}

export function emitMatchEvent(match: MatchState, event: MatchEvent): void {
  match.matchEvents = [event, ...(match.matchEvents ?? [])].slice(0, MAX_MATCH_EVENTS);
}

export function nextMatchEventBase(match: MatchState, type: string): MatchEventBase {
  return {
    id: `${match.id}-${type}-${match.nextEventId}`,
    timestamp: match.elapsedMs,
  };
}

function getPickupImportance(weaponName: string): number {
  if (weaponName === "Axe") return 7;
  if (weaponName === "Bow" || weaponName === "Spear") return 5;
  return 4;
}
