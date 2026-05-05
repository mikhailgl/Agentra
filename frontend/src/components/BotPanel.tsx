import type { Bot } from "../game/types";
import { formatTime } from "../format";
import { getBiomeName } from "../game/biomes";
import { xpToNextLevel } from "../game/progression";
import { summarizeRelationships } from "../game/relationships";
import { getTraitLabels } from "../game/traits";

export function BotPanel({
  bot,
  bots,
  compact = false,
}: {
  bot: Bot | null;
  bots: Bot[];
  compact?: boolean;
}) {
  if (!bot) {
    return (
      <section className={`bot-panel empty ${compact ? "compact" : ""}`}>
        <h2>Selected Bot</h2>
        <p>Click a bot on the map.</p>
      </section>
    );
  }

  const relationshipSummary = summarizeRelationships(bot, bots);
  const activeAllyId =
    Object.values(bot.relationships ?? {}).find((relationship) => relationship.alliance?.active)?.alliance?.allyId ?? null;
  const activeAlly = activeAllyId ? bots.find((candidate) => candidate.id === activeAllyId) ?? null : null;
  const level = bot.level ?? 1;
  const xp = bot.xp ?? 0;
  const xpGoal = xpToNextLevel(level);

  return (
    <section className={`bot-panel ${compact ? "compact" : ""}`}>
      <h2>{bot.name}</h2>
      <dl>
        {bot.custom && <Detail label="Origin" value="Player-created" />}
        <Detail label="Status" value={bot.alive ? "Alive" : "Eliminated"} />
        <Detail label="Biome" value={getBiomeName(bot.currentBiome)} />
        <Detail label="Level" value={`${level} (${xp}/${xpGoal} XP)`} />
        <Detail label="Traits" value={getTraitLabels(bot.traits ?? []).join(", ") || "None"} />
        <Detail label="Intent" value={describeIntent(bot, activeAlly?.name)} />
        <Detail label="Personality" value={summarizePersonality(bot)} />
        <Detail label="Weapon" value={bot.inventory.weapon?.name ?? "None"} />
        <Detail label="Armor" value={bot.inventory.armor?.name ?? "None"} />
        <Detail label="Tool" value={bot.inventory.tool?.name ?? "None"} />
        <Detail label="Alliance" value={activeAlly?.name ?? "None"} />
        <Detail label="Trust" value={relationshipSummary.trusted} />
        <Detail label="Fear" value={relationshipSummary.feared} />
        <Detail label="Resentment" value={relationshipSummary.resented} />
      </dl>
      {!compact && <Detail label="Survived" value={formatTime(bot.survivalTimeMs)} />}
      {!compact && <Detail label="Affinities" value={summarizeAffinities(bot)} />}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function summarizePersonality(bot: Bot): string {
  const psychology = bot.psychology;
  if (!psychology) return bot.personality;

  const phrases = [];
  if (psychology.aggression > 0.68) phrases.push("aggressive");
  if (psychology.selfPreservation > 0.68) phrases.push("cautious");
  if (psychology.sociability > 0.65) phrases.push("social");
  if (psychology.loyalty > 0.7) phrases.push("loyal");
  if (psychology.opportunism > 0.68) phrases.push("opportunistic");
  if (psychology.vengefulness > 0.65) phrases.push("vengeful");
  return phrases.slice(0, 3).join(", ") || bot.personality.toLowerCase();
}

function describeIntent(bot: Bot, allyName?: string): string {
  if (allyName && bot.behavior !== "attacking") return `staying near ${allyName}`;
  if (bot.behavior === "attacking") return "pressing an attack";
  if (bot.behavior === "fleeing") return "trying to survive";
  if (bot.behavior === "seeking_loot") return "searching for gear";
  return "watching the field";
}

function summarizeAffinities(bot: Bot): string {
  const biome = Object.entries(bot.affinities?.biomes ?? {}).sort((a, b) => (b[1] ?? 1) - (a[1] ?? 1))[0];
  const weapon = Object.entries(bot.affinities?.weapons ?? {}).sort((a, b) => (b[1] ?? 1) - (a[1] ?? 1))[0];
  return [biome ? getBiomeName(biome[0] as Parameters<typeof getBiomeName>[0]) : "", weapon?.[0] ?? ""].filter(Boolean).join(" / ") || "Neutral";
}
