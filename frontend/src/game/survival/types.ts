export type Position = { x: number; z: number };
export type Item = "wood" | "stone" | "berries" | "axe" | "shelter";
export type Inventory = Record<Item, number>;
export type Resource = Position & {
  id: string;
  kind: "tree" | "rock" | "bush";
  remaining: number;
  regrowAt: number | null;
};
export type Structure = Position & {
  id: string;
  kind: "wall" | "shelter";
  builderId: string;
};
export type Action =
  | { type: "move"; x: number; z: number }
  | { type: "harvest"; targetId: string }
  | { type: "craft"; recipe: "axe" | "shelter" }
  | { type: "build"; kind: "wall" | "shelter"; x: number; z: number }
  | { type: "break"; targetId: string }
  | { type: "eat" }
  | { type: "give"; targetId: string; item: Item; quantity: number }
  | { type: "say"; message: string }
  | { type: "attack"; targetId: string }
  | { type: "rest" };
export type Decision = { plan: string; remember: string; action: Action };
export type Memory = {
  time: number;
  source: "result" | "heard" | "note";
  text: string;
};
export type Survivor = Position & {
  id: string;
  name: string;
  color: string;
  disposition: string;
  model: string;
  health: number;
  hunger: number;
  inventory: Inventory;
  plan: string;
  memories: Memory[];
  knownResources: Resource[];
  task: {
    action: Action;
    path: Position[];
    remaining: number;
    model: string;
  } | null;
  speech: { message: string; until: number } | null;
  decisions: number;
};
export type WorldEvent = {
  id: number;
  time: number;
  botId: string;
  model: string;
  kind: "action" | "speech" | "death";
  text: string;
};
export type SurvivalWorld = {
  version: 1;
  size: number;
  time: number;
  bots: Survivor[];
  resources: Resource[];
  structures: Structure[];
  events: WorldEvent[];
  nextEvent: number;
};
export type Observation = {
  self: Omit<Survivor, "task" | "speech" | "knownResources">;
  time: number;
  daylight: boolean;
  sheltered: boolean;
  worldSize: number;
  visibleResources: Resource[];
  rememberedResources: Resource[];
  visiblePeople: {
    id: string;
    name: string;
    x: number;
    z: number;
    health: number;
    speech: string | null;
  }[];
  visibleStructures: Structure[];
  nearbyWater: Position[];
};
export type SurvivalSnapshot = {
  world: Omit<SurvivalWorld, "bots"> & {
    bots: Omit<Survivor, "memories" | "knownResources" | "disposition">[];
  };
  runtime: {
    status:
      "starting" | "running" | "unconfigured" | "paused" | "ended" | "error";
    message: string;
    models: Record<string, string>;
    thinking: string[];
    decisions: number;
    speed: number;
    inputTokens: number;
    outputTokens: number;
    lastLatencyMs: number | null;
    savedAt: string | null;
  };
};

export const RECIPES = {
  axe: { wood: 2, stone: 2 },
  shelter: { wood: 6, stone: 2 },
} as const;
export const isDaylight = (time: number) => time % 900 < 600;
export const isWater = ({ x, z }: Position) =>
  (x - 18) ** 2 + (z - 17) ** 2 < 15;
export const distance = (a: Position, b: Position) =>
  Math.hypot(a.x - b.x, a.z - b.z);
export const sheltered = (
  world: Pick<SurvivalWorld, "structures">,
  bot: Position,
) =>
  world.structures.some((s) => s.kind === "shelter" && distance(s, bot) < 0.8);
