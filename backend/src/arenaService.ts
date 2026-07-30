import { createMatchFromPool } from "../../frontend/src/game/createMatch.js";
import { addLeagueBot, advanceLeagueSeason, applyLeagueMatchResult, createLeagueState, getLeagueEntrantIds } from "../../frontend/src/game/league.js";
import { createMatchLog } from "../../frontend/src/game/matchLog.js";
import { DEFAULT_MATCH_CONFIG, getQueueTargetSize } from "../../frontend/src/game/matchConfig.js";
import {
  applyPersistentBotDoctrine,
  applyPersistentBotMatchResult,
  createDefaultPool,
  normalizeAffinities,
  summarizeDoctrine,
} from "../../frontend/src/game/persistence.js";
import { createRng, shuffle } from "../../frontend/src/game/random.js";
import { spawnSponsorDrop, stepSimulation, type SponsorDropKind } from "../../frontend/src/game/simulation.js";
import type { ArenaState, BaseStats, BasicMatchResult, Bot, BotAffinities, LeagueState, MatchLog, MatchState, PersistentBot, Psychology } from "../../frontend/src/game/types.js";
import { toArenaViewModel } from "../../frontend/src/lib/simulation/simulationTo3D.js";
import type { ArenaViewModel } from "../../frontend/src/lib/simulation/types.js";

const INTERMISSION_MS = 5_000;
const TICK_MS = 50;
const MAX_DELTA_MS = 100;
const MAX_BASIC_RESULTS = 10;
const MAX_PUBLIC_EVENTS = 24;
const MAX_PUBLIC_MATCH_EVENTS = 24;
const MAX_PUBLIC_THOUGHTS = 8;
const MAX_PUBLIC_JOURNAL_ENTRIES = 6;

export type ArenaSnapshot = {
  match: MatchState;
  arenaState: ArenaState;
  leagueState: LeagueState;
  persistentBots?: PersistentBot[];
  arenaQueueIds?: string[];
  basicResults?: BasicMatchResult[];
  serverTime: number;
};

export type ArenaStreamFrame = {
  matchId: string;
  arena: ArenaViewModel;
  arenaState: ArenaState;
  serverTime: number;
};

export type ArenaCheckpoint = {
  version: 1 | 2 | 3;
  matchNumber: number;
  match: MatchState;
  arenaState: ArenaState;
  persistentBots?: PersistentBot[];
  arenaQueueIds: string[];
  basicResults: BasicMatchResult[];
  leagueState?: LeagueState;
  savedAt: number;
};

export class ArenaService {
  private readonly matchConfig = DEFAULT_MATCH_CONFIG;
  private readonly persistentBots = createDefaultPool();
  private arenaQueueIds = this.normalizeQueueIds([]);
  private basicResults: BasicMatchResult[] = [];
  private matchNumber = 1;
  private leagueState = createLeagueState(this.persistentBots);
  private match: MatchState;
  private arenaState: ArenaState;
  private lastTickAt = Date.now();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: { onCheckpointNeeded?: (reason: string) => void; onMatchLogReady?: (log: MatchLog) => void; onMatchCompleted?: (match: MatchState) => void } = {}) {
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

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  getSnapshot(options: { includeRoster?: boolean } = {}): ArenaSnapshot {
    const snapshot: ArenaSnapshot = {
      match: createPublicMatchSnapshot(this.match),
      arenaState: cloneJson(this.arenaState),
      leagueState: cloneJson(this.leagueState),
      serverTime: Date.now(),
    };

    if (options.includeRoster) {
      snapshot.persistentBots = this.persistentBots.map(createPublicPersistentBotSnapshot);
      snapshot.arenaQueueIds = [...this.arenaQueueIds];
      snapshot.basicResults = cloneJson(this.basicResults);
    }

    return snapshot;
  }

  getStreamFrame(): ArenaStreamFrame {
    return {
      matchId: this.match.id,
      arena: toArenaViewModel(createPublicMatchSnapshot(this.match, { thoughtLimit: 0 }), null, [], []),
      arenaState: cloneJson(this.arenaState),
      serverTime: Date.now(),
    };
  }

  getOwnedBots(botIds: string[]): PersistentBot[] {
    const ownedIds = new Set(botIds);
    return cloneJson(this.persistentBots.filter((bot) => bot.custom && ownedIds.has(bot.id)));
  }

  getCheckpoint(): ArenaCheckpoint {
    return {
      version: 3,
      matchNumber: this.matchNumber,
      match: this.match.finalized ? createPublicMatchSnapshot(this.match, { thoughtLimit: 0 }) : cloneJson(this.match),
      arenaState: cloneJson(this.arenaState),
      persistentBots: cloneJson(this.persistentBots),
      arenaQueueIds: [...this.arenaQueueIds],
      basicResults: cloneJson(this.basicResults),
      leagueState: cloneJson(this.leagueState),
      savedAt: Date.now(),
    };
  }

  restore(checkpoint: ArenaCheckpoint): void {
    if (checkpoint.persistentBots?.length) {
      this.persistentBots.splice(0, this.persistentBots.length, ...cloneJson(checkpoint.persistentBots));
    }
    this.matchNumber = checkpoint.matchNumber;
    this.match = cloneJson(checkpoint.match);
    this.arenaState = cloneJson(checkpoint.arenaState);
    this.arenaQueueIds = this.normalizeQueueIds(checkpoint.arenaQueueIds, new Set(this.match.bots.map((bot) => bot.id)));
    this.basicResults = cloneJson(checkpoint.basicResults).slice(0, MAX_BASIC_RESULTS);
    this.leagueState = checkpoint.leagueState ? cloneJson(checkpoint.leagueState) : createLeagueState(this.persistentBots);
    this.lastTickAt = Date.now();
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
    this.leagueState = advanceLeagueSeason(this.leagueState, this.persistentBots);
    this.matchNumber += 1;
    this.match = this.createMatch(this.arenaState.lastWinnerId);
    this.arenaState = this.createRunningArenaState(this.match);
    this.lastTickAt = Date.now();
    return this.getSnapshot();
  }

  sponsorDrop(botId: string, kind: SponsorDropKind): ArenaSnapshot | null {
    return spawnSponsorDrop(this.match, botId, kind) ? this.getSnapshot() : null;
  }

  registerCustomBot(rawBot: unknown, enqueue: boolean): ArenaSnapshot | null {
    const candidate = normalizeCustomBot(rawBot);
    if (!candidate) {
      return null;
    }

    const existingIndex = this.persistentBots.findIndex((bot) => bot.id === candidate.id);
    if (existingIndex === -1) {
      this.persistentBots.unshift(candidate);
      this.leagueState = addLeagueBot(this.leagueState, candidate);
    }

    if (enqueue && !this.match.bots.some((bot) => bot.id === candidate.id)) {
      this.arenaQueueIds = this.normalizeQueueIds([candidate.id, ...this.arenaQueueIds]);
    }

    this.requestCheckpoint(existingIndex === -1 ? "custom bot registered" : "custom bot requeued");
    return this.getSnapshot({ includeRoster: true });
  }

  updateBotDoctrine(botId: string, instruction: string): ArenaSnapshot | null {
    const index = this.persistentBots.findIndex((bot) => bot.id === botId && bot.custom);
    if (index === -1) {
      return null;
    }

    this.persistentBots[index] = applyPersistentBotDoctrine(this.persistentBots[index], instruction);
    this.requestCheckpoint("bot doctrine updated");
    return this.getSnapshot({ includeRoster: true });
  }

  updateOwnerName(ownerId: string, ownerName: string): ArenaSnapshot {
    for (const bot of this.persistentBots) {
      if (bot.ownerId === ownerId) bot.ownerName = ownerName;
    }
    for (const bot of this.match.bots) {
      if (bot.ownerId === ownerId) bot.ownerName = ownerName;
    }
    this.leagueState = {
      ...this.leagueState,
      standings: this.leagueState.standings.map((standing) =>
        this.persistentBots.find((bot) => bot.id === standing.botId)?.ownerId === ownerId
          ? { ...standing, ownerName }
          : standing,
      ),
    };
    this.requestCheckpoint("owner name updated");
    return this.getSnapshot({ includeRoster: true });
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
    const endedAt = Date.now();
    const winner = this.match.winnerId ? this.match.bots.find((bot) => bot.id === this.match.winnerId) ?? null : null;
    this.basicResults = [
      {
        matchNumber: this.matchNumber,
        winnerBotId: winner?.id ?? "no-survivor",
        winnerName: winner?.name ?? "No survivor",
        endedAt,
      },
      ...this.basicResults.filter((result) => result.matchNumber !== this.matchNumber),
    ].slice(0, MAX_BASIC_RESULTS);

    const matchLog: MatchLog = {
      ...createMatchLog(this.matchNumber, this.match, endedAt),
      competition: {
        seasonId: this.leagueState.seasonId,
        seasonNumber: this.leagueState.seasonNumber,
        seasonName: this.leagueState.seasonName,
        eventType: this.leagueState.currentEvent.type,
        eventName: this.leagueState.currentEvent.name,
        matchOfSeason: this.leagueState.currentEvent.matchOfSeason,
      },
    };
    this.options.onMatchLogReady?.(matchLog);
    this.options.onMatchCompleted?.(cloneJson(this.match));
    this.applyPersistentProgression();
    this.leagueState = applyLeagueMatchResult(this.leagueState, this.match, endedAt);
    this.compactCompletedMatch();

    this.arenaState = {
      ...this.arenaState,
      phase: "intermission",
      activeBotIds: this.match.bots.filter((bot) => bot.alive).map((bot) => bot.id),
      lastWinnerId: winner?.id,
      intermissionEndsAt: Date.now() + INTERMISSION_MS,
    };
    this.requestCheckpoint("match finalized");
  }

  private compactCompletedMatch(): void {
    // The complete timeline has moved to match_logs. Keeping it in the arena
    // checkpoint as well duplicates the largest part of every completed match
    // and forces Postgres to rewrite it during later checkpoint updates.
    this.match.logEvents = [];
    this.match.historyEvents = [];
    this.match.learningEvents = [];
    this.match.eventDebounce = {};
  }

  private requestCheckpoint(reason: string): void {
    this.options.onCheckpointNeeded?.(reason);
  }

  private applyPersistentProgression(): void {
    const placements = getPlacements(this.match.bots);
    for (const matchBot of this.match.bots) {
      const persistent = this.persistentBots.find((bot) => bot.id === matchBot.id);
      if (!persistent) {
        continue;
      }

      const placement = placements.get(matchBot.id) ?? this.match.bots.length;
      applyPersistentBotMatchResult(persistent, matchBot, this.match, placement, this.matchNumber);
    }
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
    const featuredIds = getLeagueEntrantIds(this.leagueState, this.matchConfig.roster.matchBotCount);
    const entrants = this.takeQueuedEntrants(carryOverBotId, featuredIds);
    return createMatchFromPool(this.persistentBots, entrants, carryOverBotId, 0, this.matchConfig);
  }

  private createRunningArenaState(match: MatchState): ArenaState {
    return {
      matchNumber: this.matchNumber,
      phase: "running",
      activeBotIds: match.bots.map((bot) => bot.id),
      lastWinnerId: this.arenaState?.lastWinnerId,
    };
  }

  private takeQueuedEntrants(carryOverBotId?: string, featuredIds: string[] = []): PersistentBot[] {
    const carryOverBot = carryOverBotId ? this.persistentBots.find((bot) => bot.id === carryOverBotId) : undefined;
    const selectedIds = new Set<string>(carryOverBot ? [carryOverBot.id] : []);
    const entrants: PersistentBot[] = carryOverBot ? [carryOverBot] : [];
    this.arenaQueueIds = this.normalizeQueueIds(this.arenaQueueIds, selectedIds);

    for (const featuredId of featuredIds) {
      if (entrants.length >= this.matchConfig.roster.matchBotCount || selectedIds.has(featuredId)) {
        break;
      }
      const featuredBot = this.persistentBots.find((bot) => bot.id === featuredId);
      if (!featuredBot) {
        continue;
      }
      entrants.push(featuredBot);
      selectedIds.add(featuredBot.id);
    }

    while (entrants.length < this.matchConfig.roster.matchBotCount) {
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
    return entrants.slice(0, this.matchConfig.roster.matchBotCount);
  }

  private normalizeQueueIds(rawIds: string[], excludedIds = new Set<string>()): string[] {
    const validIds = new Set(this.persistentBots.map((bot) => bot.id));
    const seen = new Set<string>();
    const queueTargetSize = getQueueTargetSize(this.matchConfig);
    const next = rawIds.filter((id) => {
      if (!validIds.has(id) || excludedIds.has(id) || seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    });

    while (next.length < queueTargetSize) {
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

    return next.slice(0, queueTargetSize);
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createPublicMatchSnapshot(match: MatchState, options: { thoughtLimit?: number } = {}): MatchState {
  const thoughtLimit = options.thoughtLimit ?? MAX_PUBLIC_THOUGHTS;
  return {
    ...match,
    bots: match.bots.map((bot) => {
      const { relationships: _relationships, tacticalInstruction: _tacticalInstruction, thoughts, ...publicBot } = bot;
      return {
        ...publicBot,
        relationships: {},
        thoughts: thoughts.slice(0, thoughtLimit),
      };
    }),
    events: match.events.slice(0, MAX_PUBLIC_EVENTS),
    matchEvents: match.matchEvents.slice(0, MAX_PUBLIC_MATCH_EVENTS),
    logEvents: [],
    narrativeMoments: match.narrativeMoments.slice(0, 6),
    historyEvents: [],
    learningEvents: [],
    eventDebounce: {},
  };
}

function createPublicPersistentBotSnapshot(bot: PersistentBot): PersistentBot {
  const { relationships: _relationships, tacticalInstruction: _tacticalInstruction, journal, ...publicBot } = bot;
  return {
    ...publicBot,
    relationships: {},
    journal: journal?.slice(0, MAX_PUBLIC_JOURNAL_ENTRIES),
  };
}

function getPlacements(bots: Bot[]): Map<string, number> {
  return new Map(
    [...bots]
      .sort((a, b) => b.survivalTimeMs - a.survivalTimeMs || b.kills - a.kills || b.damageDealt - a.damageDealt)
      .map((bot, index) => [bot.id, index + 1]),
  );
}

function normalizeCustomBot(value: unknown): PersistentBot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Partial<PersistentBot>;
  if (typeof input.id !== "string" || !/^custom-[a-zA-Z0-9_-]{8,80}$/.test(input.id)) {
    return null;
  }

  const name = typeof input.name === "string" ? input.name.trim().slice(0, 24) : "";
  if (!name) {
    return null;
  }

  const baseStats = normalizeBaseStats(input.baseStats);
  const psychology = normalizePsychology(input.psychology);
  if (!baseStats || !psychology) {
    return null;
  }

  const tacticalInstruction = typeof input.tacticalInstruction === "string" ? input.tacticalInstruction.trim().slice(0, 180) : "";
  const traits = Array.isArray(input.traits)
    ? [...new Set(input.traits.filter((trait): trait is string => typeof trait === "string" && /^[a-z0-9_-]{1,32}$/i.test(trait)))].slice(0, 4)
    : [];

  return {
    id: input.id,
    name,
    level: 1,
    xp: 0,
    baseStats,
    traits,
    psychology,
    career: { matchesPlayed: 0, wins: 0, kills: 0, damageDealt: 0, longestSurvivalTime: 0 },
    relationships: {},
    recentResults: ["Released into the arena."],
    affinities: normalizeAffinities(input.affinities as Partial<BotAffinities> | undefined),
    custom: true,
    ownerId: typeof input.ownerId === "string" && /^[0-9a-f-]{36}$/i.test(input.ownerId) ? input.ownerId : undefined,
    ownerName: typeof input.ownerName === "string" ? input.ownerName.trim().slice(0, 24) : undefined,
    tacticalInstruction,
    doctrineSummary: summarizeDoctrine(tacticalInstruction),
    journal: [
      {
        id: `journal-${Date.now()}-${input.id}-origin`,
        timestamp: Date.now(),
        title: "Released into the ludus",
        body: `${name} entered the arena with a ${summarizeDoctrine(tacticalInstruction).toLowerCase()} doctrine.`,
        tone: "origin",
      },
    ],
  };
}

function normalizeBaseStats(value: PersistentBot["baseStats"] | undefined): BaseStats | null {
  if (!value) return null;
  const keys: Array<keyof BaseStats> = ["strength", "speed", "perception", "endurance"];
  if (!keys.every((key) => Number.isFinite(value[key]))) return null;
  return Object.fromEntries(keys.map((key) => [key, clampNumber(value[key], 1, 20)])) as BaseStats;
}

function normalizePsychology(value: PersistentBot["psychology"] | undefined): Psychology | null {
  if (!value) return null;
  const keys: Array<keyof Psychology> = ["aggression", "loyalty", "opportunism", "selfPreservation", "ambition", "sociability", "vengefulness", "riskTolerance"];
  if (!keys.every((key) => Number.isFinite(value[key]))) return null;
  return Object.fromEntries(keys.map((key) => [key, clampNumber(value[key], 0, 1)])) as Psychology;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
