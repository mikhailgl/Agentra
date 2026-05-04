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
import { createRng, shuffle } from "./random";
import type { Bot, MatchState } from "./types";

export function createMatch(carryOverBotId?: string): MatchState {
  const seed = Date.now() % 1_000_000_000;
  const rng = createRng(seed);
  const pool = loadPersistentBots();
  const zones = createMapZones();
  const carryOverBot = carryOverBotId ? pool.find((bot) => bot.id === carryOverBotId) : undefined;
  const selectedBots = [
    ...(carryOverBot ? [carryOverBot] : []),
    ...shuffle(pool.filter((bot) => bot.id !== carryOverBot?.id), rng).slice(0, carryOverBot ? BOT_COUNT - 1 : BOT_COUNT),
  ];
  const bots: Bot[] = selectedBots.map((persistentBot, index) => {
    const angle = (index / BOT_COUNT) * Math.PI * 2;
    return clonePersistentBotForMatch(
      persistentBot,
      MAP_CENTER + Math.cos(angle) * SPAWN_RADIUS,
      MAP_CENTER + Math.sin(angle) * SPAWN_RADIUS,
    );
  });

  const loot = createInitialLoot(LOOT_COUNT + 5, { x: MAP_CENTER, y: MAP_CENTER }, LOOT_ZONE_RADIUS * 1.65, zones, rng);

  return {
    id: `match-${seed}`,
    bots,
    loot,
    zones,
    mapEvents: [],
    creatures: [],
    learningEvents: [],
    events: [
      {
        id: 1,
        timeMs: 0,
        message: carryOverBot ? `Match started. ${carryOverBot.name} returns as reigning winner.` : "Match started.",
      },
    ],
    historyEvents: [],
    elapsedMs: 0,
    ended: false,
    winnerId: null,
    nextEventId: 2,
    eventDebounce: {},
    finalized: false,
  };
}
