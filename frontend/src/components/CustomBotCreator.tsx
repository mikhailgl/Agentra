import { useMemo, useState } from "react";
import { BIOMES, getBiomeName } from "../game/biomes";
import { normalizeAffinities } from "../game/persistence";
import type { BaseStats, BiomeType, BotAffinities, Psychology } from "../game/types";

type Archetype = "brute" | "scout" | "tactician" | "survivor" | "trickster" | "hunter";
type Style = "aggressive" | "defensive" | "opportunistic" | "stealthy" | "adaptive";
type StatKey = "strength" | "speed" | "accuracy" | "stealth" | "awareness" | "resilience" | "tactics";

const STAT_KEYS: StatKey[] = ["strength", "speed", "accuracy", "stealth", "awareness", "resilience", "tactics"];
const POINTS = 35;
const ARCHETYPES: Archetype[] = ["brute", "scout", "tactician", "survivor", "trickster", "hunter"];
const STYLES: Style[] = ["aggressive", "defensive", "opportunistic", "stealthy", "adaptive"];

export function CustomBotCreator({
  credits,
  creationCost,
  onClose,
  onCreate,
}: {
  credits: number;
  creationCost: number;
  onClose: () => void;
  onCreate: (build: { name: string; baseStats: BaseStats; psychology: Psychology; traits: string[]; affinities: BotAffinities; tacticalInstruction: string }, enterContest: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState<Archetype>("hunter");
  const [style, setStyle] = useState<Style>("adaptive");
  const [preferredBiome, setPreferredBiome] = useState<BiomeType>("forest");
  const [preferredWeaponType, setPreferredWeaponType] = useState<"melee" | "ranged" | "trap" | "tool">("ranged");
  const [instruction, setInstruction] = useState("");
  const [stats, setStats] = useState<Record<StatKey, number>>({
    strength: 5,
    speed: 5,
    accuracy: 5,
    stealth: 5,
    awareness: 5,
    resilience: 5,
    tactics: 5,
  });
  const spent = Object.values(stats).reduce((sum, value) => sum + value, 0);
  const remaining = POINTS - spent;
  const valid = remaining === 0 && Object.values(stats).every((value) => value >= 1 && value <= 10);
  const canCreate = credits >= creationCost;
  const summary = useMemo(() => interpretBuild(stats, archetype, style, preferredBiome, preferredWeaponType, instruction), [archetype, instruction, preferredBiome, preferredWeaponType, stats, style]);
  const buildBot = () => summary.build(name.trim() || "Custom Bot");

  return (
    <div className="modal-backdrop">
      <section className="profile-modal creator-modal">
        <div className="modal-title-row">
          <div>
            <span>Create a fighter</span>
            <h2>Allocate traits</h2>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="creator-grid">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} placeholder="Custom Bot" />
          </label>
          <label>
            Archetype
            <select value={archetype} onChange={(event) => setArchetype(event.target.value as Archetype)}>
              {ARCHETYPES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
          </label>
          <label>
            Fighting style
            <select value={style} onChange={(event) => setStyle(event.target.value as Style)}>
              {STYLES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
          </label>
          <label>
            Environment
            <select value={preferredBiome} onChange={(event) => setPreferredBiome(event.target.value as BiomeType)}>
              {Object.keys(BIOMES).map((biome) => <option key={biome} value={biome}>{getBiomeName(biome as BiomeType)}</option>)}
            </select>
          </label>
          <label>
            Weapon instinct
            <select value={preferredWeaponType} onChange={(event) => setPreferredWeaponType(event.target.value as typeof preferredWeaponType)}>
              <option value="melee">melee</option>
              <option value="ranged">ranged</option>
              <option value="trap">trap</option>
              <option value="tool">tool</option>
            </select>
          </label>
        </div>
        <div className="stat-editor">
          <div className="credits-line">
            <strong>{remaining} points left</strong>
            <small>35 total, 1-10 per stat</small>
          </div>
          {STAT_KEYS.map((key) => (
            <label key={key}>
              {key}
              <input type="number" min={1} max={10} value={stats[key]} onChange={(event) => setStats((current) => ({ ...current, [key]: Number(event.target.value) }))} />
            </label>
          ))}
        </div>
        <label>
          Define instincts
          <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={140} placeholder="Avoid open fights and ambush weakened enemies" />
        </label>
        <div className="previously-card">
          <strong>Summary before release</strong>
          <p>{summary.text}</p>
        </div>
        <div className="creator-actions">
          <button type="button" className="secondary-button" disabled={!valid || !canCreate} title={!valid ? "Spend exactly 35 points" : canCreate ? "" : `Need ${creationCost} credits to create`} onClick={() => onCreate(buildBot(), false)}>
            Create ({creationCost} credits)
          </button>
          <button type="button" disabled={!valid || !canCreate} title={!valid ? "Spend exactly 35 points" : canCreate ? "" : `Need ${creationCost} credits to create and enter`} onClick={() => onCreate(buildBot(), true)}>
            Create and enter ({creationCost} credits)
          </button>
        </div>
      </section>
    </div>
  );
}

function interpretBuild(
  stats: Record<StatKey, number>,
  archetype: Archetype,
  style: Style,
  preferredBiome: BiomeType,
  preferredWeaponType: "melee" | "ranged" | "trap" | "tool",
  instruction: string,
) {
  const lower = instruction.toLowerCase();
  const psychology: Psychology = {
    aggression: 0.42,
    loyalty: 0.45,
    opportunism: 0.45,
    selfPreservation: 0.45,
    ambition: 0.48,
    sociability: 0.42,
    vengefulness: 0.42,
    riskTolerance: 0.45,
  };
  if (style === "aggressive" || lower.includes("aggressive") || lower.includes("take risks")) psychology.aggression += 0.24;
  if (style === "defensive" || lower.includes("avoid") || lower.includes("retreat")) psychology.selfPreservation += 0.24;
  if (style === "opportunistic" || lower.includes("weakened") || lower.includes("loot")) psychology.opportunism += 0.22;
  if (style === "stealthy" || lower.includes("ambush") || lower.includes("hide")) psychology.riskTolerance -= 0.08;
  if (lower.includes("revenge")) psychology.vengefulness += 0.18;
  if (archetype === "brute") psychology.aggression += 0.13;
  if (archetype === "survivor") psychology.selfPreservation += 0.15;
  if (archetype === "trickster") psychology.opportunism += 0.14;
  if (archetype === "hunter") psychology.ambition += 0.15;

  const affinities = normalizeAffinities();
  affinities.biomes[preferredBiome] = 1.18;
  if (lower.includes("high ground")) affinities.biomes.high_ground = 1.22;
  if (lower.includes("forest")) affinities.biomes.forest = 1.2;
  if (preferredWeaponType === "ranged" || lower.includes("ranged") || lower.includes("rifle") || lower.includes("bow")) {
    affinities.weapons.Bow = 1.16;
    affinities.weapons["Hunting Bow"] = 1.2;
    affinities.weapons["Scoped Rifle"] = 1.18;
    affinities.combatRanges.long = 1.16;
  }
  if (preferredWeaponType === "melee") {
    affinities.weapons.Knife = 1.16;
    affinities.weapons.Axe = 1.16;
    affinities.combatRanges.close = 1.16;
  }
  if (preferredWeaponType === "trap" || lower.includes("trap")) affinities.tools["Trap Kit"] = 1.2;
  if (preferredWeaponType === "tool" || lower.includes("smoke")) affinities.tools["Smoke Bomb"] = 1.18;

  const baseStats: BaseStats = {
    strength: 5 + stats.strength * 0.75 + stats.resilience * 0.15,
    speed: 5 + stats.speed * 0.78 + stats.stealth * 0.12,
    perception: 5 + stats.accuracy * 0.42 + stats.awareness * 0.42 + stats.tactics * 0.12,
    endurance: 5 + stats.resilience * 0.78 + stats.tactics * 0.12,
  };
  const traits = [style === "stealthy" ? "paranoid" : style === "opportunistic" ? "opportunist" : style === "aggressive" ? "bloodthirsty" : archetype === "scout" ? "sprinter" : "duelist"];

  return {
    text: `${archetype} / ${style}. Prefers ${getBiomeName(preferredBiome)} and ${preferredWeaponType} opportunities. Instruction is converted into tendencies only.`,
    build: (name: string) => ({
      name,
      baseStats,
      psychology: clampPsychology(psychology),
      traits,
      affinities,
      tacticalInstruction: instruction,
    }),
  };
}

function clampPsychology(psychology: Psychology): Psychology {
  return Object.fromEntries(Object.entries(psychology).map(([key, value]) => [key, Math.max(0, Math.min(1, value))])) as Psychology;
}
