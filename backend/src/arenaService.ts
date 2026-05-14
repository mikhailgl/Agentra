import { BOT_COUNT, PERSISTENT_BOT_COUNT } from "../../frontend/src/game/constants.js";
import { createMatchFromPool } from "../../frontend/src/game/createMatch.js";
import { createDefaultPool } from "../../frontend/src/game/persistence.js";
import { createRng, shuffle } from "../../frontend/src/game/random.js";
import { spawnSponsorDrop, stepSimulation, type SponsorDropKind } from "../../frontend/src/game/simulation.js";
import type { ArenaState, BasicMatchResult, MatchState, PersistentBot } from "../../frontend/src/game/types.js";

const INTERMISSION_MS = 5_000;
const TICK_MS = 50;
const MAX_DELTA_MS = 100;
const MAX_BASIC_RESULTS = 10;
const QUEUE_TARGET_SIZE = Math.max(BOT_COUNT * 2, PERSISTENT_BOT_COUNT);
const MAX_PUBLIC_EVENTS = 24;
const MAX_PUBLIC_MATCH_EVENTS = 24;
const MAX_PUBLIC_THOUGHTS = 8;
const MAX_PUBLIC_JOURNAL_ENTRIES = 6;

export type ArenaSnapshot = {
  match: MatchState;
  arenaState: ArenaState;
  persistentBots: PersistentBot[];
  arenaQueueIds: string[];
  basicResults: BasicMatchResult[];
  serverTime: number;
};

export class ArenaService {
  private readonly persistentBots = createDefaultPool();
  private arenaQueueIds = this.normalizeQueueIds([]);
  private basicResults: BasicMatchResult[] = [];
  private matchNumber = 1;
  private match: MatchState;
  private arenaState: ArenaState;
  private lastTickAt = Date.now();
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.match = this.createMatch();
    this.arenaState = this.createRunningArenaState(this.match);
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.lastTickAt = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }

  getSnapshot(): ArenaSnapshot {
    return {
      match: createPublicMatchSnapshot(this.match),
      arenaState: cloneJson(this.arenaState),
      persistentBots: this.persistentBots.map(createPublicPersistentBotSnapshot),
      arenaQueueIds: [...this.arenaQueueIds],
      basicResults: cloneJson(this.basicResults),
      serverTime: Date.now(),
    };
  }

  togglePause(): ArenaSnapshot {
    if (this.arenaState.phase === "intermission") {
      return this.getSnapshot();
    }

    this.arenaState = {
      ...this.arenaState,
      phase: this.arenaState.phase === "paused" ? "running" : "paused",
    };
    this.lastTickAt = Date.now();
    return this.getSnapshot();
  }

  startNextMatch(): ArenaSnapshot {
    this.matchNumber += 1;
    this.match = this.createMatch(this.arenaState.lastWinnerId);
    this.arenaState = this.createRunningArenaState(this.match);
    this.lastTickAt = Date.now();
    return this.getSnapshot();
  }

  sponsorDrop(botId: string, kind: SponsorDropKind): ArenaSnapshot {
    spawnSponsorDrop(this.match, botId, kind);
    return this.getSnapshot();
  }

  private tick(): void {
    const now = Date.now();
    const deltaMs = Math.min(MAX_DELTA_MS, now - this.lastTickAt);
    this.lastTickAt = now;

    if (this.arenaState.phase === "intermission") {
      if (this.arenaState.intermissionEndsAt && now >= this.arenaState.intermissionEndsAt) {
        this.startNextMatch();
      }
      return;
    }

    if (this.arenaState.phase !== "running") {
      return;
    }

    stepSimulation(this.match, deltaMs);
    this.finalizeMatchIfNeeded();
    this.syncActiveBotIds();
  }

  private finalizeMatchIfNeeded(): void {
    if (!this.match.ended || this.match.finalized) {
      return;
    }

    this.match.finalized = true;
    const winner = this.match.winnerId ? this.match.bots.find((bot) => bot.id === this.match.winnerId) ?? null : null;
    this.basicResults = [
      {
        matchNumber: this.matchNumber,
        winnerBotId: winner?.id ?? "no-survivor",
        winnerName: winner?.name ?? "No survivor",
        endedAt: Date.now(),
      },
      ...this.basicResults.filter((result) => result.matchNumber !== this.matchNumber),
    ].slice(0, MAX_BASIC_RESULTS);

    this.arenaState = {
      ...this.arenaState,
      phase: "intermission",
      activeBotIds: this.match.bots.filter((bot) => bot.alive).map((bot) => bot.id),
      lastWinnerId: winner?.id,
      intermissionEndsAt: Date.now() + INTERMISSION_MS,
    };
  }

  private syncActiveBotIds(): void {
    const activeBotIds = this.match.bots.filter((bot) => bot.alive).map((bot) => bot.id);
    if (this.arenaState.activeBotIds.length === activeBotIds.length && this.arenaState.activeBotIds.every((id, index) => id === activeBotIds[index])) {
      return;
    }

    this.arenaState = {
      ...this.arenaState,
      activeBotIds,
    };
  }

  private createMatch(carryOverBotId?: string): MatchState {
    const entrants = this.takeQueuedEntrants(carryOverBotId);
    return createMatchFromPool(this.persistentBots, entrants, carryOverBotId);
  }

  private createRunningArenaState(match: MatchState): ArenaState {
    return {
      matchNumber: this.matchNumber,
      phase: "running",
      activeBotIds: match.bots.map((bot) => bot.id),
      lastWinnerId: this.arenaState?.lastWinnerId,
    };
  }

  private takeQueuedEntrants(carryOverBotId?: string): PersistentBot[] {
    const carryOverBot = carryOverBotId ? this.persistentBots.find((bot) => bot.id === carryOverBotId) : undefined;
    const selectedIds = new Set<string>(carryOverBot ? [carryOverBot.id] : []);
    const entrants: PersistentBot[] = carryOverBot ? [carryOverBot] : [];
    this.arenaQueueIds = this.normalizeQueueIds(this.arenaQueueIds, selectedIds);

    while (entrants.length < BOT_COUNT) {
      const nextId = this.arenaQueueIds.shift();
      if (!nextId || selectedIds.has(nextId)) {
        break;
      }

      const bot = this.persistentBots.find((candidate) => candidate.id === nextId);
      if (!bot) {
        continue;
      }

      entrants.push(bot);
      selectedIds.add(bot.id);
    }

    this.arenaQueueIds = this.normalizeQueueIds(this.arenaQueueIds, selectedIds);
    return entrants.slice(0, BOT_COUNT);
  }

  private normalizeQueueIds(rawIds: string[], excludedIds = new Set<string>()): string[] {
    const validIds = new Set(this.persistentBots.map((bot) => bot.id));
    const seen = new Set<string>();
    const next = rawIds.filter((id) => {
      if (!validIds.has(id) || excludedIds.has(id) || seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    });

    while (next.length < QUEUE_TARGET_SIZE) {
      const filler = shuffle(
        this.persistentBots.filter((bot) => !bot.custom && !excludedIds.has(bot.id) && !seen.has(bot.id)),
        createRng(hashSeed(`${Date.now()}:${next.length}:${this.persistentBots.length}`)),
      );
      if (filler.length === 0) {
        break;
      }
      for (const bot of filler) {
        next.push(bot.id);
        seen.add(bot.id);
      }
    }

    return next.slice(0, QUEUE_TARGET_SIZE);
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createPublicMatchSnapshot(match: MatchState): MatchState {
  return {
    ...match,
    bots: match.bots.map((bot) => {
      const { relationships: _relationships, thoughts, ...publicBot } = bot;
      return {
        ...publicBot,
        relationships: {},
        thoughts: thoughts.slice(0, MAX_PUBLIC_THOUGHTS),
      };
    }),
    events: match.events.slice(0, MAX_PUBLIC_EVENTS),
    matchEvents: match.matchEvents.slice(0, MAX_PUBLIC_MATCH_EVENTS),
    narrativeMoments: match.narrativeMoments.slice(0, 6),
    historyEvents: [],
    learningEvents: [],
    eventDebounce: {},
  };
}

function createPublicPersistentBotSnapshot(bot: PersistentBot): PersistentBot {
  const { relationships: _relationships, journal, ...publicBot } = bot;
  return {
    ...publicBot,
    relationships: {},
    journal: journal?.slice(0, MAX_PUBLIC_JOURNAL_ENTRIES),
  };
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
