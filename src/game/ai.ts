import {
  FLEE_ENEMY_RANGE,
  VISIBLE_ENEMY_RANGE,
  WANDER_TARGET_RADIUS,
} from "./constants";
import { getBiomeAt } from "./biomes";
import { distance, randomPointInCircle } from "./math";
import { createRng } from "./random";
import { areAllied, getRelationship } from "./relationships";
import { evaluateSocialDecision, shouldRefuseAttackForTrust } from "./socialAI";
import { getTraitModifier } from "./traits";
import type { Bot, LootItem, MatchState, Point } from "./types";

export type BotDecision =
  | { action: "flee"; target: Bot }
  | { action: "seek_loot"; target: LootItem }
  | { action: "attack"; target: Bot }
  | { action: "chase"; target: Bot }
  | { action: "avoid"; target: Bot; reason: string }
  | { action: "follow"; target: Bot; reason: string }
  | { action: "propose_alliance"; target: Bot; reason: string; durationMs: number }
  | { action: "maintain_alliance"; target: Bot; reason: string }
  | { action: "betray"; target: Bot; reason: string }
  | { action: "refuse_attack"; target: Bot; reason: string }
  | { action: "wander"; target: Point };

export function decideBotAction(bot: Bot, match: MatchState): BotDecision {
  const nearestEnemy = findNearestEnemy(bot, match);
  const preferredEnemy = findInfluencedEnemy(bot, match) ?? findPreferredEnemy(bot, match);
  const enemy = preferredEnemy ?? nearestEnemy;
  const nearestLoot = findNearestLoot(bot, match);
  const livingCount = match.bots.filter((candidate) => candidate.alive).length;
  const weapon = bot.inventory.weapon;
  const social = evaluateSocialDecision(bot, match);

  if (social.action === "attack" && weapon && distance(bot, social.target) <= weapon.range) {
    bot.behavior = "attacking";
    return social;
  }

  if (social.action === "avoid") {
    bot.behavior = "fleeing";
    return social;
  }

  if (social.action === "follow" || social.action === "propose_alliance" || social.action === "maintain_alliance" || social.action === "betray") {
    bot.behavior = social.action === "betray" ? "attacking" : "wandering";
    return social;
  }

  if (nearestEnemy && shouldFlee(bot, nearestEnemy, livingCount)) {
    bot.behavior = "fleeing";
    return { action: "flee", target: nearestEnemy };
  }

  if (weapon && enemy && distance(bot, enemy) <= weapon.range) {
    if (shouldRefuseAttackForTrust(bot, enemy, match)) {
      bot.behavior = "wandering";
      return { action: "refuse_attack", target: enemy, reason: "trust" };
    }
    bot.behavior = "attacking";
    return { action: "attack", target: enemy };
  }

  if (nearestLoot && shouldSeekLoot(bot, nearestLoot)) {
    bot.behavior = "seeking_loot";
    return { action: "seek_loot", target: nearestLoot };
  }

  if (weapon && enemy && distance(bot, enemy) <= getChaseRange(bot, livingCount, match)) {
    bot.behavior = "attacking";
    return { action: "chase", target: enemy };
  }

  bot.behavior = "wandering";
  if (!bot.wanderTarget || distance(bot, bot.wanderTarget) < 10) {
    bot.wanderTarget = randomPointInCircle(
      bot,
      WANDER_TARGET_RADIUS,
      createRng(hashSeed(`${match.id}:${bot.id}:${Math.floor(match.elapsedMs / 3500)}`)),
    );
  }

  return { action: "wander", target: bot.wanderTarget };
}

function findNearestEnemy(bot: Bot, match: MatchState): Bot | null {
  return match.bots
    .filter((candidate) => candidate.alive && candidate.id !== bot.id && !areAllied(bot, candidate, match.elapsedMs))
    .sort((a, b) => distance(bot, a) - distance(bot, b))[0] ?? null;
}

function findPreferredEnemy(bot: Bot, match: MatchState): Bot | null {
  const enemies = match.bots.filter((candidate) => candidate.alive && candidate.id !== bot.id && !areAllied(bot, candidate, match.elapsedMs));

  if (bot.personality === "Hunter") {
    return enemies
      .filter((candidate) => distance(bot, candidate) <= VISIBLE_ENEMY_RANGE * 1.15)
      .sort((a, b) => a.health - b.health || distance(bot, a) - distance(bot, b))[0] ?? null;
  }

  if (bot.personality === "Berserker") {
    return enemies.sort((a, b) => distance(bot, a) - distance(bot, b))[0] ?? null;
  }

  return null;
}

function findInfluencedEnemy(bot: Bot, match: MatchState): Bot | null {
  const revengeInfluence = bot.activeInfluences
    ?.filter((influence) => influence.type === "revenge" && influence.expiresAtMs > match.elapsedMs && influence.targetBotId)
    .sort((a, b) => b.strength - a.strength)[0];
  if (!revengeInfluence?.targetBotId) {
    return null;
  }

  const target = match.bots.find(
    (candidate) =>
      candidate.id === revengeInfluence.targetBotId &&
      candidate.alive &&
      candidate.id !== bot.id &&
      !areAllied(bot, candidate, match.elapsedMs),
  );

  if (!target || distance(bot, target) > VISIBLE_ENEMY_RANGE * (1.1 + revengeInfluence.strength)) {
    return null;
  }

  return target;
}

function findNearestLoot(bot: Bot, match: MatchState): LootItem | null {
  return [...match.loot].sort((a, b) => getLootDesire(bot, b) / Math.max(80, distance(bot, b)) - getLootDesire(bot, a) / Math.max(80, distance(bot, a)))[0] ?? null;
}

function shouldFlee(bot: Bot, enemy: Bot, livingCount: number): boolean {
  const enemyDistance = distance(bot, enemy);
  const relationship = getRelationship(bot, enemy.id);
  const aggressionPressure = getInfluenceStrength(bot, "aggression");
  const defensePressure = getInfluenceStrength(bot, "defense");
  const fleeBias = 1 + defensePressure * 0.5 - aggressionPressure * 0.45;

  if (bot.personality === "Berserker") {
    return bot.health < 18 + defensePressure * 12 && enemyDistance <= FLEE_ENEMY_RANGE * (0.75 + relationship.fear * 0.4) * fleeBias;
  }

  if (bot.personality === "Coward") {
    return (bot.health < 62 + defensePressure * 10 && enemyDistance <= FLEE_ENEMY_RANGE * 1.6 * fleeBias) || enemyDistance <= 92 * fleeBias;
  }

  if (bot.personality === "Survivor" && livingCount > 4) {
    return enemyDistance <= FLEE_ENEMY_RANGE * 1.35 * fleeBias || (bot.health < 55 + defensePressure * 10 && enemyDistance <= FLEE_ENEMY_RANGE * 1.8 * fleeBias);
  }

  return (
    bot.health < 30 + bot.psychology.selfPreservation * 20 + defensePressure * 12 &&
    enemyDistance <= FLEE_ENEMY_RANGE * (1 + relationship.fear * 0.7 + getTraitModifier(bot, "fleeBonus")) * fleeBias
  );
}

function shouldSeekLoot(bot: Bot, loot: LootItem): boolean {
  if (!bot.inventory.weapon) {
    return true;
  }

  if (loot.type === "medkit") {
    return bot.health <= 78 || bot.personality === "Scavenger";
  }

  if (bot.personality !== "Scavenger") {
    return false;
  }

  return distance(bot, loot) <= VISIBLE_ENEMY_RANGE * (0.8 + getTraitModifier(bot, "lootBonus"));
}

function getChaseRange(bot: Bot, livingCount: number, match: MatchState): number {
  const attackBias = 1 + getInfluenceStrength(bot, "aggression") * 0.5 + getInfluenceStrength(bot, "revenge") * 0.38 - getInfluenceStrength(bot, "defense") * 0.35;
  const biome = getBiomeAt(bot, match.zones);
  const visibility = 1 + (biome.modifiers.visibility ?? 0) + ((bot.affinities.biomes[biome.id] ?? 1) - 1) * 0.12;
  if (bot.personality === "Berserker") return VISIBLE_ENEMY_RANGE * 1.35 * attackBias * visibility;
  if (bot.personality === "Hunter") return VISIBLE_ENEMY_RANGE * 1.2 * attackBias * visibility;
  if (bot.personality === "Coward") return VISIBLE_ENEMY_RANGE * 0.45 * attackBias * visibility;
  if (bot.personality === "Survivor") return (livingCount <= 4 ? VISIBLE_ENEMY_RANGE : VISIBLE_ENEMY_RANGE * 0.35) * attackBias * visibility;
  return VISIBLE_ENEMY_RANGE * attackBias * visibility;
}

function getInfluenceStrength(bot: Bot, type: "aggression" | "defense" | "revenge"): number {
  return Math.max(0, ...(bot.activeInfluences ?? []).filter((influence) => influence.type === type).map((influence) => influence.strength));
}

function getLootDesire(bot: Bot, item: LootItem): number {
  const rarity = item.rarity === "legendary" ? 5 : item.rarity === "rare" ? 3 : item.rarity === "uncommon" ? 2 : 1;
  if (item.type === "medkit") return bot.health < 45 ? 8 : bot.health < 75 ? 4 : 0.8;
  if (item.type === "weapon") return item.weapon.damage * (0.4 + bot.psychology.aggression * 0.35) + rarity + ((bot.affinities.weapons[item.weapon.name] ?? 1) - 1) * 4;
  if (item.type === "armor") return (item.effects.defense ?? 0) * (60 + bot.psychology.selfPreservation * 30) + rarity;
  return ((item.effects.stealth ?? 0) + (item.effects.trapPower ?? 0)) * (45 + bot.psychology.opportunism * 30) + rarity;
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
