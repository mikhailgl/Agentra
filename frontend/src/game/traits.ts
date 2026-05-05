import type { Bot, PersistentBot, Psychology } from "./types";

export type TraitDefinition = {
  id: string;
  label: string;
  psychology: Partial<Psychology>;
  strengthBonus?: number;
  fleeBonus?: number;
  lootBonus?: number;
  escapeSpeedBonus?: number;
  perceptionBonus?: number;
};

export const TRAITS: TraitDefinition[] = [
  { id: "bloodthirsty", label: "Bloodthirsty", psychology: { aggression: 0.16, riskTolerance: 0.08 } },
  { id: "cowardly", label: "Cowardly", psychology: { selfPreservation: 0.18, riskTolerance: -0.12 }, fleeBonus: 0.18 },
  { id: "scavenger", label: "Scavenger", psychology: { opportunism: 0.08 }, lootBonus: 0.22 },
  { id: "opportunist", label: "Opportunist", psychology: { opportunism: 0.18, loyalty: -0.08 } },
  { id: "loyal", label: "Loyal", psychology: { loyalty: 0.18, sociability: 0.08 } },
  { id: "sprinter", label: "Sprinter", psychology: { riskTolerance: 0.04 }, escapeSpeedBonus: 0.2 },
  { id: "paranoid", label: "Paranoid", psychology: { selfPreservation: 0.1 }, perceptionBonus: 0.18 },
  { id: "duelist", label: "Duelist", psychology: { ambition: 0.1, aggression: 0.08 }, strengthBonus: 0.1 },
];

export function getTraitLabels(traitIds: string[]): string[] {
  return traitIds.map((id) => getTrait(id).label);
}

export function getTrait(id: string): TraitDefinition {
  return TRAITS.find((trait) => trait.id === id) ?? TRAITS[0];
}

export function applyTraitPsychology(bot: PersistentBot): Psychology {
  const psychology = { ...bot.psychology };
  for (const traitId of bot.traits) {
    const trait = getTrait(traitId);
    for (const key of Object.keys(trait.psychology) as Array<keyof Psychology>) {
      psychology[key] = clamp01(psychology[key] + (trait.psychology[key] ?? 0));
    }
  }
  return psychology;
}

export function getTraitModifier(bot: Bot, key: "strengthBonus" | "fleeBonus" | "lootBonus" | "escapeSpeedBonus" | "perceptionBonus"): number {
  return bot.traits.reduce((total, traitId) => total + (getTrait(traitId)[key] ?? 0), 0);
}

export function chooseNewTrait(existingTraits: string[], random: () => number): string {
  const options = TRAITS.filter((trait) => !existingTraits.includes(trait.id));
  return (options[Math.floor(random() * options.length)] ?? TRAITS[0]).id;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
