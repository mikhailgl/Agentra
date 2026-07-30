import { createHash, randomBytes, randomUUID } from "node:crypto";
import { awardCredits, createDefaultPlayerState, placeBet, resolveMatchBets } from "../../frontend/src/game/player.js";
import type { BetType, FantasyLeaderboardEntry, MatchState, PlayerState } from "../../frontend/src/game/types.js";
import type { PlayerAccountStore, StoredPlayerAccount } from "./playerAccountRepository.js";

const SESSION_TOKEN_BYTES = 32;
const RECOVERY_TOKEN_BYTES = 18;
const MAX_MUTATION_RETRIES = 4;

export class InvalidPlayerSessionError extends Error {
  constructor() {
    super("A valid player session is required");
  }
}

export class PlayerActionError extends Error {}

export class PlayerService {
  constructor(private readonly store: PlayerAccountStore) {}

  async openSession(rawToken?: string, bootstrap?: { ownedBotIds?: string[] }): Promise<{ state: PlayerState; sessionToken?: string; recoveryCode?: string }> {
    if (rawToken) {
      const existing = await this.store.findByTokenHash(hashToken(rawToken));
      if (existing) return { state: existing.state };
    }

    const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    const recoveryCode = formatRecoveryCode(randomBytes(RECOVERY_TOKEN_BYTES).toString("hex"));
    const accountId = randomUUID();
    const accountName = `Guest ${accountId.slice(0, 5).toUpperCase()}`;
    const state = createDefaultPlayerState(accountId, accountName);
    let created = await this.store.create(accountId, hashToken(sessionToken), hashToken(normalizeRecoveryCode(recoveryCode)), state);
    const legacyIds = [...new Set(bootstrap?.ownedBotIds?.filter((id) => /^custom-[a-zA-Z0-9_-]{8,80}$/.test(id)) ?? [])].slice(0, 100);
    const claimedIds: string[] = [];
    for (const botId of legacyIds) {
      if (await this.store.claimBot(accountId, botId)) claimedIds.push(botId);
    }
    if (claimedIds.length > 0) {
      const migrated = await this.store.save(accountId, { ...created.state, ownedBotIds: claimedIds }, created.revision);
      if (migrated) created = migrated;
    }
    return { state: created.state, sessionToken, recoveryCode };
  }

  async recoverSession(rawRecoveryCode: string): Promise<{ state: PlayerState; sessionToken: string }> {
    const normalized = normalizeRecoveryCode(rawRecoveryCode);
    if (normalized.length !== RECOVERY_TOKEN_BYTES * 2) throw new InvalidPlayerSessionError();
    const account = await this.store.findByRecoveryTokenHash(hashToken(normalized));
    if (!account) throw new InvalidPlayerSessionError();
    const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    const rotated = await this.store.rotateSessionToken(account.id, hashToken(sessionToken));
    return { state: rotated.state, sessionToken };
  }

  async rotateRecoveryCode(rawToken: string | undefined): Promise<{ state: PlayerState; recoveryCode: string }> {
    const account = await this.requireAccount(rawToken);
    const recoveryCode = formatRecoveryCode(randomBytes(RECOVERY_TOKEN_BYTES).toString("hex"));
    const updated = await this.store.rotateRecoveryToken(account.id, hashToken(normalizeRecoveryCode(recoveryCode)));
    return { state: updated.state, recoveryCode };
  }

  async updateAccountName(rawToken: string | undefined, rawName: string): Promise<PlayerState> {
    const name = rawName.trim().replace(/\s+/g, " ").slice(0, 24);
    if (name.length < 3 || !/^[a-zA-Z0-9][a-zA-Z0-9 _-]+$/.test(name)) {
      throw new PlayerActionError("Arena name must be 3–24 letters, numbers, spaces, underscores, or dashes");
    }
    return this.mutate(rawToken, (state) => ({ ...state, accountName: name }));
  }

  async getState(rawToken: string | undefined): Promise<PlayerState> {
    return (await this.requireAccount(rawToken)).state;
  }

  async placeBet(
    rawToken: string | undefined,
    match: MatchState,
    input: { type: BetType; botId: string; amount: number; odds: number },
  ): Promise<PlayerState> {
    return this.mutate(rawToken, (state) => {
      const next = placeBet(state, match, input.type, input.botId, input.amount, input.odds);
      if (!next) throw new PlayerActionError("That prediction could not be placed");
      return next;
    });
  }

  async charge(rawToken: string | undefined, amount: number): Promise<PlayerState> {
    return this.mutate(rawToken, (state) => {
      if (!Number.isFinite(amount) || amount <= 0 || state.credits < amount) {
        throw new PlayerActionError("Not enough credits");
      }
      return { ...state, credits: state.credits - Math.floor(amount) };
    });
  }

  async refund(rawToken: string | undefined, amount: number): Promise<PlayerState> {
    return this.mutate(rawToken, (state) => ({ ...state, credits: state.credits + Math.max(0, Math.floor(amount)) }));
  }

  async recordSponsorship(rawToken: string | undefined): Promise<PlayerState> {
    return this.mutate(rawToken, (state) => ({
      ...state,
      stats: { ...state.stats, totalSponsorshipsSent: state.stats.totalSponsorshipsSent + 1 },
    }));
  }

  async claimBot(rawToken: string | undefined, botId: string, cost: number): Promise<PlayerState> {
    const account = await this.requireAccount(rawToken);
    if (account.state.ownedBotIds.includes(botId)) throw new PlayerActionError("That fighter is already owned");
    if (account.state.credits < cost) throw new PlayerActionError("Not enough credits");
    if (!await this.store.claimBot(account.id, botId)) throw new PlayerActionError("That fighter already belongs to another player");
    try {
      return (await this.mutateAccount(account, (state) => {
        if (state.credits < cost) throw new PlayerActionError("Not enough credits");
        return { ...state, credits: state.credits - cost, ownedBotIds: [...state.ownedBotIds, botId] };
      })).state;
    } catch (error) {
      await this.store.releaseBot(account.id, botId);
      throw error;
    }
  }

  async releaseBotClaim(rawToken: string | undefined, botId: string, refund: number): Promise<PlayerState> {
    const account = await this.requireAccount(rawToken);
    const next = await this.mutateAccount(account, (state) => ({
      ...state,
      credits: state.credits + Math.max(0, Math.floor(refund)),
      ownedBotIds: state.ownedBotIds.filter((id) => id !== botId),
    }));
    await this.store.releaseBot(account.id, botId);
    return next.state;
  }

  async requireOwnedBot(rawToken: string | undefined, botId: string): Promise<PlayerState> {
    const state = await this.getState(rawToken);
    if (!state.ownedBotIds.includes(botId)) throw new PlayerActionError("You do not own that fighter");
    return state;
  }

  async setFantasyRoster(rawToken: string | undefined, botIds: string[], validBotIds: Set<string>, seasonId: string): Promise<PlayerState> {
    const uniqueIds = [...new Set(botIds)].filter((id) => validBotIds.has(id));
    if (uniqueIds.length !== botIds.length || uniqueIds.length > 5) {
      throw new PlayerActionError("Choose up to five valid fighters for your fantasy roster");
    }
    return this.mutate(rawToken, (state) => ({
      ...state,
      draftedBotIds: uniqueIds,
      fantasy: state.fantasy.seasonId === seasonId
        ? state.fantasy
        : { seasonId, points: 0, scoredMatchIds: [], history: [] },
    }));
  }

  async setFavoriteBot(rawToken: string | undefined, botId: string, favorite: boolean, validBotIds: Set<string>): Promise<PlayerState> {
    if (!validBotIds.has(botId)) throw new PlayerActionError("Fighter not found");
    return this.mutate(rawToken, (state) => ({
      ...state,
      favoriteBotIds: favorite
        ? [...new Set([...state.favoriteBotIds, botId])].slice(0, 100)
        : state.favoriteBotIds.filter((id) => id !== botId),
    }));
  }

  async scoreFantasyMatch(match: MatchState, seasonId: string): Promise<void> {
    const botIds = match.bots.map((bot) => bot.id);
    const accounts = await this.store.listFantasyCandidates(botIds);
    const placements = new Map(
      [...match.bots]
        .sort((a, b) => b.survivalTimeMs - a.survivalTimeMs || b.kills - a.kills || b.damageDealt - a.damageDealt)
        .map((bot, index) => [bot.id, index + 1]),
    );
    await Promise.all(accounts.map((account) => this.mutateAccount(account, (state) => {
      const currentFantasy = state.fantasy.seasonId === seasonId
        ? state.fantasy
        : { seasonId, points: 0, scoredMatchIds: [], history: [] };
      if (currentFantasy.scoredMatchIds.includes(match.id)) return state;
      const fighterScores = match.bots
        .filter((bot) => state.draftedBotIds.includes(bot.id))
        .map((bot) => {
          const placement = placements.get(bot.id) ?? match.bots.length;
          const points = getFantasyPlacementPoints(placement) + bot.kills * 2 + Math.floor(bot.damageDealt / 50);
          return { botId: bot.id, botName: bot.name, points, placement, kills: bot.kills };
        });
      if (fighterScores.length === 0) return state;
      const matchPoints = fighterScores.reduce((sum, score) => sum + score.points, 0);
      return {
        ...state,
        fantasy: {
          seasonId,
          points: currentFantasy.points + matchPoints,
          scoredMatchIds: [match.id, ...currentFantasy.scoredMatchIds].slice(0, 200),
          history: [
            { matchId: match.id, scoredAt: Date.now(), points: matchPoints, fighterScores },
            ...currentFantasy.history,
          ].slice(0, 30),
        },
      };
    })));
  }

  listFantasyLeaderboard(seasonId: string, limit = 50): Promise<FantasyLeaderboardEntry[]> {
    return this.store.listFantasyLeaderboard(seasonId, limit);
  }

  async resolveMatch(match: MatchState): Promise<void> {
    const winner = match.winnerId ? match.bots.find((bot) => bot.id === match.winnerId) : undefined;
    const accounts = await this.store.listSettlementCandidates(match.id, winner?.custom ? winner.id : undefined);
    const affected = accounts.filter((account) =>
      account.state.bets.some((bet) => bet.matchId === match.id && bet.status === "pending") ||
      Boolean(winner?.custom && winner.carriedCredits > 0 && account.state.ownedBotIds.includes(winner.id)),
    );
    await Promise.all(affected.map((account) => this.mutateAccount(account, (state) => {
      if (state.settledMatchIds.includes(match.id)) return state;
      const resolved = resolveMatchBets(state, match).state;
      const prize = winner?.custom && state.ownedBotIds.includes(winner.id) ? winner.carriedCredits : 0;
      const rewarded = prize > 0 ? awardCredits(resolved, prize) : resolved;
      return { ...rewarded, settledMatchIds: [match.id, ...rewarded.settledMatchIds].slice(0, 200) };
    })));
  }

  private async mutate(rawToken: string | undefined, transform: (state: PlayerState) => PlayerState): Promise<PlayerState> {
    const account = await this.requireAccount(rawToken);
    return (await this.mutateAccount(account, transform)).state;
  }

  private async mutateAccount(initial: StoredPlayerAccount, transform: (state: PlayerState) => PlayerState): Promise<StoredPlayerAccount> {
    let account = initial;
    for (let attempt = 0; attempt < MAX_MUTATION_RETRIES; attempt += 1) {
      const saved = await this.store.save(account.id, transform(account.state), account.revision);
      if (saved) return saved;
      const refreshed = await this.store.findByTokenHash(account.tokenHash);
      if (!refreshed) throw new InvalidPlayerSessionError();
      account = refreshed;
    }
    throw new PlayerActionError("Player state changed too quickly; try again");
  }

  private async requireAccount(rawToken: string | undefined): Promise<StoredPlayerAccount> {
    if (!rawToken || rawToken.length < 32 || rawToken.length > 200) throw new InvalidPlayerSessionError();
    const account = await this.store.findByTokenHash(hashToken(rawToken));
    if (!account) throw new InvalidPlayerSessionError();
    return account;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-f0-9]/g, "");
}

function formatRecoveryCode(hex: string): string {
  return hex.match(/.{1,6}/g)?.join("-") ?? hex;
}

function getFantasyPlacementPoints(placement: number): number {
  return [10, 6, 4, 3, 2, 1][placement - 1] ?? 0;
}
