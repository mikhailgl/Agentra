import { BOT_NAMES, PERSISTENT_BOT_COUNT } from "./constants";
import { BIOMES, getBiomeName } from "./biomes";
import { applyMatchProgression } from "./progression";
import { createRng, pickOne } from "./random";
import { saveRemoteGameState } from "./remotePersistence";
import { applyTraitPsychology } from "./traits";
import type { BaseStats, Bot, BotAffinities, BotJournalEntry, CareerStats, MatchState, PersistentBot, Psychology, Relationship } from "./types";

const STORAGE_KEY = "ai-battle:persistent-bots:v1";
const MAX_JOURNAL_ENTRIES = 24;

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
  const normalizedPool = pool.map(normalizePersistentBot);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedPool));
  saveRemoteGameState({ persistentBots: normalizedPool });
}

export function updatePersistentBotsAfterMatch(match: MatchState, matchNumber?: number): PersistentBot[] {
  const pool = loadPersistentBots();
  const placements = getPlacements(match.bots);

  for (const matchBot of match.bots) {
    const persistent = pool.find((bot) => bot.id === matchBot.id);
    if (!persistent) {
      continue;
    }

    persistent.relationships = matchBot.relationships;
    const previousLevel = persistent.level;
    const progressionResult = applyMatchProgression(
      persistent,
      matchBot,
      placements.get(matchBot.id) ?? match.bots.length,
      match.bots.length,
      match.winnerId === matchBot.id,
    );
    persistent.journal = addJournalEntry(persistent.journal, createMatchJournalEntry(persistent, matchBot, progressionResult, placements.get(matchBot.id) ?? match.bots.length, match.bots.length, matchNumber, previousLevel));
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
    carriedCredits: 0,
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
    doctrineSummary: summarizeDoctrine(input.tacticalInstruction),
    journal: [
      {
        id: `journal-${Date.now()}-origin`,
        timestamp: Date.now(),
        title: "Released into the ludus",
        body: `${input.name.trim().slice(0, 24) || "Custom Bot"} was created with a ${summarizeDoctrine(input.tacticalInstruction).toLowerCase()} doctrine.`,
        tone: "origin",
      },
    ],
  };
  const nextPool = [bot, ...pool];
  savePersistentBots(nextPool);
  return nextPool;
}

export function updatePersistentBotDoctrine(botId: string, instruction: string): PersistentBot[] {
  const pool = loadPersistentBots();
  const trimmed = instruction.trim().slice(0, 180);
  const nextPool = pool.map((bot) => {
    if (bot.id !== botId) {
      return bot;
    }

    return {
      ...bot,
      tacticalInstruction: trimmed,
      doctrineSummary: summarizeDoctrine(trimmed),
      psychology: applyDoctrinePsychology(bot.psychology, trimmed),
      affinities: applyDoctrineAffinities(bot.affinities, trimmed),
      journal: addJournalEntry(bot.journal, {
        id: `journal-${Date.now()}-training`,
        timestamp: Date.now(),
        title: "Doctrine updated",
        body: trimmed
          ? `New private instruction: "${trimmed}". Current read: ${summarizeDoctrine(trimmed)}.`
          : "Doctrine cleared. This fighter will lean on its native instincts again.",
        tone: "training",
      }),
    };
  });
  savePersistentBots(nextPool);
  return nextPool;
}

export function createDefaultPool(): PersistentBot[] {
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
      doctrineSummary: summarizeDoctrine(""),
      journal: [
        {
          id: `journal-${index + 1}-origin`,
          timestamp: Date.now(),
          title: "Entered the public pool",
          body: `${BOT_NAMES[index] ?? `Bot ${index + 1}`} joined the arena circuit looking for a first reputation-making win.`,
          tone: "origin",
        },
      ],
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
    doctrineSummary: bot.doctrineSummary ?? summarizeDoctrine(bot.tacticalInstruction ?? ""),
    journal: normalizeJournal(bot.journal, bot),
  };
}

export function summarizeDoctrine(instruction: string): string {
  const lower = instruction.toLowerCase();
  const priorities: string[] = [];

  if (lower.includes("ambush") || lower.includes("hide") || lower.includes("stealth")) priorities.push("ambush-first");
  if (lower.includes("avoid") || lower.includes("retreat") || lower.includes("survive")) priorities.push("survival-biased");
  if (lower.includes("loot") || lower.includes("scavenge") || lower.includes("credits")) priorities.push("loot-aware");
  if (lower.includes("weakened") || lower.includes("finish") || lower.includes("hunt")) priorities.push("hunts wounded targets");
  if (lower.includes("revenge") || lower.includes("betray")) priorities.push("grudge-driven");
  if (lower.includes("aggressive") || lower.includes("attack") || lower.includes("rush")) priorities.push("high-pressure");
  if (lower.includes("ranged") || lower.includes("bow") || lower.includes("rifle")) priorities.push("range-preferring");
  if (lower.includes("melee") || lower.includes("close")) priorities.push("close-range");

  return priorities.length > 0 ? priorities.slice(0, 3).join(" / ") : "autonomous instincts";
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

function createMatchJournalEntry(
  persistent: PersistentBot,
  matchBot: Bot,
  progressionResult: string,
  placement: number,
  totalBots: number,
  matchNumber: number | undefined,
  previousLevel: number,
): BotJournalEntry {
  const leveled = persistent.level > previousLevel;
  const won = placement === 1 && matchBot.alive;
  const extracted = matchBot.carriedCredits > 0;
  const title = won ? `Won match #${matchNumber ?? "?"}` : `Placed #${placement} of ${totalBots}`;
  const bodyParts = [
    progressionResult,
    `${matchBot.kills} kills`,
    `${Math.round(matchBot.damageDealt)} damage`,
    `${Math.round(matchBot.survivalTimeMs / 1000)}s survived`,
  ];

  if (extracted) {
    bodyParts.push(`extracted ${matchBot.carriedCredits} credits`);
  }
  if (leveled) {
    bodyParts.push(`reached level ${persistent.level}`);
  }

  return {
    id: `journal-${Date.now()}-${persistent.id}-${matchNumber ?? "match"}`,
    timestamp: Date.now(),
    matchNumber,
    title,
    body: bodyParts.join(" / "),
    tone: won ? "victory" : leveled ? "growth" : placement > Math.ceil(totalBots * 0.7) ? "setback" : "match",
  };
}

function addJournalEntry(entries: BotJournalEntry[] | undefined, entry: BotJournalEntry): BotJournalEntry[] {
  return [entry, ...(entries ?? [])].slice(0, MAX_JOURNAL_ENTRIES);
}

function normalizeJournal(entries: BotJournalEntry[] | undefined, bot: PersistentBot): BotJournalEntry[] {
  if (Array.isArray(entries) && entries.length > 0) {
    return entries
      .filter((entry) => typeof entry?.id === "string" && typeof entry.title === "string" && typeof entry.body === "string")
      .map((entry) => ({
        id: entry.id,
        timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
        matchNumber: Number.isFinite(entry.matchNumber) ? entry.matchNumber : undefined,
        title: entry.title.slice(0, 80),
        body: entry.body.slice(0, 260),
        tone: ["origin", "training", "match", "victory", "setback", "growth"].includes(entry.tone) ? entry.tone : "match",
      }))
      .slice(0, MAX_JOURNAL_ENTRIES);
  }

  return [
    {
      id: `journal-${bot.id}-origin`,
      timestamp: Date.now(),
      title: bot.custom ? "Released into the ludus" : "Entered the public pool",
      body: `${bot.name} is waiting for a defining arena performance.`,
      tone: "origin",
    },
  ];
}

function applyDoctrinePsychology(psychology: Psychology, instruction: string): Psychology {
  const lower = instruction.toLowerCase();
  const next = { ...psychology };

  if (lower.includes("aggressive") || lower.includes("attack") || lower.includes("rush")) next.aggression += 0.06;
  if (lower.includes("avoid") || lower.includes("retreat") || lower.includes("survive")) next.selfPreservation += 0.07;
  if (lower.includes("loot") || lower.includes("scavenge") || lower.includes("credits")) next.opportunism += 0.06;
  if (lower.includes("ambush") || lower.includes("hide") || lower.includes("stealth")) next.riskTolerance -= 0.04;
  if (lower.includes("revenge") || lower.includes("grudge")) next.vengefulness += 0.07;
  if (lower.includes("ally") || lower.includes("team") || lower.includes("loyal")) next.loyalty += 0.06;
  if (lower.includes("win") || lower.includes("hunt") || lower.includes("finish")) next.ambition += 0.05;

  return clampPsychology(next);
}

function applyDoctrineAffinities(affinities: BotAffinities, instruction: string): BotAffinities {
  const lower = instruction.toLowerCase();
  const next = cloneAffinities(affinities);

  if (lower.includes("bow") || lower.includes("ranged")) {
    next.weapons.Bow = clampAffinity(next.weapons.Bow + 0.05);
    next.combatRanges.long = clampAffinity(next.combatRanges.long + 0.05);
  }
  if (lower.includes("melee") || lower.includes("close")) {
    next.weapons.Knife = clampAffinity(next.weapons.Knife + 0.04);
    next.weapons.Axe = clampAffinity(next.weapons.Axe + 0.04);
    next.combatRanges.close = clampAffinity(next.combatRanges.close + 0.05);
  }
  if (lower.includes("forest")) next.biomes.forest = clampAffinity((next.biomes.forest ?? 1) + 0.04);
  if (lower.includes("high ground")) next.biomes.high_ground = clampAffinity((next.biomes.high_ground ?? 1) + 0.04);
  if (lower.includes("swamp")) next.biomes.swamp = clampAffinity((next.biomes.swamp ?? 1) + 0.04);

  return next;
}

function clampPsychology(psychology: Psychology): Psychology {
  return Object.fromEntries(Object.entries(psychology).map(([key, value]) => [key, Math.max(0, Math.min(1, value))])) as Psychology;
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
