import { BOT_COUNT, PERSISTENT_BOT_COUNT } from "./constants";
import { createRng, shuffle } from "./random";
import type { PersistentBot } from "./types";

const ARENA_QUEUE_KEY = "ai-battle:arena-queue:v1";
const QUEUE_TARGET_SIZE = Math.max(BOT_COUNT * 2, PERSISTENT_BOT_COUNT);

export function loadArenaQueue(pool: PersistentBot[], activeBotIds: string[] = []): PersistentBot[] {
  const active = new Set(activeBotIds);
  const queueIds = normalizeQueueIds(readQueueIds(), pool, active);
  saveQueueIds(queueIds);
  return queueIds.map((id) => pool.find((bot) => bot.id === id)).filter((bot): bot is PersistentBot => Boolean(bot));
}

export function enqueueBotForArena(botId: string, pool: PersistentBot[], activeBotIds: string[] = []): PersistentBot[] {
  const bot = pool.find((candidate) => candidate.id === botId && candidate.custom);
  if (!bot) {
    return loadArenaQueue(pool, activeBotIds);
  }

  const active = new Set(activeBotIds);
  const existing = normalizeQueueIds(readQueueIds(), pool, active).filter((id) => id !== botId);
  const nextIds = normalizeQueueIds([botId, ...existing], pool, active);
  saveQueueIds(nextIds);
  return nextIds.map((id) => pool.find((candidate) => candidate.id === id)).filter((candidate): candidate is PersistentBot => Boolean(candidate));
}

export function takeQueuedEntrants(pool: PersistentBot[], carryOverBotId?: string): { entrants: PersistentBot[]; queue: PersistentBot[] } {
  const carryOverBot = carryOverBotId ? pool.find((bot) => bot.id === carryOverBotId) : undefined;
  const selectedIds = new Set<string>(carryOverBot ? [carryOverBot.id] : []);
  const entrants: PersistentBot[] = carryOverBot ? [carryOverBot] : [];
  let queueIds = normalizeQueueIds(readQueueIds(), pool, selectedIds);
  const needed = Math.max(0, BOT_COUNT - entrants.length);

  while (entrants.length < BOT_COUNT) {
    if (queueIds.length === 0) {
      queueIds = normalizeQueueIds([], pool, selectedIds);
    }

    const nextId = queueIds.shift();
    if (!nextId || selectedIds.has(nextId)) {
      break;
    }

    const bot = pool.find((candidate) => candidate.id === nextId);
    if (!bot) {
      continue;
    }

    entrants.push(bot);
    selectedIds.add(bot.id);

    if (entrants.length >= needed + (carryOverBot ? 1 : 0)) {
      break;
    }
  }

  const nextQueueIds = normalizeQueueIds(queueIds, pool, selectedIds);
  saveQueueIds(nextQueueIds);
  return {
    entrants: entrants.slice(0, BOT_COUNT),
    queue: nextQueueIds.map((id) => pool.find((bot) => bot.id === id)).filter((bot): bot is PersistentBot => Boolean(bot)),
  };
}

function normalizeQueueIds(rawIds: string[], pool: PersistentBot[], excludedIds: Set<string>): string[] {
  const validIds = new Set(pool.map((bot) => bot.id));
  const seen = new Set<string>();
  const customQueued = rawIds.filter((id) => {
    const bot = pool.find((candidate) => candidate.id === id);
    if (!bot?.custom || excludedIds.has(id) || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return validIds.has(id);
  });
  const baseQueued = rawIds.filter((id) => {
    const bot = pool.find((candidate) => candidate.id === id);
    if (!bot || bot.custom || excludedIds.has(id) || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });

  const next = [...customQueued, ...baseQueued];
  while (next.length < QUEUE_TARGET_SIZE) {
    const filler = createBaseCycle(pool, excludedIds, new Set(next), next.length);
    if (filler.length === 0) {
      break;
    }
    next.push(...filler);
  }

  return next.slice(0, QUEUE_TARGET_SIZE);
}

function createBaseCycle(pool: PersistentBot[], excludedIds: Set<string>, alreadyQueued: Set<string>, salt: number): string[] {
  const baseBots = pool.filter((bot) => !bot.custom && !excludedIds.has(bot.id) && !alreadyQueued.has(bot.id));
  return shuffle(baseBots, createRng(hashSeed(`${Date.now()}:${salt}:${pool.length}`))).map((bot) => bot.id);
}

function readQueueIds(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(ARENA_QUEUE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveQueueIds(ids: string[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(ARENA_QUEUE_KEY, JSON.stringify(ids));
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
