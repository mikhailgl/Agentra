import type { Bot, LeagueEventType, LeagueState, LeagueStanding, MatchState, PersistentBot } from "./types";

export const MATCHES_PER_SEASON = 20;
const HEADLINE_INTERVAL = 5;
const FORM_LIMIT = 5;
const CHAMPION_HISTORY_LIMIT = 12;
const SEASON_NAMES = ["Founders Circuit", "Iron Ascension", "Rivalry Season", "Legends Rising"];

export function createLeagueState(
  roster: PersistentBot[],
  seasonNumber = 1,
  champions: LeagueState["champions"] = [],
  startedAt = Date.now(),
): LeagueState {
  const state: LeagueState = {
    version: 1,
    seasonId: `season-${seasonNumber}`,
    seasonNumber,
    seasonName: getSeasonName(seasonNumber),
    status: "active",
    startedAt,
    matchesPerSeason: MATCHES_PER_SEASON,
    matchesCompleted: 0,
    currentEvent: createLeagueEvent(0, MATCHES_PER_SEASON),
    standings: roster.map(createStanding),
    champions: champions.slice(0, CHAMPION_HISTORY_LIMIT),
  };
  state.standings = sortStandings(state.standings);
  return state;
}

export function advanceLeagueSeason(state: LeagueState, roster: PersistentBot[], startedAt = Date.now()): LeagueState {
  if (state.status !== "completed") {
    return state;
  }
  return createLeagueState(roster, state.seasonNumber + 1, state.champions, startedAt);
}

export function applyLeagueMatchResult(state: LeagueState, match: MatchState, endedAt = Date.now()): LeagueState {
  if (state.status !== "active") {
    return state;
  }

  const placements = getPlacements(match.bots);
  const fieldAverageRating = match.bots.reduce((sum, bot) => sum + getStanding(state, bot).rating, 0) / Math.max(1, match.bots.length);
  const byBotId = new Map(state.standings.map((standing) => [standing.botId, { ...standing, form: [...standing.form] }]));

  for (const bot of match.bots) {
    const standing = byBotId.get(bot.id) ?? createStandingFromBot(bot);
    const placement = placements.get(bot.id) ?? match.bots.length;
    const won = placement === 1;
    const podium = placement <= Math.min(3, match.bots.length);
    const formResult: LeagueStanding["form"][number] = won ? "W" : podium ? "P" : "F";
    const actualScore = match.bots.length <= 1 ? 1 : (match.bots.length - placement) / (match.bots.length - 1);
    const expectedScore = 1 / (1 + 10 ** ((fieldAverageRating - standing.rating) / 400));
    const ratingDelta = Math.round(36 * (actualScore - expectedScore) + Math.min(8, bot.kills * 2));

    standing.rating = Math.max(100, standing.rating + ratingDelta);
    standing.division = getDivision(standing.rating);
    standing.points += getPlacementPoints(placement) + bot.kills;
    standing.matchesPlayed += 1;
    standing.wins += won ? 1 : 0;
    standing.podiums += podium ? 1 : 0;
    standing.kills += bot.kills;
    standing.damageDealt += bot.damageDealt;
    standing.lastPlacement = placement;
    standing.name = bot.name;
    standing.custom = bot.custom;
    standing.ownerName = bot.ownerName;
    standing.form = [formResult, ...standing.form].slice(0, FORM_LIMIT);
    byBotId.set(bot.id, standing);
  }

  const matchesCompleted = Math.min(state.matchesPerSeason, state.matchesCompleted + 1);
  const standings = sortStandings([...byBotId.values()]);
  const completed = matchesCompleted >= state.matchesPerSeason;
  const leader = standings[0];
  const champions = completed && leader
    ? [
        {
          seasonId: state.seasonId,
          seasonNumber: state.seasonNumber,
          seasonName: state.seasonName,
          botId: leader.botId,
          botName: leader.name,
          points: leader.points,
          wins: leader.wins,
          crownedAt: endedAt,
        },
        ...state.champions.filter((champion) => champion.seasonId !== state.seasonId),
      ].slice(0, CHAMPION_HISTORY_LIMIT)
    : state.champions;

  return {
    ...state,
    status: completed ? "completed" : "active",
    matchesCompleted,
    standings,
    champions,
    currentEvent: completed
      ? { type: "championship", name: `${state.seasonName} complete`, matchOfSeason: matchesCompleted }
      : createLeagueEvent(matchesCompleted, state.matchesPerSeason),
  };
}

export function addLeagueBot(state: LeagueState, bot: PersistentBot): LeagueState {
  if (state.standings.some((standing) => standing.botId === bot.id)) {
    return state;
  }
  return { ...state, standings: sortStandings([...state.standings, createStanding(bot)]) };
}

export function getLeagueEntrantIds(state: LeagueState, count: number): string[] {
  if (state.currentEvent.type === "league_match") {
    return [];
  }
  return state.standings
    .filter((standing) => standing.matchesPlayed > 0)
    .slice(0, count)
    .map((standing) => standing.botId);
}

export function createLeagueEvent(matchesCompleted: number, matchesPerSeason: number): LeagueState["currentEvent"] {
  const matchOfSeason = Math.min(matchesPerSeason, matchesCompleted + 1);
  if (matchOfSeason === matchesPerSeason) {
    return { type: "championship", name: "Season Crown Final", matchOfSeason };
  }
  if (matchOfSeason % HEADLINE_INTERVAL === 0) {
    return { type: "headline", name: `Prime-Time Clash ${matchOfSeason / HEADLINE_INTERVAL}`, matchOfSeason };
  }
  return { type: "league_match", name: `League Match ${matchOfSeason}`, matchOfSeason };
}

export function getEventLabel(type: LeagueEventType): string {
  if (type === "championship") return "Championship";
  if (type === "headline") return "Headline event";
  return "League match";
}

function createStanding(bot: PersistentBot): LeagueStanding {
  return {
    botId: bot.id,
    name: bot.name,
    custom: bot.custom,
    ownerName: bot.ownerName,
    rating: 1_000,
    division: "Silver",
    points: 0,
    matchesPlayed: 0,
    wins: 0,
    podiums: 0,
    kills: 0,
    damageDealt: 0,
    form: [],
  };
}

function createStandingFromBot(bot: Bot): LeagueStanding {
  return {
    botId: bot.id,
    name: bot.name,
    custom: bot.custom,
    ownerName: bot.ownerName,
    rating: 1_000,
    division: "Silver",
    points: 0,
    matchesPlayed: 0,
    wins: 0,
    podiums: 0,
    kills: 0,
    damageDealt: 0,
    form: [],
  };
}

function getStanding(state: LeagueState, bot: Bot): LeagueStanding {
  return state.standings.find((standing) => standing.botId === bot.id) ?? createStandingFromBot(bot);
}

function getPlacementPoints(placement: number): number {
  return [12, 8, 5, 3, 2, 1][placement - 1] ?? 0;
}

function getPlacements(bots: Bot[]): Map<string, number> {
  return new Map(
    [...bots]
      .sort((a, b) => b.survivalTimeMs - a.survivalTimeMs || b.kills - a.kills || b.damageDealt - a.damageDealt)
      .map((bot, index) => [bot.id, index + 1]),
  );
}

function sortStandings(standings: LeagueStanding[]): LeagueStanding[] {
  return [...standings].sort(
    (a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      b.podiums - a.podiums ||
      b.rating - a.rating ||
      b.kills - a.kills ||
      a.name.localeCompare(b.name),
  );
}

function getSeasonName(seasonNumber: number): string {
  const base = SEASON_NAMES[(seasonNumber - 1) % SEASON_NAMES.length];
  const cycle = Math.floor((seasonNumber - 1) / SEASON_NAMES.length);
  return cycle === 0 ? base : `${base} ${cycle + 1}`;
}

function getDivision(rating: number): LeagueStanding["division"] {
  if (rating >= 1_250) return "Diamond";
  if (rating >= 1_100) return "Gold";
  if (rating >= 900) return "Silver";
  return "Bronze";
}
