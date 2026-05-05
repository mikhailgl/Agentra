import {
  BOT_COUNT,
  LOOT_COUNT,
  LOOT_ZONE_RADIUS,
  MAP_CENTER,
  SPAWN_RADIUS,
} from "./constants";
import { createMapZones } from "./biomes";
import { createInitialLoot } from "./loot";
import { loadPersistentBots, clonePersistentBotForMatch } from "./persistence";
import { takeQueuedEntrants } from "./queue";
import { createRng } from "./random";
import type { Bot, MatchState } from "./types";

export function createMatch(carryOverBotId?: string, carryOverCredits = 0): MatchState {
  const seed = Date.now() % 1_000_000_000;
  const rng = createRng(seed);
  const pool = loadPersistentBots();
  const zones = createMapZones();
  const carryOverBot = carryOverBotId ? pool.find((bot) => bot.id === carryOverBotId) : undefined;
  const selectedBots = takeQueuedEntrants(pool, carryOverBotId).entrants;
  const bots: Bot[] = selectedBots.map((persistentBot, index) => {
    const angle = (index / BOT_COUNT) * Math.PI * 2;
    const bot = clonePersistentBotForMatch(
      persistentBot,
      MAP_CENTER + Math.cos(angle) * SPAWN_RADIUS,
      MAP_CENTER + Math.sin(angle) * SPAWN_RADIUS,
    );
    if (carryOverBotId && persistentBot.id === carryOverBotId) {
      bot.carriedCredits = Math.max(0, Math.floor(carryOverCredits));
    }
    return bot;
  });

  const loot = createInitialLoot(LOOT_COUNT + 5, { x: MAP_CENTER, y: MAP_CENTER }, LOOT_ZONE_RADIUS * 1.65, zones, rng);

  return {
    id: `match-${seed}`,
    bots,
    loot,
    zones,
    mapEvents: [],
    arenaEvents: [],
    narrativeMoments: [],
    creatures: [],
    learningEvents: [],
    matchEvents: [],
    events: [
      {
        id: 1,
        timeMs: 0,
        message: carryOverBot ? `Match started. ${carryOverBot.name} returns as reigning winner with ${BOT_COUNT - 1} queued challengers.` : "Match started from the arena queue.",
      },
    ],
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
