import { chooseNewTrait } from "./traits";
import { createRng } from "./random";
import type { Bot, PersistentBot } from "./types";

export function xpToNextLevel(level: number): number {
  return Math.round(100 * level ** 1.5);
}

export function calculateMatchXp(bot: Bot, placement: number, totalBots: number): number {
  const survivalXp = Math.floor(bot.survivalTimeMs / 1000) * 2;
  const killXp = bot.kills * 35;
  const damageXp = Math.floor(bot.damageDealt * 0.7);
  const placementXp = Math.round(((totalBots - placement + 1) / totalBots) * 45);
  return survivalXp + killXp + damageXp + placementXp;
}

export function applyMatchProgression(bot: PersistentBot, matchBot: Bot, placement: number, totalBots: number, won: boolean): string {
  const xpGained = calculateMatchXp(matchBot, placement, totalBots);
  bot.xp += xpGained;
  bot.career.matchesPlayed += 1;
  bot.career.wins += won ? 1 : 0;
  bot.career.kills += matchBot.kills;
  bot.career.damageDealt += matchBot.damageDealt;
  bot.career.longestSurvivalTime = Math.max(bot.career.longestSurvivalTime, matchBot.survivalTimeMs);

  let levelsGained = 0;
  while (bot.xp >= xpToNextLevel(bot.level)) {
    const rng = createRng(hashSeed(`${bot.id}:${bot.level}:${bot.xp}`));
    bot.xp -= xpToNextLevel(bot.level);
    bot.level += 1;
    levelsGained += 1;
    improveStats(bot, rng);
    if (bot.level % 2 === 0) {
      bot.traits.push(chooseNewTrait(bot.traits, rng));
    }
  }

  const result = `${won ? "Won" : `Placed #${placement}`} · +${xpGained} XP${levelsGained ? ` · Level +${levelsGained}` : ""}`;
  bot.recentResults = [result, ...bot.recentResults].slice(0, 5);
  return result;
}

function improveStats(bot: PersistentBot, rng: () => number): void {
  bot.baseStats.strength += 1 + rng() * 0.6;
  bot.baseStats.speed += 0.6 + rng() * 0.5;
  bot.baseStats.perception += 0.8 + rng() * 0.5;
  bot.baseStats.endurance += 1 + rng() * 0.7;
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
