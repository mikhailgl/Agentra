import { SOCIAL_SCAN_RANGE } from "./constants";
import { distance } from "./math";
import type { Bot, GameEvent, MatchState, Relationship } from "./types";

export function getRelationship(bot: Bot, otherId: string): Relationship {
  bot.relationships ??= {};
  bot.relationships[otherId] ??= {
    trust: 0.5,
    fear: 0.1,
    respect: 0.25,
    resentment: 0,
    familiarity: 0,
  };
  return bot.relationships[otherId];
}

export function adjustRelationship(
  bot: Bot,
  otherId: string,
  changes: Partial<Omit<Relationship, "alliance">>,
): void {
  const relationship = getRelationship(bot, otherId);
  for (const key of Object.keys(changes) as Array<keyof Omit<Relationship, "alliance">>) {
    relationship[key] = clamp01(relationship[key] + (changes[key] ?? 0));
  }
}

export function areAllied(a: Bot, b: Bot, now: number): boolean {
  const alliance = getRelationship(a, b.id).alliance;
  return Boolean(alliance?.active && alliance.allyId === b.id && alliance.expiresAt > now);
}

export function createAlliance(a: Bot, b: Bot, now: number, durationMs: number, reason: string): void {
  getRelationship(a, b.id).alliance = { active: true, allyId: b.id, startedAt: now, expiresAt: now + durationMs, reason };
  getRelationship(b, a.id).alliance = { active: true, allyId: a.id, startedAt: now, expiresAt: now + durationMs, reason };
  adjustRelationship(a, b.id, { trust: 0.08, familiarity: 0.08 });
  adjustRelationship(b, a.id, { trust: 0.08, familiarity: 0.08 });
}

export function endAlliance(a: Bot, b: Bot): void {
  const aRel = getRelationship(a, b.id);
  const bRel = getRelationship(b, a.id);
  if (aRel.alliance) aRel.alliance.active = false;
  if (bRel.alliance) bRel.alliance.active = false;
}

export function betrayAlliance(attacker: Bot, target: Bot): void {
  endAlliance(attacker, target);
  adjustRelationship(target, attacker.id, { trust: -0.45, resentment: 0.45, fear: 0.15 });
  adjustRelationship(attacker, target.id, { trust: -0.18, resentment: 0.12 });
}

export function updatePeacefulProximity(match: MatchState, deltaMs: number): void {
  const gain = Math.min(0.004, deltaMs / 60_000);
  for (const bot of match.bots) {
    if (!bot.alive) continue;
    for (const other of match.bots) {
      if (!other.alive || other.id === bot.id || distance(bot, other) > 95) continue;
      adjustRelationship(bot, other.id, { familiarity: gain, trust: gain * 0.35 });
    }
  }
}

export function recordAttack(attacker: Bot, target: Bot): void {
  adjustRelationship(target, attacker.id, { trust: -0.12, resentment: 0.16, fear: 0.04 });
  adjustRelationship(attacker, target.id, { familiarity: 0.04 });
}

export function recordKill(match: MatchState, killer: Bot, victim: Bot, victimStrength: number): void {
  const strongKill = victimStrength > 95;
  for (const witness of match.bots) {
    if (!witness.alive || witness.id === killer.id || distance(witness, killer) > getPerceptionRange(witness)) continue;
    adjustRelationship(witness, killer.id, {
      fear: strongKill ? 0.12 : 0.06,
      respect: strongKill ? 0.12 : 0.05,
      familiarity: 0.04,
    });
  }
  adjustRelationship(victim, killer.id, { resentment: 0.35, trust: -0.22 });
}

export function recordFlee(match: MatchState, fleeingBot: Bot): void {
  for (const witness of match.bots) {
    if (!witness.alive || witness.id === fleeingBot.id || distance(witness, fleeingBot) > getPerceptionRange(witness)) continue;
    adjustRelationship(witness, fleeingBot.id, { respect: -0.015, familiarity: 0.01 });
  }
}

export function recordHelp(match: MatchState, helper: Bot, ally: Bot): void {
  adjustRelationship(ally, helper.id, { trust: 0.08, respect: 0.05, familiarity: 0.04 });
  adjustRelationship(helper, ally.id, { familiarity: 0.03 });
}

export function expireAlliances(
  match: MatchState,
  log: (message: string, key?: string, debounceMs?: number, meta?: Partial<GameEvent>) => void,
): void {
  for (const bot of match.bots) {
    for (const [otherId, relationship] of Object.entries(bot.relationships)) {
      const alliance = relationship.alliance;
      if (!alliance?.active || alliance.expiresAt > match.elapsedMs) continue;
      alliance.active = false;
      const other = match.bots.find((candidate) => candidate.id === otherId);
      if (other) {
        const reciprocal = getRelationship(other, bot.id).alliance;
        if (reciprocal) reciprocal.active = false;
        log(`${bot.name} and ${other.name}'s alliance ended.`, `alliance-end-${[bot.id, other.id].sort().join("-")}`, 4000, {
          kind: "alliance",
          botId: bot.id,
          targetId: other.id,
          x: (bot.x + other.x) / 2,
          y: (bot.y + other.y) / 2,
          label: "Alliance ended",
        });
      }
    }
  }
}

export function getActiveAlly(bot: Bot, match: MatchState): Bot | null {
  for (const [otherId, relationship] of Object.entries(bot.relationships)) {
    if (!relationship.alliance?.active || relationship.alliance.expiresAt <= match.elapsedMs) continue;
    return match.bots.find((candidate) => candidate.id === otherId && candidate.alive) ?? null;
  }
  return null;
}

export function summarizeRelationships(bot: Bot, bots: Bot[]) {
  const livingNames = new Map(bots.map((candidate) => [candidate.id, candidate.name]));
  const entries = Object.entries(bot.relationships ?? {}).filter(([id]) => livingNames.has(id));
  const topBy = (key: keyof Omit<Relationship, "alliance">) =>
    entries.sort((a, b) => b[1][key] - a[1][key])[0]?.[0] ?? null;

  return {
    trusted: label(topBy("trust"), livingNames),
    feared: label(topBy("fear"), livingNames),
    respected: label(topBy("respect"), livingNames),
    resented: label(topBy("resentment"), livingNames),
  };
}

export function getPerceptionRange(bot: Bot): number {
  return SOCIAL_SCAN_RANGE + bot.baseStats.perception * 8;
}

function label(id: string | null, names: Map<string, string>): string {
  return id ? names.get(id) ?? "Unknown" : "None";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
