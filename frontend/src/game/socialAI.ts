import { ALLIANCE_MAX_MS, ALLIANCE_MIN_MS, SOCIAL_SCAN_RANGE } from "./constants";
import { distance } from "./math";
import { areAllied, getActiveAlly, getPerceptionRange, getRelationship } from "./relationships";
import { getTraitModifier } from "./traits";
import type { Bot, MatchState } from "./types";

export type SocialDecision =
  | { action: "attack"; target: Bot; reason: string }
  | { action: "avoid"; target: Bot; reason: string }
  | { action: "follow"; target: Bot; reason: string }
  | { action: "propose_alliance"; target: Bot; reason: string; durationMs: number }
  | { action: "maintain_alliance"; target: Bot; reason: string }
  | { action: "betray"; target: Bot; reason: string }
  | { action: "ignore" };

export function evaluateSocialDecision(bot: Bot, match: MatchState): SocialDecision {
  const ally = getActiveAlly(bot, match);
  if (ally) {
    const betrayal = scoreBetrayal(bot, ally);
    if (betrayal > 0.72) {
      return { action: "betray", target: ally, reason: "opportunity" };
    }
    if (distance(bot, ally) > 125) {
      return { action: "maintain_alliance", target: ally, reason: "regroup" };
    }
  }

  const candidates = nearbyBots(bot, match);
  if (!candidates.length) {
    return { action: "ignore" };
  }

  const scored = candidates
    .map((target) => ({ target, scores: scoreTarget(bot, target, match) }))
    .sort((a, b) => Math.max(...Object.values(b.scores)) - Math.max(...Object.values(a.scores)))[0];

  if (!scored) return { action: "ignore" };

  const { target, scores } = scored;
  const best = bestScore(scores);

  if (best.key === "avoid" && best.value > 0.54) return { action: "avoid", target, reason: "fear" };
  if (best.key === "alliance" && best.value > 0.62) {
    return {
      action: "propose_alliance",
      target,
      reason: estimateBotStrength(target) >= estimateBotStrength(bot) ? "strong ally" : "mutual safety",
      durationMs: ALLIANCE_MIN_MS + Math.floor((1 - bot.psychology.loyalty + bot.psychology.sociability) * 0.5 * (ALLIANCE_MAX_MS - ALLIANCE_MIN_MS)),
    };
  }
  if (best.key === "follow" && best.value > 0.58) return { action: "follow", target, reason: "respect" };
  if (best.key === "attack" && best.value > 0.56) return { action: "attack", target, reason: "hostility" };

  return { action: "ignore" };
}

export function estimateBotStrength(bot: Bot): number {
  const weapon = bot.inventory.weapon;
  const weaponScore = weapon ? weapon.damage * 2.2 + weapon.range * 0.08 : 0;
  const statsScore =
    bot.baseStats.strength * 4 +
    bot.baseStats.speed * 2.2 +
    bot.baseStats.perception * 1.7 +
    bot.baseStats.endurance * 3;
  const traitScore = getTraitModifier(bot, "strengthBonus") * 35 + getTraitModifier(bot, "perceptionBonus") * 18;

  return bot.health * 0.7 + weaponScore + statsScore + bot.level * 9 + traitScore;
}

export function shouldRefuseAttackForTrust(attacker: Bot, target: Bot, match: MatchState): boolean {
  const relationship = getRelationship(attacker, target.id);
  return relationship.trust > 0.74 && relationship.resentment < 0.28 && !areAllied(attacker, target, match.elapsedMs);
}

function nearbyBots(bot: Bot, match: MatchState): Bot[] {
  const range = Math.max(SOCIAL_SCAN_RANGE, getPerceptionRange(bot));
  return match.bots.filter(
    (candidate) => candidate.alive && candidate.id !== bot.id && distance(bot, candidate) <= range,
  );
}

function scoreTarget(bot: Bot, target: Bot, match: MatchState) {
  const relationship = getRelationship(bot, target.id);
  const strength = estimateBotStrength(bot);
  const targetStrength = estimateBotStrength(target);
  const relative = targetStrength / Math.max(1, strength);
  const allied = areAllied(bot, target, match.elapsedMs);

  if (allied) {
    return {
      attack: 0,
      avoid: 0,
      follow: 0.4 + relationship.respect * 0.35 + bot.psychology.loyalty * 0.2,
      alliance: 0,
    };
  }

  return {
    attack:
      bot.psychology.aggression * 0.34 +
      bot.psychology.vengefulness * relationship.resentment * 0.36 +
      (1 - relationship.trust) * 0.13 +
      (relative < 0.8 ? bot.psychology.opportunism * 0.18 : 0) +
      getTraitModifier(bot, "strengthBonus"),
    avoid:
      bot.psychology.selfPreservation * 0.3 +
      relationship.fear * 0.33 +
      (relative > 1.15 ? (1 - bot.psychology.riskTolerance) * 0.22 : 0) +
      getTraitModifier(bot, "fleeBonus"),
    follow:
      relationship.respect * 0.36 +
      bot.psychology.ambition * (relative >= 1 ? 0.18 : 0) +
      bot.psychology.sociability * 0.14,
    alliance:
      bot.psychology.sociability * 0.28 +
      relationship.trust * 0.25 +
      relationship.respect * 0.16 +
      bot.psychology.ambition * (relative >= 0.9 ? 0.16 : 0) -
      relationship.resentment * 0.24,
  };
}

function scoreBetrayal(bot: Bot, ally: Bot): number {
  const relationship = getRelationship(bot, ally.id);
  const allyWeak = estimateBotStrength(ally) < estimateBotStrength(bot) * 0.72 ? 0.18 : 0;
  const lootValue = ally.inventory.weapon ? ally.inventory.weapon.damage / 100 : 0;
  return (
    bot.psychology.opportunism * 0.35 +
    bot.psychology.ambition * 0.16 +
    relationship.resentment * 0.22 +
    lootValue +
    allyWeak -
    bot.psychology.loyalty * 0.34 -
    relationship.trust * 0.22
  );
}

function bestScore(scores: Record<string, number>): { key: string; value: number } {
  return Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([key, value]) => ({ key, value }))[0];
}
