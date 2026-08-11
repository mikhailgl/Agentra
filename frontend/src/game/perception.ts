import { getBiomeAt, getBiomeName } from "./biomes";
import { getMatchConfig } from "./matchConfig";
import { distance } from "./math";
import type {
  AgentMemory,
  AgentObservation,
  AgentSpeech,
  AvailableAction,
  Bot,
  GameEvent,
  MatchState,
  ObservedObject,
  ObservedPerson,
} from "./types";

const MAX_OBSERVED_EVENTS = 12;
const MAX_RELEVANT_MEMORIES = 16;
const SPEECH_RETENTION_MS = 30_000;

export type AgentPerceptionContext = {
  speech?: AgentSpeech[];
  memories?: AgentMemory[];
};

export function buildAgentObservation(
  match: MatchState,
  agentId: string,
  context: AgentPerceptionContext = {},
): AgentObservation {
  const self = match.bots.find((bot) => bot.id === agentId && bot.alive);
  if (!self) {
    throw new Error(`Cannot observe for missing or dead participant ${agentId}`);
  }

  const biome = getBiomeAt(self, match.zones);
  const visibleRange = getVisibleRange(match, self);
  const visiblePeople = getVisiblePeople(match, self, visibleRange);
  const visibleObjects = getVisibleObjects(match, self, visibleRange);
  const heardSpeech = (context.speech ?? [])
    .filter((speech) => canHearSpeech(self, speech, match.elapsedMs))
    .map((speech) => ({
      speechId: speech.id,
      speakerId: speech.speakerId,
      speakerName: match.bots.find((bot) => bot.id === speech.speakerId)?.name ?? "Unknown participant",
      message: speech.message,
      targetIds: speech.targetIds ? [...speech.targetIds] : undefined,
      heardAtMs: speech.createdAtMs,
      source: "heard" as const,
    }));
  const observedEvents = match.logEvents
    .filter((event) => canWitnessEvent(self, event, visibleRange))
    .slice(-MAX_OBSERVED_EVENTS)
    .map((event) => ({
      eventId: event.id,
      timeMs: event.timeMs,
      message: event.message,
      source: "witnessed" as const,
      actorId: event.botId,
      targetId: event.targetId,
    }));
  const relevantMemories = [...(context.memories ?? [])]
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, MAX_RELEVANT_MEMORIES);
  const latestEventId = observedEvents.at(-1)?.eventId ?? 0;
  const latestSpeechId = heardSpeech.at(-1)?.speechId ?? "none";

  return {
    id: `${match.id}:${agentId}:${match.elapsedMs}:${latestEventId}:${latestSpeechId}`,
    matchId: match.id,
    createdAtMs: match.elapsedMs,
    self: {
      id: self.id,
      name: self.name,
      health: self.health,
      position: { x: self.x, y: self.y },
      inventory: cloneJson(self.inventory),
    },
    knownRule: "Only one living participant can leave",
    location: { biome: biome.id, biomeName: getBiomeName(biome.id) },
    visiblePeople,
    visibleObjects,
    heardSpeech,
    observedEvents,
    relevantMemories,
    availableActions: getAvailableActions(match, self, visiblePeople, visibleObjects),
  };
}

export function canHearSpeech(listener: Bot, speech: AgentSpeech, elapsedMs: number): boolean {
  if (speech.speakerId === listener.id || elapsedMs - speech.createdAtMs > SPEECH_RETENTION_MS) {
    return false;
  }
  if (speech.targetIds?.length && !speech.targetIds.includes(listener.id)) {
    return false;
  }
  return distance(listener, speech.position) <= speech.hearingRange;
}

export function getSpeechListenerIds(match: MatchState, speech: AgentSpeech): string[] {
  return match.bots
    .filter((bot) => bot.alive && canHearSpeech(bot, speech, match.elapsedMs))
    .map((bot) => bot.id);
}

function getVisiblePeople(match: MatchState, self: Bot, visibleRange: number): ObservedPerson[] {
  return match.bots
    .filter((bot) => bot.alive && bot.id !== self.id && distance(self, bot) <= visibleRange)
    .sort((a, b) => distance(self, a) - distance(self, b))
    .map((bot) => ({
      id: bot.id,
      name: bot.name,
      position: { x: bot.x, y: bot.y },
      distance: round(distance(self, bot)),
      condition: getVisibleCondition(bot.health),
      visiblyArmed: Boolean(bot.inventory.weapon),
    }));
}

function getVisibleObjects(match: MatchState, self: Bot, visibleRange: number): ObservedObject[] {
  const loot: ObservedObject[] = match.loot
    .filter((item) => distance(self, item) <= visibleRange)
    .map((item) => ({
      id: item.id,
      kind: "loot",
      name: item.name,
      position: { x: item.x, y: item.y },
      distance: round(distance(self, item)),
      details: { category: item.category, rarity: item.rarity },
    }));
  const creatures: ObservedObject[] = match.creatures
    .filter((creature) => creature.health > 0 && distance(self, creature) <= visibleRange)
    .map((creature) => ({
      id: creature.id,
      kind: "creature",
      name: creature.name,
      position: { x: creature.x, y: creature.y },
      distance: round(distance(self, creature)),
      details: { condition: getVisibleCondition(creature.health) },
    }));
  return [...loot, ...creatures].sort((a, b) => a.distance - b.distance);
}

function getAvailableActions(
  match: MatchState,
  self: Bot,
  visiblePeople: ObservedPerson[],
  visibleObjects: ObservedObject[],
): AvailableAction[] {
  const config = getMatchConfig(match);
  const nearbyLoot = visibleObjects.filter((object) => object.kind === "loot" && object.distance <= config.loot.pickupRadius);
  const inspectableIds = visibleObjects.map((object) => object.id);
  const takeIds = nearbyLoot
    .filter((object) => match.loot.find((item) => item.id === object.id)?.type !== "medkit")
    .map((object) => object.id);
  const usableIds = nearbyLoot
    .filter((object) => match.loot.find((item) => item.id === object.id)?.type === "medkit")
    .map((object) => object.id);
  const attackIds = self.inventory.weapon
    ? visiblePeople.filter((person) => person.distance <= self.inventory.weapon!.range).map((person) => person.id)
    : [];

  return [
    { type: "move" },
    { type: "speak", targetIds: visiblePeople.map((person) => person.id) },
    ...(inspectableIds.length ? [{ type: "inspect" as const, objectIds: inspectableIds }] : []),
    ...(takeIds.length ? [{ type: "take" as const, objectIds: takeIds }] : []),
    ...(usableIds.length ? [{ type: "use" as const, objectIds: usableIds }] : []),
    ...(attackIds.length ? [{ type: "attack" as const, targetIds: attackIds }] : []),
    { type: "wait" },
  ];
}

function getVisibleRange(match: MatchState, self: Bot): number {
  const config = getMatchConfig(match);
  const biome = getBiomeAt(self, match.zones);
  const perceptionModifier = 0.82 + Math.min(20, Math.max(1, self.baseStats.perception)) / 50;
  return config.ai.visibleEnemyRange * perceptionModifier * (1 + (biome.modifiers.visibility ?? 0));
}

function canWitnessEvent(self: Bot, event: GameEvent, visibleRange: number): boolean {
  if (event.botId === self.id || event.targetId === self.id) {
    return true;
  }
  if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) {
    return false;
  }
  return distance(self, { x: event.x!, y: event.y! }) <= visibleRange;
}

function getVisibleCondition(health: number): "healthy" | "hurt" | "critical" {
  if (health <= 30) return "critical";
  if (health <= 70) return "hurt";
  return "healthy";
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
