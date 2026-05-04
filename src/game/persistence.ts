import { BOT_NAMES, PERSISTENT_BOT_COUNT } from "./constants";
import { BIOMES, getBiomeName } from "./biomes";
import { applyMatchProgression } from "./progression";
import { createRng, pickOne } from "./random";
import { applyTraitPsychology } from "./traits";
import type { BaseStats, Bot, BotAffinities, CareerStats, MatchState, PersistentBot, Psychology, Relationship } from "./types";

const STORAGE_KEY = "ai-battle:persistent-bots:v1";

export function loadPersistentBots(): PersistentBot[] {
  if (typeof window === "undefined") {
    return createDefaultPool();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const pool = createDefaultPool();
    savePersistentBots(pool);
    return pool;
  }

  try {
    const parsed = JSON.parse(raw) as PersistentBot[];
    if (Array.isArray(parsed) && parsed.length >= PERSISTENT_BOT_COUNT) {
      return parsed.map(normalizePersistentBot);
    }
  } catch {
    // Fall through to a clean local pool if stored data is malformed.
  }

  const pool = createDefaultPool();
  savePersistentBots(pool);
  return pool;
}

export function savePersistentBots(pool: PersistentBot[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pool));
}

export function updatePersistentBotsAfterMatch(match: MatchState): PersistentBot[] {
  const pool = loadPersistentBots();
  const placements = getPlacements(match.bots);

  for (const matchBot of match.bots) {
    const persistent = pool.find((bot) => bot.id === matchBot.id);
    if (!persistent) {
      continue;
    }

    persistent.relationships = matchBot.relationships;
    applyMatchProgression(
      persistent,
      matchBot,
      placements.get(matchBot.id) ?? match.bots.length,
      match.bots.length,
      match.winnerId === matchBot.id,
    );
    matchBot.level = persistent.level;
    matchBot.xp = persistent.xp;
    matchBot.baseStats = { ...persistent.baseStats };
    matchBot.traits = [...persistent.traits];
    matchBot.affinities = updateAffinitiesAfterMatch(persistent, matchBot, placements.get(matchBot.id) ?? match.bots.length, match);
    matchBot.career = { ...persistent.career };
    matchBot.recentResults = [...persistent.recentResults];
  }

  savePersistentBots(pool);
  return pool;
}

export function clonePersistentBotForMatch(bot: PersistentBot, x: number, y: number): Bot {
  return {
    id: bot.id,
    name: bot.name,
    x,
    y,
    health: 100,
    alive: true,
    speed: 68 + bot.baseStats.speed * 3.2,
    personality: personalityFromPsychology(bot.psychology),
    level: bot.level,
    xp: bot.xp,
    baseStats: { ...bot.baseStats },
    traits: [...bot.traits],
    psychology: applyTraitPsychology(bot),
    career: { ...bot.career },
    relationships: cloneRelationships(bot.relationships),
    recentResults: [...bot.recentResults],
    affinities: cloneAffinities(bot.affinities),
    custom: bot.custom,
    tacticalInstruction: bot.tacticalInstruction,
    inventory: { weapon: null, armor: null, tool: null },
    behavior: "seeking_loot",
    lastAttackAt: -Infinity,
    kills: 0,
    damageDealt: 0,
    survivalTimeMs: 0,
    wanderTarget: null,
    activeInfluences: [],
    currentBiome: undefined,
    lastBiome: undefined,
    biomeTimeMs: {},
    weaponKills: {},
    thoughts: [],
  };
}

export function addCustomPersistentBot(input: {
  name: string;
  baseStats: BaseStats;
  psychology: Psychology;
  traits: string[];
  affinities: BotAffinities;
  tacticalInstruction: string;
}): PersistentBot[] {
  const pool = loadPersistentBots();
  const bot: PersistentBot = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim().slice(0, 24) || `Custom ${pool.length + 1}`,
    level: 1,
    xp: 0,
    baseStats: input.baseStats,
    traits: input.traits,
    psychology: input.psychology,
    career: createEmptyCareer(),
    relationships: {},
    recentResults: ["Released into the arena."],
    affinities: normalizeAffinities(input.affinities),
    custom: true,
    tacticalInstruction: input.tacticalInstruction.trim().slice(0, 140),
  };
  const nextPool = [bot, ...pool];
  savePersistentBots(nextPool);
  return nextPool;
}

function createDefaultPool(): PersistentBot[] {
  const rng = createRng(91_337);
  return Array.from({ length: PERSISTENT_BOT_COUNT }, (_, index) => {
    const psychology = createPsychology(rng);
    const traitOptions = ["bloodthirsty", "cowardly", "scavenger", "opportunist", "loyal", "sprinter", "paranoid", "duelist"];
    return {
      id: `bot-${index + 1}`,
      name: BOT_NAMES[index] ?? `Bot ${index + 1}`,
      level: 1,
      xp: 0,
      baseStats: {
        strength: 7 + rng() * 5,
        speed: 7 + rng() * 5,
        perception: 7 + rng() * 5,
        endurance: 7 + rng() * 5,
      },
      traits: [pickOne(traitOptions, rng)],
      psychology,
      career: createEmptyCareer(),
      relationships: {},
      recentResults: [],
      affinities: normalizeAffinities(),
    };
  });
}

function normalizePersistentBot(bot: PersistentBot): PersistentBot {
  const fallback = createDefaultPool().find((candidate) => candidate.id === bot.id) ?? createDefaultPool()[0];
  return {
    ...bot,
    level: bot.level ?? 1,
    xp: bot.xp ?? 0,
    baseStats: bot.baseStats ?? fallback.baseStats,
    traits: bot.traits ?? fallback.traits,
    psychology: bot.psychology ?? fallback.psychology,
    career: { ...createEmptyCareer(), ...bot.career },
    relationships: bot.relationships ?? {},
    recentResults: bot.recentResults ?? [],
    affinities: normalizeAffinities(bot.affinities),
    custom: bot.custom ?? false,
    tacticalInstruction: bot.tacticalInstruction,
  };
}

export function normalizeAffinities(affinities?: Partial<BotAffinities>): BotAffinities {
  return {
    biomes: Object.fromEntries(Object.keys(BIOMES).map((biome) => [biome, clampAffinity(affinities?.biomes?.[biome as keyof typeof BIOMES] ?? 1)])),
    weapons: {
      Knife: 1,
      Spear: 1,
      Bow: 1,
      Axe: 1,
      "Rusted Blade": 1,
      "Hunting Bow": 1,
      "Scoped Rifle": 1,
      ...Object.fromEntries(Object.entries(affinities?.weapons ?? {}).map(([key, value]) => [key, clampAffinity(value)])),
    },
    tools: {
      "Smoke Bomb": 1,
      "Trap Kit": 1,
      "Camouflage Cloak": 1,
      ...Object.fromEntries(Object.entries(affinities?.tools ?? {}).map(([key, value]) => [key, clampAffinity(value)])),
    },
    combatRanges: {
      close: clampAffinity(affinities?.combatRanges?.close ?? 1),
      mid: clampAffinity(affinities?.combatRanges?.mid ?? 1),
      long: clampAffinity(affinities?.combatRanges?.long ?? 1),
    },
  };
}

function updateAffinitiesAfterMatch(persistent: PersistentBot, matchBot: Bot, placement: number, match: MatchState): BotAffinities {
  const next = cloneAffinities(persistent.affinities);
  const bestBiome = Object.entries(matchBot.biomeTimeMs).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
  if (bestBiome) {
    const [biome, timeMs] = bestBiome;
    const change = timeMs > 20_000 && placement <= Math.ceil(match.bots.length / 2) ? 0.025 : placement >= match.bots.length - 2 ? -0.02 : 0.01;
    next.biomes[biome as keyof typeof next.biomes] = clampAffinity((next.biomes[biome as keyof typeof next.biomes] ?? 1) + change);
    if (Math.abs(change) >= 0.02) {
      match.learningEvents.push(
        change > 0
          ? `${matchBot.name} is becoming more comfortable in ${getBiomeName(biome as keyof typeof BIOMES)} terrain.`
          : `${matchBot.name}'s poor ${getBiomeName(biome as keyof typeof BIOMES)} performance reduced confidence there.`,
      );
    }
  }

  for (const [weapon, kills] of Object.entries(matchBot.weaponKills)) {
    if (kills <= 0) continue;
    next.weapons[weapon] = clampAffinity((next.weapons[weapon] ?? 1) + kills * 0.03);
    match.learningEvents.push(`${matchBot.name} is developing a preference for ${weapon}.`);
  }

  if (matchBot.inventory.weapon && match.winnerId === matchBot.id) {
    const range = matchBot.inventory.weapon.range < 80 ? "close" : matchBot.inventory.weapon.range < 240 ? "mid" : "long";
    next.combatRanges[range] = clampAffinity(next.combatRanges[range] + 0.03);
  }

  persistent.affinities = next;
  return cloneAffinities(next);
}

function cloneAffinities(affinities: BotAffinities): BotAffinities {
  return {
    biomes: { ...affinities.biomes },
    weapons: { ...affinities.weapons },
    tools: { ...affinities.tools },
    combatRanges: { ...affinities.combatRanges },
  };
}

function clampAffinity(value: number): number {
  return Math.max(0.55, Math.min(1.65, Number.isFinite(value) ? value : 1));
}

function createEmptyCareer(): CareerStats {
  return {
    matchesPlayed: 0,
    wins: 0,
    kills: 0,
    damageDealt: 0,
    longestSurvivalTime: 0,
  };
}

function createPsychology(rng: () => number): Psychology {
  return {
    aggression: rng(),
    loyalty: rng(),
    opportunism: rng(),
    selfPreservation: rng(),
    ambition: rng(),
    sociability: rng(),
    vengefulness: rng(),
    riskTolerance: rng(),
  };
}

function cloneRelationships(relationships: Record<string, Relationship>): Record<string, Relationship> {
  return Object.fromEntries(
    Object.entries(relationships ?? {}).map(([botId, relationship]) => [
      botId,
      {
        ...relationship,
        alliance: relationship.alliance ? { ...relationship.alliance, active: false } : undefined,
      },
    ]),
  );
}

function personalityFromPsychology(psychology: Psychology): Bot["personality"] {
  if (psychology.aggression > 0.72) return "Berserker";
  if (psychology.selfPreservation > 0.72) return "Coward";
  if (psychology.opportunism > 0.7) return "Scavenger";
  if (psychology.ambition > 0.68) return "Hunter";
  return "Survivor";
}

function getPlacements(bots: Bot[]): Map<string, number> {
  return new Map(
    [...bots]
      .sort((a, b) => b.survivalTimeMs - a.survivalTimeMs || b.kills - a.kills || b.damageDealt - a.damageDealt)
      .map((bot, index) => [bot.id, index + 1]),
  );
}
