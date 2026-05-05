import {
  EVENT_DEBOUNCE_MS,
  LOOT_PICKUP_RADIUS,
  LOOT_ZONE_RADIUS,
  MAP_CENTER,
  MAX_EVENTS,
  SPONSOR_DROP_RADIUS,
  WEAPONS,
} from "./constants";
import { addNarrativeMoment, forceArenaEvent as forceArenaEventInternal, isPointInActiveDangerZone, isSuddenDeathActive, updateArenaEventSystem } from "./arenaEvents";
import { decideBotAction } from "./ai";
import { clampToMap, getBiomeAt, getBiomeName } from "./biomes";
import { createLegacyWeaponLoot, createRandomLoot } from "./loot";
import {
  LOW_HP_THRESHOLD,
  createFirstBloodEvent,
  createKillEvent,
  createKillStreakEvent,
  createLowHpEvent,
  createMatchWinnerEvent,
  createNearDeathEscapeEvent,
  createSponsorDropEvent,
  createWeaponPickupEvent,
  emitMatchEvent,
  nextMatchEventBase,
} from "./matchEvents";
import { distance, randomPointInCircle, moveAway, moveToward } from "./math";
import { createRng } from "./random";
import {
  betrayAlliance,
  createAlliance,
  endAlliance,
  expireAlliances,
  recordAttack,
  recordFlee,
  recordHelp,
  recordKill,
  updatePeacefulProximity,
} from "./relationships";
import { estimateBotStrength } from "./socialAI";
import type { BotDecision } from "./ai";
import type { ArenaEventType, BehaviorState, BiomeType, Bot, Creature, EquipmentItem, GameEvent, InfluenceType, LootItem, MapEvent, MatchState, Nudge, Weapon } from "./types";

export type SponsorDropKind = Weapon["name"] | "Medkit";

const NUDGE_DURATION_MS: Record<InfluenceType, number> = {
  aggression: 20_000,
  defense: 20_000,
  revenge: 25_000,
  reveal: 15_000,
};

export function stepSimulation(match: MatchState, deltaMs: number): MatchState {
  if (match.ended) {
    return match;
  }

  ensureRuntimeMatchEventFields(match);
  match.elapsedMs += deltaMs;
  const moveDistanceScale = deltaMs / 1000;
  expireAlliances(match, addEvent.bind(null, match));
  updatePeacefulProximity(match, deltaMs);
  updateArenaEventSystem(match, deltaMs, addEvent.bind(null, match));

  for (const bot of match.bots) {
    ensureRuntimeBotFields(bot);
    bot.activeInfluences = bot.activeInfluences.filter((influence) => influence.expiresAtMs > match.elapsedMs);
    if (!bot.alive) {
      continue;
    }

    updateBotBiome(match, bot, deltaMs);
    bot.survivalTimeMs = match.elapsedMs;
    const decision = decideBotAction(bot, match);
    recordBotThought(match, bot, decision);
    const biome = getBiomeAt(bot, match.zones);
    const speedModifier = (biome.modifiers.movementSpeed ?? 1) + (bot.inventory.armor?.effects.speed ?? 0) + (bot.inventory.tool?.effects.speed ?? 0);
    const moveDistance = bot.speed * Math.max(0.52, speedModifier) * moveDistanceScale;

    if (decision.action === "flee") {
      const next = moveAway(bot, decision.target, moveDistance * 1.25);
      bot.x = next.x;
      bot.y = next.y;
      addEvent(match, `${bot.name} is fleeing from ${decision.target.name}.`, `flee-${bot.id}`, 3200, {
        kind: "avoid",
        botId: bot.id,
        targetId: decision.target.id,
        x: bot.x,
        y: bot.y,
        label: "Fleeing",
      });
      recordFlee(match, bot);
    }

    if (decision.action === "flee_creature") {
      const next = moveAway(bot, decision.target, moveDistance * 1.3);
      bot.x = next.x;
      bot.y = next.y;
      addEvent(match, `${bot.name} flees from ${decision.target.name}.`, `flee-creature-${bot.id}-${decision.target.id}`, 2600, {
        kind: "avoid",
        botId: bot.id,
        x: bot.x,
        y: bot.y,
        label: "Flee",
      });
      recordFlee(match, bot);
    }

    if (decision.action === "escape_zone") {
      const next = moveToward(bot, decision.target, moveDistance * 1.4);
      bot.x = next.x;
      bot.y = next.y;
      addEvent(match, `${bot.name} escapes the danger zone.`, `escape-zone-${bot.id}`, 3000, {
        kind: "avoid",
        botId: bot.id,
        x: bot.x,
        y: bot.y,
        label: "Escape",
      });
    }

    if (decision.action === "avoid") {
      const next = moveAway(bot, decision.target, moveDistance * 1.15);
      bot.x = next.x;
      bot.y = next.y;
      addEvent(match, `${bot.name} avoids ${decision.target.name} out of fear.`, `avoid-${bot.id}-${decision.target.id}`, 4500, {
        kind: "avoid",
        botId: bot.id,
        targetId: decision.target.id,
        x: bot.x,
        y: bot.y,
        label: "Avoids",
      });
    }

    if (
      decision.action === "seek_loot" ||
      decision.action === "chase" ||
      decision.action === "wander" ||
      decision.action === "follow" ||
      decision.action === "maintain_alliance"
    ) {
      const next = moveToward(bot, decision.target, moveDistance);
      bot.x = next.x;
      bot.y = next.y;
      if (decision.action === "follow") {
        addEvent(match, `${bot.name} follows ${decision.target.name}.`, `follow-${bot.id}-${decision.target.id}`, 6000, {
          kind: "follow",
          botId: bot.id,
          targetId: decision.target.id,
          x: bot.x,
          y: bot.y,
          label: "Following",
        });
      }
    }

    if (decision.action === "propose_alliance") {
      createAlliance(bot, decision.target, match.elapsedMs, decision.durationMs, decision.reason);
      addEvent(match, `${bot.name} formed an alliance with ${decision.target.name} (${decision.reason}).`, `alliance-${[bot.id, decision.target.id].sort().join("-")}`, 8000, {
        kind: "alliance",
        botId: bot.id,
        targetId: decision.target.id,
        x: (bot.x + decision.target.x) / 2,
        y: (bot.y + decision.target.y) / 2,
        label: "Alliance",
      });
    }

    if (decision.action === "betray") {
      betrayAlliance(bot, decision.target);
      addEvent(match, `${bot.name} betrayed ${decision.target.name}.`, `betray-${bot.id}-${decision.target.id}`, 8000, {
        kind: "betrayal",
        botId: bot.id,
        targetId: decision.target.id,
        x: decision.target.x,
        y: decision.target.y,
        label: "Betrayal",
      });
      tryAttack(match, bot, decision.target, true);
    }

    if (decision.action === "refuse_attack") {
      addEvent(match, `${bot.name} refuses to attack ${decision.target.name} because of trust.`, `refuse-${bot.id}-${decision.target.id}`, 7000, {
        kind: "trust",
        botId: bot.id,
        targetId: decision.target.id,
        x: bot.x,
        y: bot.y,
        label: "Trust",
      });
    }

    if (decision.action === "attack") {
      tryAttack(match, bot, decision.target);
    }

    if (decision.action === "attack_creature") {
      tryAttackCreature(match, bot, decision.target);
    }

    pickupLoot(match, bot);
  }

  updateCreatures(match);
  finishIfNeeded(match);
  return match;
}

export function spawnSponsorDrop(match: MatchState, botId: string, kind: SponsorDropKind): boolean {
  if (match.ended) {
    return false;
  }

  const bot = match.bots.find((candidate) => candidate.id === botId && candidate.alive);
  if (!bot) {
    return false;
  }

  const position = randomPointInCircle(bot, SPONSOR_DROP_RADIUS, createRng(hashSeed(`${match.id}:${bot.id}:${kind}:${match.nextEventId}`)));
  const item = createSponsorItem(match, position.x, position.y, kind);
  match.loot.push(item);
  addEvent(match, `${bot.name} receives a sponsor drop: ${getLootLabel(item)}.`, undefined, 0, {
    kind: "sponsor",
    botId: bot.id,
    x: position.x,
    y: position.y,
    label: "Sponsor",
  });
  emitMatchEvent(match, createSponsorDropEvent(bot, item, nextMatchEventBase(match, "sponsor-drop")));
  return true;
}

export function forceArenaEvent(match: MatchState, type: ArenaEventType): boolean {
  if (match.ended) {
    return false;
  }
  return Boolean(forceArenaEventInternal(match, type, addEvent.bind(null, match)));
}

export function applyPlayerNudge(
  match: MatchState,
  type: InfluenceType,
  targetBotId: string,
  secondaryBotId?: string,
): Nudge | null {
  if (match.ended) {
    return null;
  }

  const target = match.bots.find((bot) => bot.id === targetBotId && bot.alive);
  const secondary = secondaryBotId ? match.bots.find((bot) => bot.id === secondaryBotId && bot.alive && bot.id !== targetBotId) : null;
  if (!target || (type === "revenge" && !secondary)) {
    return null;
  }

  ensureRuntimeBotFields(target);
  const cost = getNudgeCost(type);
  const successChance = getNudgeSuccessChance(target, type);
  const roll = deterministicRoll(`${match.id}:${target.id}:${type}:${secondaryBotId ?? ""}:${match.nextEventId}`);
  const success = roll <= successChance;
  const nudge: Nudge = {
    id: `nudge-${match.nextEventId}`,
    matchId: match.id,
    type,
    targetBotId,
    secondaryBotId,
    timestamp: match.elapsedMs,
    cost,
    success,
  };

  if (success) {
    target.activeInfluences.push({
      id: nudge.id,
      type,
      expiresAtMs: match.elapsedMs + NUDGE_DURATION_MS[type],
      source: "player",
      strength: getNudgeStrength(target, type),
      targetBotId: secondary?.id,
    });
  }

  addEvent(match, getNudgeMessage(type, target.name, secondary?.name, success), undefined, 0, {
    kind: "player",
    botId: target.id,
    targetId: secondary?.id,
    x: target.x,
    y: target.y,
    label: success ? "Nudge" : "Ignored",
  });

  return nudge;
}

function createSponsorItem(match: MatchState, x: number, y: number, kind: SponsorDropKind): LootItem {
  if (kind === "Medkit") {
    return {
      id: `sponsor-${match.nextEventId}-medkit`,
      x,
      y,
      type: "medkit",
      name: "Med Kit",
      category: "consumable",
      rarity: "common",
      effects: { healing: 35 },
      healAmount: 35,
    };
  }

  return createLegacyWeaponLoot(`sponsor-${match.nextEventId}-${kind.toLowerCase()}`, x, y, kind);
}

function tryAttack(match: MatchState, attacker: Bot, target: Bot, isBetrayal = false): void {
  const weapon = attacker.inventory.weapon;

  if (!weapon || !target.alive) {
    return;
  }

  if (match.elapsedMs - attacker.lastAttackAt < weapon.cooldownMs) {
    return;
  }

  attacker.lastAttackAt = match.elapsedMs;
  const biome = getBiomeAt(target, match.zones);
  const weaponAffinity = attacker.affinities.weapons[weapon.name] ?? 1;
  const rangeAffinity = getCombatRangeAffinity(attacker, weapon.range);
  const coverPenalty = (biome.modifiers.cover ?? 0) * 0.28;
  const biomeAccuracy = biome.modifiers.accuracy ?? 0;
  const gearAccuracy = (attacker.inventory.tool?.effects.accuracy ?? 0) + (attacker.inventory.armor?.effects.accuracy ?? 0);
  const hitChance = Math.max(0.22, Math.min(0.94, (weapon.accuracy ?? 0.75) + biomeAccuracy + gearAccuracy + (weaponAffinity - 1) * 0.1 + (rangeAffinity - 1) * 0.08 - coverPenalty));
  const roll = deterministicRoll(`${match.id}:${attacker.id}:${target.id}:${match.elapsedMs}:${weapon.name}`);
  if (roll > hitChance) {
    if (coverPenalty > 0.03) {
      addEvent(match, `${getBiomeName(biome.id)} cover reduces ${attacker.name}'s shot accuracy.`, `cover-${attacker.id}-${biome.id}`, 5200, {
        kind: "system",
        botId: attacker.id,
        targetId: target.id,
        x: target.x,
        y: target.y,
        label: "Cover",
      });
    }
    return;
  }

  const defense = target.inventory.armor?.effects.defense ?? 0;
  const biomeAffinity = attacker.affinities.biomes[biome.id] ?? 1;
  const damage = Math.max(3, Math.round(weapon.damage * (0.86 + weaponAffinity * 0.12 + biomeAffinity * 0.04) * (1 - defense)));
  const appliedDamage = Math.min(target.health, damage);
  const previousTargetHealth = target.health;
  target.health = Math.max(0, target.health - appliedDamage);
  attacker.damageDealt += appliedDamage;
  recordAttack(attacker, target);
  emitLowHpIfNeeded(match, target, previousTargetHealth);
  addEvent(
    match,
    `${attacker.name} hit ${target.name} with ${weapon.name} for ${appliedDamage}.`,
    `attack-${attacker.id}-${target.id}`,
    EVENT_DEBOUNCE_MS,
    {
      kind: "damage",
      botId: attacker.id,
      targetId: target.id,
      x: target.x,
      y: target.y,
      label: `-${appliedDamage}`,
    },
  );
  const attackerAlly = match.bots.find((bot) => bot.alive && bot.id !== attacker.id && bot.id !== target.id);
  if (attackerAlly && distance(attackerAlly, target) < 135) {
    recordHelp(match, attacker, attackerAlly);
  }

  if (target.health <= 0) {
    const targetStrength = estimateBotStrength(target);
    eliminateBot(match, target);
    attacker.kills += 1;
    attacker.weaponKills[weapon.name] = (attacker.weaponKills[weapon.name] ?? 0) + 1;
    if (isBetrayal) {
      endAlliance(attacker, target);
    }
    recordKill(match, attacker, target, targetStrength);
    addEvent(match, `${target.name} was eliminated by ${attacker.name}.`, undefined, 0, {
      kind: "kill",
      botId: attacker.id,
      targetId: target.id,
      x: target.x,
      y: target.y,
      label: "Eliminated",
    });
    emitKillEvents(match, attacker, target);
  }
}

function tryAttackCreature(match: MatchState, attacker: Bot, creature: Creature): void {
  const weapon = attacker.inventory.weapon;
  if (!weapon || creature.health <= 0) {
    return;
  }

  if (match.elapsedMs - attacker.lastAttackAt < weapon.cooldownMs) {
    return;
  }

  attacker.lastAttackAt = match.elapsedMs;
  const damage = Math.max(4, Math.round(weapon.damage * (0.78 + attacker.psychology.aggression * 0.24)));
  creature.health -= damage;
  attacker.damageDealt += damage;
  addEvent(match, `${attacker.name} attacks ${creature.name} for ${damage}.`, `bot-creature-hit-${attacker.id}-${creature.id}`, 900, {
    kind: "damage",
    botId: attacker.id,
    x: creature.x,
    y: creature.y,
    label: `-${damage}`,
  });

  if (creature.health <= 0) {
    attacker.xp += 18;
    addEvent(match, `${attacker.name} kills ${creature.name} and earns arena XP.`, undefined, 0, {
      kind: "system",
      botId: attacker.id,
      x: creature.x,
      y: creature.y,
      label: "+XP",
    });
    addNarrativeMoment(match, {
      title: `${attacker.name} drove back the wolf pack`,
      severity: "epic",
      relatedBotIds: [attacker.id],
      location: { x: creature.x, z: creature.y },
    }, `creature-kill-${attacker.id}`);
  }
}

function pickupLoot(match: MatchState, bot: Bot): void {
  const lootIndex = match.loot.findIndex(
    (item) => distance(bot, item) <= LOOT_PICKUP_RADIUS && shouldPickup(bot, item, match),
  );

  if (lootIndex === -1) {
    return;
  }

  const item = match.loot[lootIndex];

  if (item.type === "credits") {
    match.loot.splice(lootIndex, 1);
    bot.carriedCredits += item.amount;
    addEvent(match, `${bot.name} picks up ${item.amount} dropped credits.`, undefined, 0, {
      kind: "loot",
      botId: bot.id,
      x: bot.x,
      y: bot.y,
      label: `+${item.amount}`,
    });
    return;
  }

  if (item.type === "medkit") {
    match.loot.splice(lootIndex, 1);
    const previousHealth = bot.health;
    const healAmount = isSuddenDeathActive(match) ? Math.round(item.healAmount * 0.35) : item.healAmount;
    bot.health = Math.min(100, bot.health + healAmount);
    addEvent(match, `${bot.name} finds a Med Kit in the ${getBiomeName(bot.currentBiome)} and restores ${Math.round(bot.health - previousHealth)} health.`, undefined, 0, {
      kind: "loot",
      botId: bot.id,
      x: bot.x,
      y: bot.y,
      label: "Heal",
    });
    if (previousHealth <= LOW_HP_THRESHOLD && bot.health > LOW_HP_THRESHOLD) {
      emitMatchEvent(match, createNearDeathEscapeEvent(bot, nextMatchEventBase(match, "near-death-escape")));
    }
    return;
  }

  match.loot.splice(lootIndex, 1);
  if (item.type === "weapon") {
    const currentWeapon = bot.inventory.weapon;
    bot.inventory.weapon = item.weapon;
    addEvent(match, `${bot.name} finds ${item.name} in the ${getBiomeName(bot.currentBiome)}${currentWeapon ? `, replacing ${currentWeapon.name}` : ""}.`, undefined, 0, {
      kind: "loot",
      botId: bot.id,
      x: bot.x,
      y: bot.y,
      label: item.name,
    });
    emitMatchEvent(match, createWeaponPickupEvent(bot, item, nextMatchEventBase(match, "weapon-pickup")));
    if (item.rarity === "rare" || item.rarity === "legendary") {
      addNarrativeMoment(match, {
        title: `${bot.name} found ${item.name}`,
        description: "The loot drop has changed the fight.",
        severity: "epic",
        relatedBotIds: [bot.id],
        location: { x: bot.x, z: bot.y },
      }, `rare-pickup-${item.id}`);
    }
    return;
  }

  if (item.type === "armor") {
    bot.inventory.armor = item.item;
  } else {
    bot.inventory.tool = item.item;
  }
  addEvent(match, `${bot.name} picks up ${item.name} in the ${getBiomeName(bot.currentBiome)}.`, undefined, 0, {
    kind: "loot",
    botId: bot.id,
    x: bot.x,
    y: bot.y,
    label: item.name,
  });
  emitMatchEvent(match, createWeaponPickupEvent(bot, item, nextMatchEventBase(match, "item-pickup")));
}

function shouldPickup(bot: Bot, item: LootItem, match: MatchState): boolean {
  if (isPointInActiveDangerZone(match, item) && bot.health < 70 && bot.psychology.riskTolerance < 0.82) {
    return false;
  }

  if (item.type === "medkit") {
    return bot.health < 82 || bot.personality === "Coward";
  }

  if (item.type === "credits") {
    return true;
  }

  const score = evaluateLoot(bot, item);
  const currentValue =
    item.type === "weapon"
      ? (bot.inventory.weapon?.damage ?? 0)
      : item.type === "armor"
        ? (bot.inventory.armor?.effects.defense ?? 0) * 100
        : item.type === "tool"
          ? ((bot.inventory.tool?.effects.stealth ?? 0) + (bot.inventory.tool?.effects.trapPower ?? 0)) * 100
          : 0;
  const riskAppetite = bot.psychology.opportunism + bot.psychology.riskTolerance + (bot.traits.includes("scavenger") ? 0.35 : 0);
  if (item.name === "Heavy Vest" && bot.baseStats.speed > 10 && bot.psychology.selfPreservation < 0.55) {
    addEvent(match, `${bot.name} ignores the Heavy Vest to stay mobile.`, `ignore-heavy-${bot.id}`, 20_000, {
      kind: "loot",
      botId: bot.id,
      x: bot.x,
      y: bot.y,
      label: "Ignored",
    });
    return false;
  }
  return score > currentValue * (0.92 + (1 - riskAppetite) * 0.16);
}

function evaluateLoot(bot: Bot, item: LootItem): number {
  const rarityBonus = item.rarity === "legendary" ? 22 : item.rarity === "rare" ? 14 : item.rarity === "uncommon" ? 7 : 0;
  const biomeBonus = item.preferredBiomes?.includes(bot.currentBiome ?? "open_field") ? 6 * (bot.affinities.biomes[bot.currentBiome ?? "open_field"] ?? 1) : 0;
  if (item.type === "weapon") {
    const rangeBonus = getCombatRangeAffinity(bot, item.weapon.range) * 5;
    return item.weapon.damage * (1 + bot.psychology.aggression * 0.25) + item.weapon.range * 0.025 + rarityBonus + biomeBonus + rangeBonus + ((bot.affinities.weapons[item.weapon.name] ?? 1) - 1) * 12;
  }
  if (item.type === "armor") {
    return (item.effects.defense ?? 0) * 120 + rarityBonus + bot.psychology.selfPreservation * 12 + (item.effects.speed ?? 0) * 35 + biomeBonus;
  }
  if (item.type === "tool") {
    return ((item.effects.stealth ?? 0) + (item.effects.trapPower ?? 0)) * 90 + rarityBonus + bot.psychology.opportunism * 10 + biomeBonus + ((bot.affinities.tools[item.name] ?? 1) - 1) * 10;
  }
  return 0;
}

function finishIfNeeded(match: MatchState): void {
  const living = match.bots.filter((bot) => bot.alive);

  if (living.length === 3) {
    addEvent(match, "Final phase: three bots remain.", "final-phase", 60_000, {
      kind: "system",
      x: living.reduce((sum, bot) => sum + bot.x, 0) / living.length,
      y: living.reduce((sum, bot) => sum + bot.y, 0) / living.length,
      label: "Final phase",
    });
  }

  if (living.length <= 1) {
    match.ended = true;
    match.winnerId = living[0]?.id ?? null;
    for (const bot of match.bots) {
      if (bot.alive) {
        bot.survivalTimeMs = match.elapsedMs;
      }
    }
    addEvent(match, match.winnerId ? `${living[0].name} wins the match.` : "No bots survived.", undefined, 0, {
      kind: "winner",
      botId: living[0]?.id,
      x: living[0]?.x,
      y: living[0]?.y,
      label: "Winner",
    });
    if (living[0]?.carriedCredits) {
      addEvent(match, `${living[0].name} leaves with ${living[0].carriedCredits} credits.`, undefined, 0, {
        kind: "winner",
        botId: living[0].id,
        x: living[0].x,
        y: living[0].y,
        label: `+${living[0].carriedCredits}`,
      });
    }
    if (living[0]) {
      emitMatchEvent(match, createMatchWinnerEvent(living[0], nextMatchEventBase(match, "match-winner")));
    }
  }
}

function emitKillEvents(match: MatchState, attacker: Bot, target: Bot): void {
  match.matchEventState.lastKillAtMs = match.elapsedMs;
  emitMatchEvent(match, createKillEvent(attacker, target, nextMatchEventBase(match, "kill")));

  if (!match.matchEventState.firstBloodEmitted) {
    match.matchEventState.firstBloodEmitted = true;
    emitMatchEvent(match, createFirstBloodEvent(attacker, target, nextMatchEventBase(match, "first-blood")));
  }

  if (attacker.kills >= 2 && match.matchEventState.killStreaks[attacker.id] !== attacker.kills) {
    match.matchEventState.killStreaks[attacker.id] = attacker.kills;
    emitMatchEvent(match, createKillStreakEvent(attacker, attacker.kills, nextMatchEventBase(match, "kill-streak")));
    addNarrativeMoment(match, {
      title: `${attacker.name} is on a ${attacker.kills}-kill streak`,
      severity: "epic",
      relatedBotIds: [attacker.id],
      location: { x: attacker.x, z: attacker.y },
    }, `kill-streak-${attacker.id}-${attacker.kills}`);
  }
}

function emitLowHpIfNeeded(match: MatchState, bot: Bot, previousHealth: number): void {
  if (previousHealth <= LOW_HP_THRESHOLD || bot.health <= 0 || bot.health > LOW_HP_THRESHOLD) {
    return;
  }
  if (match.matchEventState.lowHpBotIds[bot.id]) {
    return;
  }
  match.matchEventState.lowHpBotIds[bot.id] = true;
  emitMatchEvent(match, createLowHpEvent(bot, nextMatchEventBase(match, "low-hp")));
}

function addEvent(
  match: MatchState,
  message: string,
  debounceKey?: string,
  debounceMs = 0,
  meta: Partial<GameEvent> = {},
): void {
  if (debounceKey) {
    const lastLoggedAt = match.eventDebounce[debounceKey] ?? -Infinity;
    if (match.elapsedMs - lastLoggedAt < debounceMs) {
      return;
    }
    match.eventDebounce[debounceKey] = match.elapsedMs;
  }

  const event = { id: match.nextEventId, timeMs: match.elapsedMs, message, ...meta };
  if (shouldPreserveForHistory(event)) {
    match.historyEvents = [...(match.historyEvents ?? []), event];
  }
  match.events = [event, ...match.events].slice(0, MAX_EVENTS);
  match.nextEventId += 1;
}

function getLootLabel(item: LootItem): string {
  return item.name;
}

function eliminateBot(match: MatchState, bot: Bot): void {
  bot.alive = false;
  bot.behavior = "wandering";
  bot.survivalTimeMs = match.elapsedMs;
  dropInventoryAndCredits(match, bot);
}

function dropInventoryAndCredits(match: MatchState, bot: Bot): void {
  const droppedNames: string[] = [];
  let dropIndex = 0;

  if (bot.inventory.weapon) {
    match.loot.push(createWeaponDrop(match, bot, bot.inventory.weapon, dropIndex++));
    droppedNames.push(bot.inventory.weapon.name);
    bot.inventory.weapon = null;
  }

  if (bot.inventory.armor) {
    match.loot.push(createEquipmentDrop(match, bot, bot.inventory.armor, dropIndex++));
    droppedNames.push(bot.inventory.armor.name);
    bot.inventory.armor = null;
  }

  if (bot.inventory.tool) {
    match.loot.push(createEquipmentDrop(match, bot, bot.inventory.tool, dropIndex++));
    droppedNames.push(bot.inventory.tool.name);
    bot.inventory.tool = null;
  }

  if (bot.carriedCredits > 0) {
    const credits = bot.carriedCredits;
    match.loot.push(createCreditDrop(match, bot, credits, dropIndex++));
    droppedNames.push(`${credits} credits`);
    bot.carriedCredits = 0;
  }

  if (droppedNames.length) {
    addEvent(match, `${bot.name} drops ${formatDroppedItems(droppedNames)}.`, undefined, 0, {
      kind: "loot",
      botId: bot.id,
      x: bot.x,
      y: bot.y,
      label: "Dropped",
    });
  }
}

function createWeaponDrop(match: MatchState, bot: Bot, weapon: Weapon, index: number): LootItem {
  const point = getDropPoint(bot, index);
  return {
    id: `drop-${bot.id}-${match.nextEventId}-${index}-weapon`,
    x: point.x,
    y: point.y,
    type: "weapon",
    name: weapon.name,
    category: "weapon",
    rarity: "common",
    effects: { damage: weapon.damage, range: weapon.range, accuracy: weapon.accuracy },
    weapon,
  };
}

function createEquipmentDrop(match: MatchState, bot: Bot, item: EquipmentItem, index: number): LootItem {
  const point = getDropPoint(bot, index);
  if (item.category === "armor") {
    return {
      id: `drop-${bot.id}-${match.nextEventId}-${index}-armor`,
      x: point.x,
      y: point.y,
      type: "armor",
      name: item.name,
      category: "armor",
      rarity: item.rarity,
      preferredBiomes: item.preferredBiomes,
      effects: item.effects,
      item,
    };
  }

  return {
    id: `drop-${bot.id}-${match.nextEventId}-${index}-tool`,
    x: point.x,
    y: point.y,
    type: "tool",
    name: item.name,
    category: "tool",
    rarity: item.rarity,
    preferredBiomes: item.preferredBiomes,
    effects: item.effects,
    item,
  };
}

function createCreditDrop(match: MatchState, bot: Bot, amount: number, index: number): LootItem {
  const point = getDropPoint(bot, index);
  return {
    id: `drop-${bot.id}-${match.nextEventId}-${index}-credits`,
    x: point.x,
    y: point.y,
    type: "credits",
    name: `${amount} credits`,
    category: "credits",
    rarity: amount >= 150 ? "rare" : amount >= 75 ? "uncommon" : "common",
    effects: {},
    amount,
  };
}

function getDropPoint(bot: Bot, index: number): { x: number; y: number } {
  const angle = index * 2.399963 + bot.x * 0.013 + bot.y * 0.017;
  const radius = 8 + index * 5;
  return clampToMap({
    x: bot.x + Math.cos(angle) * radius,
    y: bot.y + Math.sin(angle) * radius,
  });
}

function formatDroppedItems(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function ensureRuntimeBotFields(bot: Bot): void {
  bot.level ??= 1;
  bot.xp ??= 0;
  bot.baseStats ??= { strength: 8, speed: 8, perception: 8, endurance: 8 };
  bot.traits ??= [];
  bot.psychology ??= {
    aggression: 0.5,
    loyalty: 0.5,
    opportunism: 0.5,
    selfPreservation: 0.5,
    ambition: 0.5,
    sociability: 0.5,
    vengefulness: 0.5,
    riskTolerance: 0.5,
  };
  bot.career ??= { matchesPlayed: 0, wins: 0, kills: 0, damageDealt: 0, longestSurvivalTime: 0 };
  bot.relationships ??= {};
  bot.recentResults ??= [];
  bot.activeInfluences ??= [];
  bot.affinities ??= {
    biomes: {},
    weapons: {},
    tools: {},
    combatRanges: { close: 1, mid: 1, long: 1 },
  };
  bot.inventory ??= { weapon: null, armor: null, tool: null };
  bot.inventory.armor ??= null;
  bot.inventory.tool ??= null;
  bot.biomeTimeMs ??= {};
  bot.weaponKills ??= {};
  bot.thoughts ??= [];
  bot.carriedCredits ??= 0;
}

function ensureRuntimeMatchEventFields(match: MatchState): void {
  match.matchEvents ??= [];
  match.matchEventState ??= {
    firstBloodEmitted: false,
    lowHpBotIds: {},
    killStreaks: {},
    lastKillAtMs: 0,
    lastArenaEventAtMs: -Infinity,
    firstArenaEventEmitted: false,
    suddenDeathStarted: false,
    eventCounts: {},
    lastNarrativeByKey: {},
  };
  match.matchEventState.lowHpBotIds ??= {};
  match.matchEventState.killStreaks ??= {};
  match.matchEventState.lastKillAtMs ??= 0;
  match.matchEventState.lastArenaEventAtMs ??= -Infinity;
  match.matchEventState.firstArenaEventEmitted ??= false;
  match.matchEventState.suddenDeathStarted ??= false;
  match.matchEventState.eventCounts ??= {};
  match.matchEventState.lastNarrativeByKey ??= {};
  match.arenaEvents ??= [];
  match.narrativeMoments ??= [];
}

function recordBotThought(match: MatchState, bot: Bot, decision: BotDecision): void {
  const signature = getThoughtSignature(decision);
  const debounceKey = `thought-${bot.id}-${signature}`;
  const lastLoggedAt = match.eventDebounce[debounceKey] ?? -Infinity;
  if (match.elapsedMs - lastLoggedAt < 3500) {
    return;
  }

  match.eventDebounce[debounceKey] = match.elapsedMs;
  const thoughtId = match.nextEventId;
  match.nextEventId += 1;
  bot.thoughts = [
    {
      id: thoughtId,
      timeMs: match.elapsedMs,
      message: describeBotThought(bot, decision),
      kind: getThoughtKind(decision),
    },
    ...(bot.thoughts ?? []),
  ].slice(0, 18);
}

function getThoughtSignature(decision: BotDecision): string {
  if (decision.action === "wander") {
    return decision.action;
  }
  if ("id" in decision.target) {
    return `${decision.action}-${decision.target.id}`;
  }
  return decision.action;
}

function getThoughtKind(decision: BotDecision): BehaviorState | "combat" | "social" | "loot" {
  if (decision.action === "attack" || decision.action === "attack_creature" || decision.action === "chase" || decision.action === "betray" || decision.action === "refuse_attack") {
    return "combat";
  }
  if (decision.action === "seek_loot") {
    return "loot";
  }
  if (decision.action === "follow" || decision.action === "avoid" || decision.action === "propose_alliance" || decision.action === "maintain_alliance") {
    return "social";
  }
  if (decision.action === "flee" || decision.action === "flee_creature" || decision.action === "escape_zone") {
    return "fleeing";
  }
  return "wandering";
}

function describeBotThought(bot: Bot, decision: BotDecision): string {
  if (decision.action === "flee") return `${decision.target.name} is too dangerous right now. I need distance.`;
  if (decision.action === "flee_creature") return `${decision.target.name} is too close. Break away.`;
  if (decision.action === "attack_creature") return `${decision.target.name} is exposed. Clear the threat.`;
  if (decision.action === "escape_zone") return "This zone is unstable. Get out now.";
  if (decision.action === "avoid") return `${decision.target.name} feels like a bad fight: ${decision.reason}.`;
  if (decision.action === "seek_loot") return `That ${decision.target.name} could improve my odds.`;
  if (decision.action === "attack") return `${decision.target.name} is in range. Take the shot.`;
  if (decision.action === "chase") return `${decision.target.name} is vulnerable enough to pressure.`;
  if (decision.action === "follow") return `Stay close to ${decision.target.name}: ${decision.reason}.`;
  if (decision.action === "propose_alliance") return `${decision.target.name} could be useful. Offer an alliance for ${decision.reason}.`;
  if (decision.action === "maintain_alliance") return `Keep the pact with ${decision.target.name}. ${decision.reason}.`;
  if (decision.action === "betray") return `${decision.target.name}'s gear and position are worth the betrayal.`;
  if (decision.action === "refuse_attack") return `${decision.target.name} has earned too much trust. Hold fire.`;
  return bot.inventory.weapon ? "No clean angle. Keep moving and watch the field." : "I need gear before this turns into a fight.";
}

function shouldPreserveForHistory(event: GameEvent): boolean {
  if (event.kind === "player") return true;
  if (event.kind === "kill" || event.kind === "winner" || event.kind === "betrayal" || event.kind === "system") return true;
  if (event.kind === "alliance") return event.message.includes("formed an alliance");
  if (event.kind === "damage") return Number(event.label?.replace("-", "")) >= 24;
  return false;
}

function getNudgeCost(type: InfluenceType): number {
  if (type === "revenge") return 75;
  if (type === "reveal") return 40;
  return 50;
}

function getNudgeSuccessChance(bot: Bot, type: InfluenceType): number {
  let chance = 0.8;
  if (type === "aggression") chance += bot.psychology.aggression * 0.08 - bot.psychology.selfPreservation * 0.04;
  if (type === "defense") chance += bot.psychology.selfPreservation * 0.08 - bot.psychology.aggression * 0.04;
  if (type === "revenge") chance += bot.psychology.vengefulness * 0.1;
  if (type === "reveal") chance += bot.psychology.riskTolerance * 0.02;
  if (bot.traits.includes("paranoid")) chance -= type === "reveal" ? 0.08 : 0.03;
  if (bot.traits.includes("bloodthirsty") && type === "aggression") chance += 0.05;
  if (bot.traits.includes("cowardly") && type === "defense") chance += 0.05;
  return Math.max(0.75, Math.min(0.9, chance));
}

function getNudgeStrength(bot: Bot, type: InfluenceType): number {
  const base = type === "revenge" ? 0.48 : type === "reveal" ? 1 : 0.36;
  return Math.max(0.22, Math.min(0.62, base + bot.psychology.riskTolerance * 0.08));
}

function getNudgeMessage(type: InfluenceType, targetName: string, secondaryName: string | undefined, success: boolean): string {
  if (!success) {
    return `${targetName} ignored your ${type} pressure.`;
  }
  if (type === "aggression") return `You nudged ${targetName} toward aggression.`;
  if (type === "defense") return `You nudged ${targetName} toward defense.`;
  if (type === "revenge") return `You pushed ${targetName} toward revenge against ${secondaryName ?? "an enemy"}.`;
  return `${targetName} was revealed to the arena.`;
}

function deterministicRoll(seed: string): number {
  return (hashSeed(seed) % 10_000) / 10_000;
}

function updateBotBiome(match: MatchState, bot: Bot, deltaMs: number): void {
  const zone = getBiomeAt(bot, match.zones);
  bot.currentBiome = zone.id;
  bot.biomeTimeMs[zone.id] = (bot.biomeTimeMs[zone.id] ?? 0) + deltaMs;
  if (bot.lastBiome !== zone.id) {
    bot.lastBiome = zone.id;
    addEvent(match, `${bot.name} enters the ${zone.name}.`, `biome-${bot.id}-${zone.id}`, 2800, {
      kind: "system",
      botId: bot.id,
      x: bot.x,
      y: bot.y,
      label: zone.name,
    });
    if (zone.id === "swamp") {
      addEvent(match, `${bot.name} moves slowly through the Swamp.`, `swamp-${bot.id}`, 8000, {
        kind: "system",
        botId: bot.id,
        x: bot.x,
        y: bot.y,
        label: "Slow",
      });
    }
  }
}

function updateMapEvents(match: MatchState, deltaMs: number): void {
  match.mapEvents = match.mapEvents.filter((event) => event.startedAtMs + event.durationMs > match.elapsedMs);
  const bucket = Math.floor(match.elapsedMs / 10_000);
  const roll = deterministicRoll(`${match.id}:event:${bucket}`);
  if (bucket > 0 && roll < 0.025 && !match.eventDebounce[`map-event-${bucket}`]) {
    match.eventDebounce[`map-event-${bucket}`] = match.elapsedMs;
    spawnMapEvent(match, bucket);
  }

  for (const event of match.mapEvents) {
    if (event.type === "toxic_fog" || event.type === "fire" || event.type === "flood") {
      const zone = event.biome ? match.zones.find((candidate) => candidate.id === event.biome) : null;
      if (!zone) continue;
      for (const bot of match.bots.filter((candidate) => candidate.alive && candidate.currentBiome === zone.id)) {
        if (deterministicRoll(`${event.id}:${bot.id}:${Math.floor(match.elapsedMs / 1800)}`) < 0.02 * deltaMs / 16) {
          const previousHealth = bot.health;
          bot.health = Math.max(1, bot.health - 2);
          emitLowHpIfNeeded(match, bot, previousHealth);
          addEvent(match, `${bot.name} relocates as ${describeMapEvent(event)} disrupts the ${zone.name}.`, `hazard-${event.id}-${bot.id}`, 3500, {
            kind: "system",
            botId: bot.id,
            x: bot.x,
            y: bot.y,
            label: "Hazard",
          });
          bot.wanderTarget = randomPointInCircle({ x: MAP_CENTER, y: MAP_CENTER }, LOOT_ZONE_RADIUS * 2.1, createRng(hashSeed(`${event.id}:${bot.id}:escape`)));
        }
      }
    }
  }
}

function spawnMapEvent(match: MatchState, bucket: number): void {
  const rng = createRng(hashSeed(`${match.id}:map-event:${bucket}`));
  const typeOptions: MapEvent["type"][] = ["creature_attack", "supply_drop", "toxic_fog", "fire", "blackout", "flood", "bounty", "loot_surge"];
  const type = typeOptions[Math.floor(rng() * typeOptions.length)];
  const zone = match.zones[Math.floor(rng() * match.zones.length)];
  const event: MapEvent = {
    id: `event-${bucket}-${type}`,
    type,
    biome: zone.id,
    startedAtMs: match.elapsedMs,
    durationMs: 14_000 + rng() * 12_000,
    effects: {},
  };
  match.mapEvents.push(event);

  if (type === "supply_drop" || type === "loot_surge") {
    const point = randomPointInCircle(zone, zone.radius ?? Math.min(zone.width ?? 180, zone.height ?? 180) / 2, rng);
    const loot = createRandomLoot(`event-loot-${match.nextEventId}`, point.x, point.y, match.zones, rng);
    match.loot.push(loot);
    addEvent(match, `${type === "supply_drop" ? "A supply drop lands" : "A loot surge appears"} in the ${zone.name}.`, undefined, 0, {
      kind: "system",
      x: point.x,
      y: point.y,
      label: "Loot",
    });
    const movers = match.bots.filter((bot) => bot.alive).sort((a, b) => distance(a, point) - distance(b, point)).slice(0, 3);
    for (const bot of movers) {
      if (bot.psychology.opportunism + bot.psychology.riskTolerance > 0.82) bot.wanderTarget = point;
    }
    if (movers.length) addEvent(match, `${movers.length} bots move toward the drop.`, `drop-pull-${event.id}`, 0, { kind: "system", x: point.x, y: point.y, label: "Draw" });
    return;
  }

  if (type === "creature_attack") {
    spawnCreature(match, zone.id, zone.x + (zone.width ?? 0) / 2, zone.y + (zone.height ?? 0) / 2);
    addEvent(match, `A creature attacks in the ${zone.name}.`, undefined, 0, { kind: "system", x: zone.x, y: zone.y, label: "Creature" });
    return;
  }

  if (type === "bounty") {
    const leader = [...match.bots].filter((bot) => bot.alive).sort((a, b) => b.kills - a.kills || b.damageDealt - a.damageDealt)[0];
    event.targetBotId = leader?.id;
    addEvent(match, `${leader?.name ?? "A leading bot"} is marked by an arena bounty.`, undefined, 0, { kind: "system", botId: leader?.id, x: leader?.x, y: leader?.y, label: "Bounty" });
    return;
  }

  addEvent(match, `${describeMapEvent(event)} spreads through the ${zone.name}.`, undefined, 0, { kind: "system", x: zone.x, y: zone.y, label: "Event" });
}

function spawnCreature(match: MatchState, biome: BiomeType, x: number, y: number): void {
  const creature: Creature = {
    id: `creature-${match.nextEventId}`,
    name: biome === "swamp" ? "Bog Stalker" : biome === "cave" ? "Tunnel Wraith" : "Arena Beast",
    health: 36,
    damage: 7,
    aggression: 0.75,
    biome,
    x,
    y,
    lastAttackAt: -Infinity,
  };
  match.creatures.push(creature);
}

function updateCreatures(match: MatchState): void {
  match.creatures = match.creatures.filter((creature) => creature.health > 0 && (!creature.expiresAtMs || creature.expiresAtMs > match.elapsedMs));
  for (const creature of match.creatures) {
    const target = match.bots
      .filter((bot) => bot.alive && distance(bot, creature) <= 260)
      .sort((a, b) => distance(a, creature) - distance(b, creature))[0];
    if (!target) continue;
    creature.targetBotId = target.id;
    const close = distance(target, creature) < 72;
    if (!close) {
      const next = moveToward(creature, target, 1.8);
      creature.x = next.x;
      creature.y = next.y;
      continue;
    }
    if (match.elapsedMs - creature.lastAttackAt < 1300) continue;
    creature.lastAttackAt = match.elapsedMs;
    if (target.psychology.aggression > 0.72 && target.inventory.weapon && deterministicRoll(`${creature.id}:counter:${target.id}:${match.elapsedMs}`) < 0.38) {
      creature.health -= target.inventory.weapon.damage;
      addEvent(match, `${target.name} stands ground against ${creature.name}.`, `creature-fight-${target.id}`, 2800, { kind: "system", botId: target.id, x: target.x, y: target.y, label: "Fight" });
      if (creature.health <= 0) {
        target.xp += 20;
        addEvent(match, `${target.name} defeats ${creature.name} and earns arena XP.`, undefined, 0, { kind: "system", botId: target.id, x: target.x, y: target.y, label: "+XP" });
      }
      continue;
    }
    target.health = Math.max(0, target.health - creature.damage);
    target.wanderTarget = clampToMap(moveAway(target, creature, 120));
    addEvent(match, `${creature.name} mauls ${target.name}; ${target.psychology.selfPreservation > 0.55 ? "they flee" : "they stagger back"}.`, `creature-hit-${target.id}`, 1800, {
      kind: "damage",
      botId: target.id,
      x: target.x,
      y: target.y,
      label: `-${creature.damage}`,
    });
    if (target.health <= 0) {
      eliminateBot(match, target);
      match.matchEventState.lastKillAtMs = match.elapsedMs;
      addEvent(match, `${target.name} was eliminated by ${creature.name}.`, undefined, 0, { kind: "kill", targetId: target.id, x: target.x, y: target.y, label: "Creature" });
      addNarrativeMoment(match, {
        title: `${creature.name} eliminated ${target.name}`,
        severity: "danger",
        relatedBotIds: [target.id],
        location: { x: target.x, z: target.y },
      }, `creature-elim-${target.id}`);
    }
  }
}

function describeMapEvent(event: MapEvent): string {
  if (event.type === "toxic_fog") return "Toxic fog";
  if (event.type === "fire") return "Fire";
  if (event.type === "flood") return "Floodwater";
  if (event.type === "blackout") return "A blackout";
  return event.type.replace("_", " ");
}

function getCombatRangeAffinity(bot: Bot, range: number): number {
  if (range < 80) return bot.affinities.combatRanges.close;
  if (range < 240) return bot.affinities.combatRanges.mid;
  return bot.affinities.combatRanges.long;
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
