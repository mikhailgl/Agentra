import type { Bot, GameEvent, MatchState, PersistentBot, Relationship } from "./types";
import { BOT_NAMES } from "./constants";

const HISTORY_STORAGE_KEY = "ai-battle:match-history:v1";
const MAX_MATCH_RECORDS = 100;

export type MatchPlacement = {
  botId: string;
  place: number;
  survivalMs: number;
};

export type MatchKill = {
  killerBotId: string;
  victimBotId: string;
  timeMs: number;
};

export type MatchDamageTotal = {
  botId: string;
  amount: number;
};

export type MatchAlliance = {
  botIds: [string, string];
  timeMs: number;
};

export type MatchBetrayal = {
  betrayerBotId: string;
  victimBotId: string;
  timeMs: number;
};

export type MatchMajorEvent = {
  kind: "kill" | "winner" | "alliance" | "betrayal" | "damage" | "system";
  timeMs: number;
  botId?: string;
  targetId?: string;
  message: string;
};

export type MatchRecord = {
  matchId: string;
  timestamp: number;
  duration: number;
  winnerBotId: string | null;
  placements: MatchPlacement[];
  kills: MatchKill[];
  damageDealt: MatchDamageTotal[];
  alliancesFormed: MatchAlliance[];
  betrayals: MatchBetrayal[];
  majorEvents: MatchMajorEvent[];
};

export type BotTimelineEntry = {
  matchId: string;
  timestamp: number;
  text: string;
  kind: MatchMajorEvent["kind"] | "death";
};

export function loadMatchHistory(): MatchRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as MatchRecord[];
    return Array.isArray(parsed) ? parsed.map(normalizeRecord).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function saveMatchRecord(match: MatchState): MatchRecord {
  const record = createMatchRecord(match);
  const history = [record, ...loadMatchHistory().filter((candidate) => candidate.matchId !== record.matchId)].slice(
    0,
    MAX_MATCH_RECORDS,
  );

  if (typeof window !== "undefined") {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  }

  return record;
}

export function createMatchRecord(match: MatchState): MatchRecord {
  return {
    matchId: match.id,
    timestamp: Date.now(),
    duration: Math.round(match.elapsedMs),
    winnerBotId: match.winnerId,
    placements: getPlacements(match.bots),
    kills: getKillEvents(match.historyEvents ?? match.events),
    damageDealt: match.bots.map((bot) => ({ botId: bot.id, amount: Math.round(bot.damageDealt) })),
    alliancesFormed: getAllianceEvents(match.historyEvents ?? match.events),
    betrayals: getBetrayalEvents(match.historyEvents ?? match.events),
    majorEvents: getMajorEvents(match.historyEvents ?? match.events),
  };
}

export function getBotTimeline(bot: Bot | PersistentBot, history: MatchRecord[], names: Map<string, string>): BotTimelineEntry[] {
  const entries: BotTimelineEntry[] = [];

  for (const record of history) {
    if (record.winnerBotId === bot.id) {
      entries.push({
        matchId: record.matchId,
        timestamp: record.timestamp,
        kind: "winner",
        text: `${bot.name} won after ${formatSeconds(record.duration)}.`,
      });
    }

    for (const kill of record.kills) {
      if (kill.killerBotId === bot.id) {
        entries.push({
          matchId: record.matchId,
          timestamp: record.timestamp,
          kind: "kill",
          text: `${bot.name} eliminated ${label(kill.victimBotId, names)}.`,
        });
      }
      if (kill.victimBotId === bot.id) {
        entries.push({
          matchId: record.matchId,
          timestamp: record.timestamp,
          kind: "death",
          text: `${bot.name} was eliminated by ${label(kill.killerBotId, names)}.`,
        });
      }
    }

    for (const alliance of record.alliancesFormed) {
      if (!alliance.botIds.includes(bot.id)) continue;
      const allyId = alliance.botIds.find((id) => id !== bot.id);
      entries.push({
        matchId: record.matchId,
        timestamp: record.timestamp,
        kind: "alliance",
        text: `${bot.name} allied with ${label(allyId, names)}.`,
      });
    }

    for (const betrayal of record.betrayals) {
      if (betrayal.betrayerBotId === bot.id) {
        entries.push({
          matchId: record.matchId,
          timestamp: record.timestamp,
          kind: "betrayal",
          text: `${bot.name} betrayed ${label(betrayal.victimBotId, names)}.`,
        });
      }
      if (betrayal.victimBotId === bot.id) {
        entries.push({
          matchId: record.matchId,
          timestamp: record.timestamp,
          kind: "betrayal",
          text: `${bot.name} was betrayed by ${label(betrayal.betrayerBotId, names)}.`,
        });
      }
    }
  }

  return entries.slice(0, 10);
}

export function buildPreviouslyOnBeats(history: MatchRecord[], bots: Bot[]): string[] {
  const names = createNameMap(bots);
  const beats: string[] = [];
  const recent = history.slice(0, 12);
  const streak = getRecentWinnerStreak(recent);

  if (streak && streak.count >= 2) {
    beats.push(`${label(streak.botId, names)} enters on a ${streak.count}-match winning streak.`);
  }

  const betrayal = recent.flatMap((record) => record.betrayals.map((event) => ({ ...event, record }))).at(0);
  if (betrayal) {
    beats.push(`${label(betrayal.betrayerBotId, names)} recently betrayed ${label(betrayal.victimBotId, names)}.`);
  }

  const repeatedAlliance = getRepeatedPair(recent.flatMap((record) => record.alliancesFormed.map((event) => event.botIds)));
  if (repeatedAlliance) {
    beats.push(`${label(repeatedAlliance[0], names)} and ${label(repeatedAlliance[1], names)} keep finding reasons to ally.`);
  }

  const revenge = recent.flatMap((record) => record.kills).find((kill) =>
    bots.some((bot) => bot.id === kill.killerBotId) && bots.some((bot) => bot.id === kill.victimBotId),
  );
  if (revenge) {
    beats.push(`${label(revenge.victimBotId, names)} has a revenge chance against ${label(revenge.killerBotId, names)}.`);
  }

  const feared = getMostFearedBot(bots);
  if (feared && feared.score > 1.2) {
    beats.push(`${feared.name} is becoming the bot others most fear.`);
  }

  if (beats.length === 0 && history[0]?.winnerBotId) {
    beats.push(`${label(history[0].winnerBotId, names)} won the previous match.`);
  }

  return beats.slice(0, 5);
}

export function buildPostMatchRecap(record: MatchRecord, bots: Bot[], priorHistory: MatchRecord[]) {
  const names = createNameMap(bots);
  const topKiller = [...bots].sort((a, b) => b.kills - a.kills || b.damageDealt - a.damageDealt)[0] ?? null;
  const topDamage = [...bots].sort((a, b) => b.damageDealt - a.damageDealt)[0] ?? null;
  const longestSurvivor = [...bots].sort((a, b) => b.survivalTimeMs - a.survivalTimeMs)[0] ?? null;
  const strongestAlliance = getRepeatedPair([record.alliancesFormed.map((alliance) => alliance.botIds), ...priorHistory.map((historyRecord) => historyRecord.alliancesFormed.map((alliance) => alliance.botIds))].flat());
  const winner = bots.find((bot) => bot.id === record.winnerBotId) ?? null;
  const upset = winner && winner.career.wins <= 1 && (topKiller?.id !== winner.id || winner.level < Math.max(...bots.map((bot) => bot.level)));

  return {
    winner: winner?.name ?? "No survivor",
    topKiller: topKiller && topKiller.kills > 0 ? `${topKiller.name} (${topKiller.kills})` : "None",
    mostDamage: topDamage && topDamage.damageDealt > 0 ? `${topDamage.name} (${Math.round(topDamage.damageDealt)})` : "None",
    longestSurvivor: longestSurvivor ? `${longestSurvivor.name} (${formatSeconds(longestSurvivor.survivalTimeMs)})` : "None",
    majorBetrayal: record.betrayals[0]
      ? `${label(record.betrayals[0].betrayerBotId, names)} betrayed ${label(record.betrayals[0].victimBotId, names)}`
      : "None",
    strongestAlliance: strongestAlliance
      ? `${label(strongestAlliance[0], names)} and ${label(strongestAlliance[1], names)}`
      : "None",
    biggestUpset: upset ? `${winner.name} won despite a thin career record.` : "None detected",
  };
}

export function createNameMap(bots: Array<Bot | PersistentBot>): Map<string, string> {
  return new Map(bots.map((bot) => [bot.id, bot.name]));
}

export function getRelationshipLeader(
  bot: Bot | PersistentBot,
  names: Map<string, string>,
  key: keyof Omit<Relationship, "alliance">,
): string {
  const entry = Object.entries(bot.relationships ?? {}).sort((a, b) => b[1][key] - a[1][key])[0];
  return entry ? label(entry[0], names) : "None";
}

function getPlacements(bots: Bot[]): MatchPlacement[] {
  return [...bots]
    .sort((a, b) => b.survivalTimeMs - a.survivalTimeMs || b.kills - a.kills || b.damageDealt - a.damageDealt)
    .map((bot, index) => ({ botId: bot.id, place: index + 1, survivalMs: Math.round(bot.survivalTimeMs) }));
}

function getKillEvents(events: GameEvent[]): MatchKill[] {
  return [...events]
    .reverse()
    .filter((event) => event.kind === "kill" && event.botId && event.targetId)
    .map((event) => ({ killerBotId: event.botId as string, victimBotId: event.targetId as string, timeMs: Math.round(event.timeMs) }));
}

function getAllianceEvents(events: GameEvent[]): MatchAlliance[] {
  return [...events]
    .reverse()
    .filter((event) => event.kind === "alliance" && event.botId && event.targetId && event.message.includes("formed an alliance"))
    .map((event) => ({
      botIds: [event.botId as string, event.targetId as string].sort() as [string, string],
      timeMs: Math.round(event.timeMs),
    }));
}

function getBetrayalEvents(events: GameEvent[]): MatchBetrayal[] {
  return [...events]
    .reverse()
    .filter((event) => event.kind === "betrayal" && event.botId && event.targetId)
    .map((event) => ({ betrayerBotId: event.botId as string, victimBotId: event.targetId as string, timeMs: Math.round(event.timeMs) }));
}

function getMajorEvents(events: GameEvent[]): MatchMajorEvent[] {
  return [...events]
    .reverse()
    .filter((event) => isMajorEvent(event))
    .map((event) => ({
      kind: event.kind as MatchMajorEvent["kind"],
      timeMs: Math.round(event.timeMs),
      botId: event.botId,
      targetId: event.targetId,
      message: event.message,
    }))
    .slice(-24);
}

function isMajorEvent(event: GameEvent): boolean {
  if (event.kind === "kill" || event.kind === "winner" || event.kind === "betrayal" || event.kind === "system") return true;
  if (event.kind === "alliance") return event.message.includes("formed an alliance");
  if (event.kind === "damage") return Number(event.label?.replace("-", "")) >= 24;
  return false;
}

function getRecentWinnerStreak(history: MatchRecord[]): { botId: string; count: number } | null {
  const firstWinner = history[0]?.winnerBotId;
  if (!firstWinner) return null;
  let count = 0;
  for (const record of history) {
    if (record.winnerBotId !== firstWinner) break;
    count += 1;
  }
  return { botId: firstWinner, count };
}

function getRepeatedPair(pairs: Array<[string, string]>): [string, string] | null {
  const counts = new Map<string, { pair: [string, string]; count: number }>();
  for (const pair of pairs) {
    const sorted = [...pair].sort() as [string, string];
    const key = sorted.join(":");
    const current = counts.get(key) ?? { pair: sorted, count: 0 };
    counts.set(key, { pair: sorted, count: current.count + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.pair ?? null;
}

function getMostFearedBot(bots: Bot[]): { name: string; score: number } | null {
  const scores = bots.map((bot) => ({
    name: bot.name,
    score: bots.reduce((total, other) => total + (other.relationships?.[bot.id]?.fear ?? 0), 0),
  }));
  return scores.sort((a, b) => b.score - a.score)[0] ?? null;
}

function normalizeRecord(record: MatchRecord): MatchRecord {
  return {
    matchId: record.matchId,
    timestamp: record.timestamp,
    duration: record.duration,
    winnerBotId: record.winnerBotId ?? null,
    placements: record.placements ?? [],
    kills: record.kills ?? [],
    damageDealt: record.damageDealt ?? [],
    alliancesFormed: record.alliancesFormed ?? [],
    betrayals: record.betrayals ?? [],
    majorEvents: record.majorEvents ?? [],
  };
}

function label(id: string | undefined | null, names: Map<string, string>): string {
  return id ? names.get(id) ?? fallbackNameForBotId(id) : "Unknown";
}

function formatSeconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

function fallbackNameForBotId(id: string): string {
  const index = Number(id.replace("bot-", "")) - 1;
  return BOT_NAMES[index] ?? id;
}
