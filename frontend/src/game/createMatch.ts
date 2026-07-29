import { createMapZones } from "./biomes";
import { CONTEST_ENTRY_FEE } from "./constants";
import { createInitialLoot } from "./loot";
import { getArenaCenter, resolveMatchConfig, type MatchConfigInput } from "./matchConfig";
import { loadPersistentBots, clonePersistentBotForMatch } from "./persistence";
import { takeQueuedEntrants } from "./queue";
import { createRng } from "./random";
import type { Bot, MatchState, PersistentBot } from "./types";

export function createMatch(carryOverBotId?: string, carryOverCredits = 0, configInput?: MatchConfigInput): MatchState {
  const config = resolveMatchConfig(configInput);
  const pool = loadPersistentBots();
  return createMatchFromPool(pool, takeQueuedEntrants(pool, carryOverBotId, config).entrants, carryOverBotId, carryOverCredits, config);
}

export function createMatchFromPool(
  pool: PersistentBot[],
  selectedBots: PersistentBot[],
  carryOverBotId?: string,
  carryOverCredits = 0,
  configInput?: MatchConfigInput,
): MatchState {
  const config = resolveMatchConfig(configInput);
  const arenaCenter = getArenaCenter(config);
  const seed = Date.now() % 1_000_000_000;
  const rng = createRng(seed);
  const zones = createMapZones(config);
  const carryOverBot = carryOverBotId ? pool.find((bot) => bot.id === carryOverBotId) : undefined;
  const bots: Bot[] = selectedBots.map((persistentBot, index) => {
    const angle = (index / config.roster.matchBotCount) * Math.PI * 2;
    const bot = clonePersistentBotForMatch(
      persistentBot,
      arenaCenter + Math.cos(angle) * config.arena.spawnRadius,
      arenaCenter + Math.sin(angle) * config.arena.spawnRadius,
    );
    if (carryOverBotId && persistentBot.id === carryOverBotId) {
      bot.carriedCredits = Math.max(0, Math.floor(carryOverCredits));
    }
    return bot;
  });

  const loot = createInitialLoot(config.loot.initialCount + config.loot.bonusInitialLoot, { x: arenaCenter, y: arenaCenter }, config.arena.lootZoneRadius * 1.65, zones, rng);
  const startEvent = {
    id: 1,
    timeMs: 0,
    message: carryOverBot ? `Match started. ${carryOverBot.name} returns as reigning winner with ${config.roster.matchBotCount - 1} queued challengers.` : "Match started from the arena queue.",
  };

  return {
    id: `match-${seed}`,
    config,
    entryFeeCredits: CONTEST_ENTRY_FEE,
    prizePoolCredits: Math.max(0, (bots.length - 1) * CONTEST_ENTRY_FEE),
    bots,
    loot,
    zones,
    mapEvents: [],
    arenaEvents: [],
    narrativeMoments: [],
    creatures: [],
    learningEvents: [],
    matchEvents: [],
    events: [startEvent],
    logEvents: [startEvent],
    historyEvents: [],
    elapsedMs: 0,
    ended: false,
    winnerId: null,
    nextEventId: 2,
    eventDebounce: {},
    matchEventState: {
      firstBloodEmitted: false,
      lowHpBotIds: {},
      killStreaks: {},
      lastKillAtMs: 0,
      lastArenaEventAtMs: -Infinity,
      firstArenaEventEmitted: false,
      suddenDeathStarted: false,
      eventCounts: {},
      lastNarrativeByKey: {},
    },
    finalized: false,
  };
}
