import { CONTEST_ENTRY_FEE } from "./constants";
import { saveRemoteGameState } from "./remotePersistence";
import type { Bet, BetResolution, BetType, Bot, MatchState, Nudge, PlayerState } from "./types";

const PLAYER_STORAGE_KEY = "ai-battle:player-state:v1";
const STARTING_CREDITS = 1000;
export const MIN_BET_AMOUNT = 25;
export const BOT_CONTEST_ENTRY_FEE = CONTEST_ENTRY_FEE;
export const CUSTOM_BOT_CREATION_COST = CONTEST_ENTRY_FEE;
export const DRAFT_COST = 300;
export const MAX_DRAFTED_BOTS = 5;
export const MAX_NUDGES_PER_MATCH = 3;
export const NUDGE_COOLDOWN_MS = 30_000;

export function loadPlayerState(): PlayerState {
  if (typeof window === "undefined") {
    return createDefaultPlayerState();
  }

  const raw = window.localStorage.getItem(PLAYER_STORAGE_KEY);
  if (!raw) {
    const state = createDefaultPlayerState();
    savePlayerState(state);
    return state;
  }

  try {
    return normalizePlayerState(JSON.parse(raw) as Partial<PlayerState>);
  } catch {
    const state = createDefaultPlayerState();
    savePlayerState(state);
    return state;
  }
}

export function getPlayerState(): PlayerState {
  return loadPlayerState();
}

export function savePlayerState(state: PlayerState): void {
  if (typeof window === "undefined") {
    return;
  }
  const normalizedState = normalizePlayerState(state);
  window.localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(normalizedState));
  saveRemoteGameState({ playerState: normalizedState });
}

export function addCredits(amount: number): PlayerState {
  const state = getPlayerState();
  const nextState = awardCredits(state, amount);
  savePlayerState(nextState);
  return nextState;
}

export function canAfford(amount: number): boolean {
  const creditAmount = normalizeCreditAmount(amount);
  return creditAmount !== null && getPlayerState().credits >= creditAmount;
}

export function spendCredits(amount: number): PlayerState | null;
export function spendCredits(state: PlayerState, amount: number): PlayerState | null;
export function spendCredits(stateOrAmount: PlayerState | number, maybeAmount?: number): PlayerState | null {
  const state = typeof stateOrAmount === "number" ? getPlayerState() : stateOrAmount;
  const rawAmount = typeof stateOrAmount === "number" ? stateOrAmount : maybeAmount;
  const amount = normalizeCreditAmount(rawAmount);
  if (amount === null) {
    return null;
  }
  if (state.credits < amount) {
    return null;
  }
  const nextState = { ...state, credits: state.credits - amount };
  if (typeof stateOrAmount === "number") {
    savePlayerState(nextState);
  }
  return nextState;
}

export function awardCredits(state: PlayerState, amount: number): PlayerState {
  const creditAmount = normalizeCreditAmount(amount);
  if (creditAmount === null) {
    return state;
  }
  return { ...state, credits: state.credits + creditAmount };
}

export function draftBot(state: PlayerState, botId: string): PlayerState | null {
  if (state.draftedBotIds.includes(botId) || state.draftedBotIds.length >= MAX_DRAFTED_BOTS || state.credits < DRAFT_COST) {
    return null;
  }

  return {
    ...state,
    credits: state.credits - DRAFT_COST,
    draftedBotIds: [...state.draftedBotIds, botId],
  };
}

export function undraftBot(state: PlayerState, botId: string): PlayerState {
  return {
    ...state,
    draftedBotIds: state.draftedBotIds.filter((id) => id !== botId),
  };
}

export function placeBet(
  state: PlayerState,
  match: MatchState,
  type: BetType,
  botId: string,
  amount: number,
  odds: number,
): PlayerState | null {
  const roundedAmount = Math.floor(amount);
  if (match.ended || roundedAmount < MIN_BET_AMOUNT || roundedAmount > state.credits || !match.bots.some((bot) => bot.id === botId)) {
    return null;
  }

  const bet: Bet = {
    id: `bet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    matchId: match.id,
    type,
    botId,
    amount: roundedAmount,
    odds: normalizeOdds(odds),
    status: "pending",
  };

  return {
    ...state,
    credits: state.credits - roundedAmount,
    bets: [...state.bets, bet],
    stats: {
      ...state.stats,
      totalBetsPlaced: state.stats.totalBetsPlaced + 1,
    },
  };
}

export function refundStalePendingBets(state: PlayerState, currentMatchId: string): PlayerState {
  const stale = state.bets.filter((bet) => bet.matchId !== currentMatchId && bet.status === "pending");
  if (stale.length === 0) {
    return state;
  }

  return {
    ...state,
    credits: state.credits + stale.reduce((sum, bet) => sum + bet.amount, 0),
    bets: state.bets.filter((bet) => bet.matchId === currentMatchId || bet.status !== "pending"),
  };
}

export function calculateBotOdds(bot: Bot): number {
  const averageKills = bot.career.matchesPlayed > 0 ? bot.career.kills / bot.career.matchesPlayed : 0;
  const traitsBonus = bot.traits.length * 0.35;
  const powerScore = bot.level + bot.career.wins * 2 + averageKills + traitsBonus + bot.baseStats.strength * 0.08 + bot.baseStats.speed * 0.06;
  return Math.max(0.5, powerScore);
}

export function getSharedOdds(bot: Bot, field: Bot[]): number {
  const botPower = calculateBotOdds(bot);
  const averagePower = field.reduce((sum, candidate) => sum + calculateBotOdds(candidate), 0) / Math.max(1, field.length);
  return normalizeOdds((averagePower / botPower) * 2.2);
}

export function getOddsForBetType(bot: Bot, field: Bot[], type: BetType): number {
  const shared = getSharedOdds(bot, field);
  const multiplier: Record<BetType, number> = {
    winner: 1.18,
    top3: 0.72,
    mostKills: 1.08,
    firstEliminated: 0.96,
  };
  return normalizeOdds(shared * multiplier[type]);
}

export function resolveMatchBets(state: PlayerState, match: MatchState): { state: PlayerState; results: BetResolution[] } {
  const pending = state.bets.filter((bet) => bet.matchId === match.id && bet.status === "pending");
  if (pending.length === 0) {
    return { state: { ...state, bets: state.bets.filter((bet) => bet.matchId !== match.id) }, results: [] };
  }

  const top3Ids = [...match.bots]
    .sort((a, b) => b.survivalTimeMs - a.survivalTimeMs || b.kills - a.kills || b.damageDealt - a.damageDealt)
    .slice(0, 3)
    .map((bot) => bot.id);
  const topKillCount = Math.max(...match.bots.map((bot) => bot.kills));
  const firstEliminatedId = [...match.bots]
    .filter((bot) => !bot.alive)
    .sort((a, b) => a.survivalTimeMs - b.survivalTimeMs || a.kills - b.kills)[0]?.id;

  let credits = state.credits;
  let totalWinnings = 0;
  let biggestPayout = state.stats.biggestPayout;
  const results = pending.map((bet) => {
    const won =
      (bet.type === "winner" && bet.botId === match.winnerId) ||
      (bet.type === "top3" && top3Ids.includes(bet.botId)) ||
      (bet.type === "mostKills" && topKillCount > 0 && (match.bots.find((bot) => bot.id === bet.botId)?.kills ?? -1) === topKillCount) ||
      (bet.type === "firstEliminated" && bet.botId === firstEliminatedId);
    const payout = won ? Math.floor(bet.amount * bet.odds) : 0;
    credits += payout;
    totalWinnings += payout;
    biggestPayout = Math.max(biggestPayout, payout);
    const resolvedBet: Bet = { ...bet, status: won ? "won" : "lost", payout };
    return {
      bet: resolvedBet,
      botName: match.bots.find((bot) => bot.id === bet.botId)?.name ?? "Unknown bot",
      net: payout - bet.amount,
    };
  });

  return {
    state: {
      ...state,
      credits,
      bets: state.bets.filter((bet) => bet.matchId !== match.id),
      betHistory: [...results.map((result) => result.bet), ...state.betHistory].slice(0, 80),
      stats: {
        ...state.stats,
        totalBetWinnings: state.stats.totalBetWinnings + totalWinnings,
        biggestPayout,
      },
    },
    results,
  };
}

export function recordNudge(state: PlayerState, nudge: Nudge): PlayerState {
  return {
    ...state,
    nudgeHistory: [nudge, ...state.nudgeHistory].slice(0, 120),
    stats: {
      ...state.stats,
      totalNudgesUsed: state.stats.totalNudgesUsed + 1,
    },
  };
}

export function getBetTypeLabel(type: BetType): string {
  if (type === "winner") return "Winner";
  if (type === "top3") return "Top 3";
  if (type === "mostKills") return "Most kills";
  return "First out";
}

function createDefaultPlayerState(): PlayerState {
  return {
    accountId: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    accountName: "Guest account",
    credits: STARTING_CREDITS,
    favoriteBotIds: [],
    draftedBotIds: [],
    bets: [],
    betHistory: [],
    nudgeHistory: [],
    stats: {
      totalBetsPlaced: 0,
      totalBetWinnings: 0,
      totalSponsorshipsSent: 0,
      totalNudgesUsed: 0,
      biggestPayout: 0,
    },
  };
}

function normalizePlayerState(state: Partial<PlayerState>): PlayerState {
  const fallback = createDefaultPlayerState();
  const accountId = typeof state.accountId === "string" && state.accountId ? state.accountId : fallback.accountId;
  const accountName = typeof state.accountName === "string" && state.accountName.trim() ? state.accountName.trim().slice(0, 32) : fallback.accountName;
  return {
    accountId,
    accountName,
    credits: Number.isFinite(state.credits) ? Math.max(0, Math.floor(state.credits ?? STARTING_CREDITS)) : fallback.credits,
    favoriteBotIds: Array.isArray(state.favoriteBotIds) ? [...new Set(state.favoriteBotIds.filter(Boolean))] : [],
    draftedBotIds: Array.isArray(state.draftedBotIds) ? [...new Set(state.draftedBotIds.filter(Boolean))].slice(0, MAX_DRAFTED_BOTS) : [],
    bets: Array.isArray(state.bets) ? state.bets.filter(isValidBet).map(normalizeBet) : [],
    betHistory: Array.isArray(state.betHistory) ? state.betHistory.filter(isValidBet).map(normalizeBet).slice(0, 80) : [],
    nudgeHistory: Array.isArray(state.nudgeHistory) ? state.nudgeHistory.filter(isValidNudge).slice(0, 120) : [],
    stats: {
      ...fallback.stats,
      ...state.stats,
      totalBetsPlaced: Math.max(0, Math.floor(state.stats?.totalBetsPlaced ?? 0)),
      totalBetWinnings: Math.max(0, Math.floor(state.stats?.totalBetWinnings ?? 0)),
      totalSponsorshipsSent: Math.max(0, Math.floor(state.stats?.totalSponsorshipsSent ?? 0)),
      totalNudgesUsed: Math.max(0, Math.floor(state.stats?.totalNudgesUsed ?? 0)),
      biggestPayout: Math.max(0, Math.floor(state.stats?.biggestPayout ?? 0)),
    },
  };
}

function normalizeCreditAmount(amount: number | undefined): number | null {
  if (amount === undefined || !Number.isFinite(amount)) {
    return null;
  }
  const creditAmount = Math.floor(amount);
  return creditAmount > 0 ? creditAmount : null;
}

function normalizeBet(bet: Bet): Bet {
  return {
    ...bet,
    amount: Math.max(0, Math.floor(bet.amount)),
    odds: normalizeOdds(bet.odds),
    payout: bet.payout === undefined ? undefined : Math.max(0, Math.floor(bet.payout)),
  };
}

function normalizeOdds(odds: number): number {
  if (!Number.isFinite(odds)) {
    return 2;
  }
  return Math.round(Math.max(1.3, Math.min(5, odds)) * 100) / 100;
}

function isValidBet(bet: Bet): boolean {
  return Boolean(bet?.id && bet.matchId && bet.botId && ["winner", "top3", "mostKills", "firstEliminated"].includes(bet.type));
}

function isValidNudge(nudge: Nudge): boolean {
  return Boolean(nudge?.id && nudge.matchId && nudge.targetBotId && ["aggression", "defense", "revenge", "reveal"].includes(nudge.type));
}
