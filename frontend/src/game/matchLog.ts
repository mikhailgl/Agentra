import type { MatchLog, MatchState } from "./types";

export function createMatchLog(matchNumber: number, match: MatchState, endedAt = Date.now()): MatchLog {
  const winner = match.winnerId ? match.bots.find((bot) => bot.id === match.winnerId) ?? null : null;

  return {
    version: 1,
    id: `${match.id}-log-v1`,
    matchId: match.id,
    matchNumber,
    startedAt: endedAt - match.elapsedMs,
    endedAt,
    durationMs: match.elapsedMs,
    winnerBotId: winner?.id ?? null,
    winnerName: winner?.name ?? null,
    entrants: match.bots.map((bot) => ({
      botId: bot.id,
      name: bot.name,
      level: bot.level,
      custom: bot.custom,
      traits: [...bot.traits],
    })),
    botResults: match.bots.map((bot) => ({
      botId: bot.id,
      name: bot.name,
      alive: bot.alive,
      kills: bot.kills,
      damageDealt: Math.round(bot.damageDealt),
      survivalTimeMs: bot.survivalTimeMs,
      finalHealth: Math.round(bot.health),
      carriedCredits: bot.carriedCredits,
    })),
    events: [...(match.logEvents?.length ? match.logEvents : match.historyEvents ?? [])].sort((a, b) => a.timeMs - b.timeMs || a.id - b.id),
    highlights: [...(match.matchEvents ?? [])].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)),
    narrativeMoments: [...(match.narrativeMoments ?? [])].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    arenaEvents: [...(match.arenaEvents ?? [])].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)),
  };
}
