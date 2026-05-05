import { LOOT_ZONE_RADIUS, MAP_CENTER, MAP_SIZE, WEAPONS } from "./constants";
import { getBiomeAt, getBiomeName } from "./biomes";
import { createRng } from "./random";
import { distance, randomPointInCircle } from "./math";
import { createArenaMatchEvent, createNarrativeMatchEvent, emitMatchEvent, nextMatchEventBase } from "./matchEvents";
import type { ArenaEvent, ArenaEventType, Bot, Creature, GameEvent, LootItem, MatchState, NarrativeMoment, Point } from "./types";

const FIRST_EVENT_MIN_MS = 30_000;
const EVENT_COOLDOWN_MS = 18_000;
const MAX_ACTIVE_ARENA_EVENTS = 2;
const NARRATIVE_LIMIT = 8;
const ACTIVE_EVENT_LIMIT = 8;
const DANGER_DAMAGE_PER_SECOND = 4.5;

type LogArenaEvent = (message: string, debounceKey?: string, debounceMs?: number, meta?: Partial<GameEvent>) => void;

export function updateArenaEventSystem(match: MatchState, deltaMs: number, log: LogArenaEvent): void {
  ensureArenaEventRuntime(match);
  expireArenaEvents(match, log);
  applyDangerZones(match, deltaMs, log);
  triggerPacingEvent(match, log);
}

export function forceArenaEvent(match: MatchState, type: ArenaEventType, log: LogArenaEvent = () => undefined): ArenaEvent | null {
  ensureArenaEventRuntime(match);
  return startArenaEvent(match, type, log, "manual");
}

export function addNarrativeMoment(
  match: MatchState,
  moment: Omit<NarrativeMoment, "id" | "createdAt" | "durationMs"> & { durationMs?: number },
  key = moment.title,
): NarrativeMoment | null {
  ensureArenaEventRuntime(match);
  const lastAt = match.matchEventState.lastNarrativeByKey[key] ?? -Infinity;
  if (match.elapsedMs - lastAt < 8_000) {
    return null;
  }

  match.matchEventState.lastNarrativeByKey[key] = match.elapsedMs;
  const narrative: NarrativeMoment = {
    id: `narrative-${match.nextEventId}`,
    createdAt: match.elapsedMs,
    durationMs: moment.durationMs ?? 3_600,
    ...moment,
  };
  match.nextEventId += 1;
  match.narrativeMoments = [narrative, ...(match.narrativeMoments ?? [])].slice(0, NARRATIVE_LIMIT);
  if (narrative.severity !== "info") {
    emitMatchEvent(match, createNarrativeMatchEvent(narrative, nextMatchEventBase(match, "narrative")));
  }
  return narrative;
}

export function isPointInActiveDangerZone(match: MatchState, point: Point): boolean {
  return getActiveDangerZones(match).some((event) => isPointInsideArenaEvent(event, point));
}

export function getActiveDangerZoneEscapeTarget(match: MatchState, bot: Bot): Point | null {
  const danger = getActiveDangerZones(match).find((event) => isPointInsideArenaEvent(event, bot));
  if (!danger?.location) {
    return null;
  }

  const dx = bot.x - danger.location.x;
  const dy = bot.y - danger.location.z;
  const length = Math.max(1, Math.hypot(dx, dy));
  return clampPoint({
    x: bot.x + (dx / length) * 180,
    y: bot.y + (dy / length) * 180,
  });
}

export function getBountyTargetId(match: MatchState): string | null {
  const bounty = (match.arenaEvents ?? []).find(
    (event) => event.type === "bounty_target" && isArenaEventActive(match, event) && event.affectedBotIds?.[0],
  );
  return bounty?.affectedBotIds?.[0] ?? null;
}

export function isSuddenDeathActive(match: MatchState): boolean {
  return (match.arenaEvents ?? []).some((event) => event.type === "sudden_death" && isArenaEventActive(match, event));
}

function triggerPacingEvent(match: MatchState, log: LogArenaEvent): void {
  if (match.ended) return;
  const living = match.bots.filter((bot) => bot.alive);
  if (living.length <= 1) return;

  const activeEvents = (match.arenaEvents ?? []).filter((event) => isArenaEventActive(match, event));
  const lastEventAt = match.matchEventState.lastArenaEventAtMs;
  if (activeEvents.length >= MAX_ACTIVE_ARENA_EVENTS || match.elapsedMs - lastEventAt < EVENT_COOLDOWN_MS) {
    return;
  }

  if (!match.matchEventState.firstArenaEventEmitted && match.elapsedMs >= FIRST_EVENT_MIN_MS) {
    const type = averageLivingBotDistance(living) > 365 ? "rare_loot_drop" : "monster_spawn";
    startArenaEvent(match, type, log, "first_event");
    return;
  }

  const timeSinceKill = match.elapsedMs - (match.matchEventState.lastKillAtMs || 0);
  if (match.elapsedMs > 36_000 && timeSinceKill > 30_000) {
    startArenaEvent(match, match.matchEventState.eventCounts.rare_loot_drop ? "monster_spawn" : "rare_loot_drop", log, "stalled_kills");
    return;
  }

  if (match.elapsedMs > 42_000 && averageLivingBotDistance(living) > 390) {
    startArenaEvent(match, "rare_loot_drop", log, "spread_out");
    return;
  }

  if (living.length >= 3 && living.length <= 5 && match.elapsedMs > 55_000) {
    startArenaEvent(match, match.matchEventState.suddenDeathStarted ? "danger_zone" : "sudden_death", log, "late_match");
  }
}

function startArenaEvent(match: MatchState, type: ArenaEventType, log: LogArenaEvent, reason: string): ArenaEvent | null {
  if (type === "monster_spawn") return startMonsterSpawn(match, log, reason);
  if (type === "rare_loot_drop") return startRareLootDrop(match, log, reason);
  if (type === "danger_zone") return startDangerZone(match, log, reason);
  if (type === "bounty_target") return startBounty(match, log, reason);
  if (type === "sudden_death") return startSuddenDeath(match, log, reason);
  return null;
}

function startMonsterSpawn(match: MatchState, log: LogArenaEvent, reason: string): ArenaEvent {
  const living = match.bots.filter((bot) => bot.alive);
  const center = living.length ? centerOfBots(living) : { x: MAP_CENTER, y: MAP_CENTER };
  const zone = getBiomeAt(center, match.zones);
  const point = randomPointInCircle(center, 120, createRng(hashSeed(`${match.id}:monster:${match.nextEventId}:${reason}`)));
  const event = pushArenaEvent(match, {
    type: "monster_spawn",
    title: `WOLF PACK ENTERING ${zone.name.toUpperCase()}`,
    description: `A wolf pack has entered ${zone.name}.`,
    location: { x: point.x, z: point.y },
    regionName: zone.name,
    durationMs: 24_000,
    severity: "major",
  });

  for (let index = 0; index < 3; index += 1) {
    const spawn = randomPointInCircle(point, 42 + index * 10, createRng(hashSeed(`${event.id}:creature:${index}`)));
    match.creatures.push(createCreature(match, event, zone.id, spawn.x, spawn.y, index));
  }

  log(event.description, undefined, 0, { kind: "system", x: point.x, y: point.y, label: "Wolf Pack" });
  announceArenaEvent(match, event);
  addNarrativeMoment(match, {
    title: "Wolf Pack is attacking the arena",
    description: `Hostiles are converging on ${zone.name}.`,
    severity: "danger",
    location: event.location,
  }, event.id);
  return event;
}

function startRareLootDrop(match: MatchState, log: LogArenaEvent, reason: string): ArenaEvent {
  const point = reason === "spread_out" ? { x: MAP_CENTER, y: MAP_CENTER } : pickVisiblePoint(match, "loot");
  const zone = getBiomeAt(point, match.zones);
  const loot = createRareLoot(match, point.x, point.y);
  match.loot.push(loot);

  const event = pushArenaEvent(match, {
    type: "rare_loot_drop",
    title: `RARE LOOT DROP IN ${zone.name.toUpperCase()}`,
    description: `A rare weapon has dropped in ${zone.name}.`,
    location: { x: point.x, z: point.y },
    regionName: zone.name,
    durationMs: 22_000,
    severity: "major",
  });

  for (const bot of match.bots.filter((candidate) => candidate.alive).sort((a, b) => distance(a, point) - distance(b, point)).slice(0, 5)) {
    if (!isPointInActiveDangerZone(match, point) || bot.psychology.riskTolerance > 0.55) {
      bot.wanderTarget = point;
    }
  }

  log(event.description, undefined, 0, { kind: "loot", x: point.x, y: point.y, label: loot.name });
  announceArenaEvent(match, event);
  return event;
}

function startDangerZone(match: MatchState, log: LogArenaEvent, reason: string): ArenaEvent {
  const living = match.bots.filter((bot) => bot.alive);
  const target = living.length ? living[Math.floor(createRng(hashSeed(`${match.id}:danger:${match.nextEventId}:${reason}`))() * living.length)] : null;
  const point = target ? { x: target.x, y: target.y } : pickVisiblePoint(match, "danger");
  const zone = getBiomeAt(point, match.zones);
  const affectedBotIds = living.filter((bot) => distance(bot, point) <= 145).map((bot) => bot.id);
  const event = pushArenaEvent(match, {
    type: "danger_zone",
    title: `${zone.name.toUpperCase()} IS NOW DANGEROUS`,
    description: `${zone.name} became unstable.`,
    location: { x: point.x, z: point.y },
    regionName: zone.name,
    durationMs: 20_000,
    severity: "critical",
    affectedBotIds,
  });

  log(event.description, undefined, 0, { kind: "system", x: point.x, y: point.y, label: "Danger" });
  announceArenaEvent(match, event);
  return event;
}

function startBounty(match: MatchState, log: LogArenaEvent, reason: string): ArenaEvent | null {
  const target = match.bots.filter((bot) => bot.alive).sort((a, b) => b.kills - a.kills || b.damageDealt - a.damageDealt)[0];
  if (!target) return null;
  const event = pushArenaEvent(match, {
    type: "bounty_target",
    title: `BOUNTY PLACED ON ${target.name.toUpperCase()}`,
    description: `${target.name} is now worth bonus XP.`,
    location: { x: target.x, z: target.y },
    startedAt: match.elapsedMs,
    durationMs: 24_000,
    severity: "major",
    affectedBotIds: [target.id],
  });
  log(event.description, undefined, 0, { kind: "system", botId: target.id, x: target.x, y: target.y, label: "Bounty" });
  announceArenaEvent(match, event);
  return event;
}

function startSuddenDeath(match: MatchState, log: LogArenaEvent, reason: string): ArenaEvent {
  const event = pushArenaEvent(match, {
    type: "sudden_death",
    title: "SUDDEN DEATH: HEALING REDUCED",
    description: "Sudden death has begun.",
    location: { x: MAP_CENTER, z: MAP_CENTER },
    durationMs: 60_000,
    severity: "critical",
  });
  match.matchEventState.suddenDeathStarted = true;
  log(event.description, undefined, 0, { kind: "system", x: MAP_CENTER, y: MAP_CENTER, label: "Sudden Death" });
  announceArenaEvent(match, event);
  addNarrativeMoment(match, {
    title: "Sudden death has begun",
    description: "Healing is reduced and bots press harder.",
    severity: "epic",
    location: event.location,
  }, event.id);
  return event;
}

function pushArenaEvent(match: MatchState, event: Omit<ArenaEvent, "id" | "startedAt"> & { startedAt?: number }): ArenaEvent {
  const arenaEvent: ArenaEvent = {
    id: `arena-event-${match.nextEventId}`,
    startedAt: match.elapsedMs,
    ...event,
  };
  match.nextEventId += 1;
  match.arenaEvents = [arenaEvent, ...(match.arenaEvents ?? [])].slice(0, ACTIVE_EVENT_LIMIT);
  match.matchEventState.lastArenaEventAtMs = match.elapsedMs;
  match.matchEventState.firstArenaEventEmitted = true;
  match.matchEventState.eventCounts[arenaEvent.type] = (match.matchEventState.eventCounts[arenaEvent.type] ?? 0) + 1;
  return arenaEvent;
}

function announceArenaEvent(match: MatchState, event: ArenaEvent): void {
  emitMatchEvent(match, createArenaMatchEvent(event, nextMatchEventBase(match, event.type)));
}

function expireArenaEvents(match: MatchState, log: LogArenaEvent): void {
  const previous = match.arenaEvents ?? [];
  match.arenaEvents = previous.filter((event) => isArenaEventActive(match, event));
  for (const event of previous) {
    if (event.durationMs && event.startedAt + event.durationMs <= match.elapsedMs && !match.eventDebounce[`arena-ended-${event.id}`]) {
      match.eventDebounce[`arena-ended-${event.id}`] = match.elapsedMs;
      if (event.type === "danger_zone") {
        log(`${event.regionName ?? "The danger zone"} stabilized.`, undefined, 0, {
          kind: "system",
          x: event.location?.x,
          y: event.location?.z,
          label: "Safe",
        });
      }
    }
  }
  match.narrativeMoments = (match.narrativeMoments ?? []).filter((moment) => moment.createdAt + moment.durationMs > match.elapsedMs);
}

function applyDangerZones(match: MatchState, deltaMs: number, log: LogArenaEvent): void {
  for (const event of getActiveDangerZones(match)) {
    for (const bot of match.bots.filter((candidate) => candidate.alive && isPointInsideArenaEvent(event, candidate))) {
      const previousHealth = bot.health;
      bot.health = Math.max(1, bot.health - DANGER_DAMAGE_PER_SECOND * (deltaMs / 1000));
      const escapeTarget = getActiveDangerZoneEscapeTarget(match, bot);
      if (escapeTarget) bot.wanderTarget = escapeTarget;
      if (Math.floor(previousHealth) !== Math.floor(bot.health)) {
        log(`${bot.name} is taking damage inside ${event.regionName ?? "the danger zone"}.`, `danger-tick-${event.id}-${bot.id}`, 1600, {
          kind: "damage",
          botId: bot.id,
          x: bot.x,
          y: bot.y,
          label: "-zone",
        });
      }
      addNarrativeMoment(match, {
        title: `${bot.name} entered the danger zone`,
        description: `${event.regionName ?? "The area"} is burning health away.`,
        severity: "danger",
        relatedBotIds: [bot.id],
        location: { x: bot.x, z: bot.y },
        durationMs: 2_800,
      }, `danger-${event.id}-${bot.id}`);
    }
  }
}

function createRareLoot(match: MatchState, x: number, y: number): LootItem {
  const weapon = { ...WEAPONS.reduce((best, weapon) => (weapon.damage > best.damage ? weapon : best), WEAPONS[0]), name: "Rare Rifle", damage: 31, range: 260, cooldownMs: 900, accuracy: 0.78 };
  return {
    id: `rare-loot-${match.nextEventId}`,
    x,
    y,
    type: "weapon",
    name: "Rare Rifle",
    category: "weapon",
    rarity: "legendary",
    effects: { damage: weapon.damage, range: weapon.range, accuracy: weapon.accuracy },
    weapon,
  };
}

function createCreature(match: MatchState, event: ArenaEvent, biome: Creature["biome"], x: number, y: number, index: number): Creature {
  return {
    id: `creature-${match.nextEventId}-${index}`,
    name: "Arena Wolf",
    health: 34,
    damage: 6,
    aggression: 0.82,
    biome,
    x,
    y,
    lastAttackAt: -Infinity,
    arenaEventId: event.id,
    expiresAtMs: event.startedAt + (event.durationMs ?? 24_000),
  };
}

function pickVisiblePoint(match: MatchState, salt: string): Point {
  const rng = createRng(hashSeed(`${match.id}:${salt}:${match.nextEventId}`));
  const zone = match.zones[Math.floor(rng() * match.zones.length)];
  return randomPointInCircle({ x: zone.x + (zone.width ?? 0) / 2, y: zone.y + (zone.height ?? 0) / 2 }, zone.radius ?? LOOT_ZONE_RADIUS, rng);
}

function getActiveDangerZones(match: MatchState): ArenaEvent[] {
  return (match.arenaEvents ?? []).filter((event) => event.type === "danger_zone" && isArenaEventActive(match, event));
}

function isArenaEventActive(match: MatchState, event: ArenaEvent): boolean {
  return !event.durationMs || event.startedAt + event.durationMs > match.elapsedMs;
}

function isPointInsideArenaEvent(event: ArenaEvent, point: Point): boolean {
  if (!event.location) return false;
  return distance(point, { x: event.location.x, y: event.location.z }) <= 145;
}

function centerOfBots(bots: Bot[]): Point {
  return {
    x: bots.reduce((sum, bot) => sum + bot.x, 0) / bots.length,
    y: bots.reduce((sum, bot) => sum + bot.y, 0) / bots.length,
  };
}

function averageLivingBotDistance(bots: Bot[]): number {
  let total = 0;
  let count = 0;
  for (let left = 0; left < bots.length; left += 1) {
    for (let right = left + 1; right < bots.length; right += 1) {
      total += distance(bots[left], bots[right]);
      count += 1;
    }
  }
  return count ? total / count : 0;
}

function clampPoint(point: Point): Point {
  return {
    x: Math.max(0, Math.min(MAP_SIZE, point.x)),
    y: Math.max(0, Math.min(MAP_SIZE, point.y)),
  };
}

export function getArenaEventRegionName(match: MatchState, point: Point): string {
  return getBiomeName(getBiomeAt(point, match.zones).id);
}

function ensureArenaEventRuntime(match: MatchState): void {
  match.arenaEvents ??= [];
  match.narrativeMoments ??= [];
  match.matchEventState ??= {
    firstBloodEmitted: false,
    lowHpBotIds: {},
    killStreaks: {},
    lastKillAtMs: 0,
    lastArenaEventAtMs: -Infinity,
    firstArenaEventEmitted: false,
    suddenDeathStarted: false,
    eventCounts: {},
    lastNarrativeByKey: {},
  };
  match.matchEventState.lastKillAtMs ??= 0;
  match.matchEventState.lastArenaEventAtMs ??= -Infinity;
  match.matchEventState.firstArenaEventEmitted ??= false;
  match.matchEventState.suddenDeathStarted ??= false;
  match.matchEventState.eventCounts ??= {};
  match.matchEventState.lastNarrativeByKey ??= {};
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
