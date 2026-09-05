import {
  distance,
  isDaylight,
  isWater,
  RECIPES,
  sheltered,
} from "../../../frontend/src/game/survival/types.js";
import type {
  Action,
  Decision,
  Item,
  Observation,
  Position,
  Resource,
  Survivor,
  SurvivalWorld,
} from "../../../frontend/src/game/survival/types.js";

export function createWorld(): SurvivalWorld {
  const bots: Survivor[] = [
    {
      id: "moss",
      name: "Moss",
      color: "#dfad65",
      disposition: "You are curious and sociable. Your choices are your own.",
      x: 9,
      z: 10,
    },
    {
      id: "ember",
      name: "Ember",
      color: "#7cc4ca",
      disposition:
        "You are observant and independent. Your choices are your own.",
      x: 12,
      z: 10,
    },
    {
      id: "reed",
      name: "Reed",
      color: "#a6b978",
      disposition:
        "You are patient and cooperative. Your choices are your own.",
      x: 9,
      z: 12,
    },
    {
      id: "flint",
      name: "Flint",
      color: "#b59bd4",
      disposition:
        "You are resourceful and ambitious. Your choices are your own.",
      x: 12,
      z: 12,
    },
  ].map((bot) => ({
    ...bot,
    health: 100,
    hunger: 76,
    inventory: { wood: 0, stone: 0, berries: 0, axe: 0, shelter: 0 },
    model: "",
    plan: "Survive.",
    memories: [],
    knownResources: [],
    task: null,
    speech: null,
    decisions: 0,
  }));
  const resources: Resource[] = [];
  for (let x = 2; x < 23; x += 2) {
    for (let z = 2; z < 23; z += 2) {
      if (
        isWater({ x, z }) ||
        (x > 7 && x < 15 && z > 7 && z < 14) ||
        (x * 7 + z * 11) % 5 === 0
      )
        continue;
      const kind =
        (x + z * 3) % 7 < 2 ? "rock" : (x * 3 + z) % 7 < 2 ? "bush" : "tree";
      resources.push({
        id: `${kind}-${x}-${z}`,
        x,
        z,
        kind,
        regrowAt: null,
        remaining: kind === "tree" ? 6 : kind === "rock" ? 5 : 4,
      });
    }
  }
  resources.push(
    {
      id: "bush-clearing",
      x: 10,
      z: 8,
      kind: "bush",
      remaining: 8,
      regrowAt: null,
    },
    {
      id: "tree-clearing",
      x: 8,
      z: 9,
      kind: "tree",
      remaining: 10,
      regrowAt: null,
    },
    {
      id: "rock-clearing",
      x: 13,
      z: 8,
      kind: "rock",
      remaining: 8,
      regrowAt: null,
    },
  );
  return {
    version: 1,
    size: 24,
    time: 0,
    bots,
    resources,
    structures: [],
    events: [],
    nextEvent: 1,
  };
}

function cell(p: Position): Position {
  return { x: Math.round(p.x), z: Math.round(p.z) };
}
function same(a: Position, b: Position) {
  return a.x === b.x && a.z === b.z;
}
export function walkable(world: SurvivalWorld, p: Position): boolean {
  return (
    Number.isInteger(p.x) &&
    Number.isInteger(p.z) &&
    p.x >= 1 &&
    p.z >= 1 &&
    p.x < world.size - 1 &&
    p.z < world.size - 1 &&
    !isWater(p) &&
    !world.structures.some((s) => s.kind === "wall" && same(s, p)) &&
    !world.resources.some(
      (r) => r.remaining > 0 && r.kind !== "bush" && same(r, p),
    )
  );
}

// A small, bounded uniform-cost grid needs only breadth-first search.
function findPath(
  world: SurvivalWorld,
  from: Position,
  target: Position,
  adjacent: boolean,
): Position[] | null {
  const start = cell(from);
  const queue = [start];
  const parents = new Map<string, Position | null>([
    [`${start.x},${start.z}`, null],
  ]);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (adjacent ? distance(current, target) <= 1.45 : same(current, target)) {
      const path: Position[] = [];
      let next: Position | null = current;
      while (next && !same(next, start)) {
        path.unshift(next);
        next = parents.get(`${next.x},${next.z}`) ?? null;
      }
      return path;
    }
    for (const step of [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ]) {
      const next = { x: current.x + step.x, z: current.z + step.z };
      const key = `${next.x},${next.z}`;
      if (!parents.has(key) && walkable(world, next)) {
        parents.set(key, current);
        queue.push(next);
      }
    }
  }
  return null;
}

export function visible(
  world: SurvivalWorld,
  bot: Position,
  target: Position,
): boolean {
  if (distance(bot, target) > (isDaylight(world.time) ? 7 : 4)) return false;
  const steps = Math.ceil(distance(bot, target) * 3);
  for (let i = 1; i < steps; i++) {
    const p = cell({
      x: bot.x + ((target.x - bot.x) * i) / steps,
      z: bot.z + ((target.z - bot.z) * i) / steps,
    });
    if (
      !same(p, cell(target)) &&
      world.structures.some((s) => s.kind === "wall" && same(s, p))
    )
      return false;
  }
  return true;
}

export function observe(world: SurvivalWorld, bot: Survivor): Observation {
  const visibleResources = world.resources.filter((r) =>
    visible(world, bot, r),
  );
  const known = new Map(bot.knownResources.map((r) => [r.id, r]));
  for (const r of visibleResources) known.set(r.id, { ...r });
  bot.knownResources = [...known.values()];
  const { task: _task, speech: _speech, knownResources: _known, ...self } = bot;
  const nearbyWater: Position[] = [];
  for (let x = 1; x < world.size - 1; x++)
    for (let z = 1; z < world.size - 1; z++) {
      if (isWater({ x, z }) && visible(world, bot, { x, z }))
        nearbyWater.push({ x, z });
    }
  return structuredClone({
    self,
    time: world.time,
    daylight: isDaylight(world.time),
    sheltered: sheltered(world, bot),
    worldSize: world.size,
    visibleResources,
    rememberedResources: bot.knownResources.filter(
      (r) => !visibleResources.some((v) => v.id === r.id),
    ),
    visiblePeople: world.bots
      .filter((p) => p.id !== bot.id && visible(world, bot, p))
      .map((p) => ({
        id: p.id,
        name: p.name,
        x: p.x,
        z: p.z,
        health: p.health,
        speech:
          p.speech && p.speech.until > world.time ? p.speech.message : null,
      })),
    visibleStructures: world.structures.filter((s) => visible(world, bot, s)),
    nearbyWater,
  });
}

export function remember(
  world: SurvivalWorld,
  bot: Survivor,
  text: string,
  source: "result" | "heard" | "note" = "result",
) {
  bot.memories.push({ time: world.time, source, text: text.slice(0, 500) });
  bot.memories = bot.memories.slice(-48);
}

function event(
  world: SurvivalWorld,
  bot: Survivor,
  text: string,
  kind: "action" | "speech" | "death" = "action",
  model = bot.model,
) {
  world.events.push({
    id: world.nextEvent++,
    time: world.time,
    botId: bot.id,
    model,
    kind,
    text,
  });
  world.events = world.events.slice(-150);
}

function finish(world: SurvivalWorld, bot: Survivor, message: string) {
  const model = bot.task?.model ?? bot.model;
  bot.task = null;
  remember(world, bot, message);
  event(world, bot, message, "action", model);
}

export function acceptDecision(
  world: SurvivalWorld,
  bot: Survivor,
  decision: Decision,
  observation: Observation,
): boolean {
  if (bot.health <= 0 || bot.task) return false;
  bot.plan = decision.plan;
  if (decision.remember) remember(world, bot, decision.remember, "note");
  const action = decision.action;
  let target: Position | undefined;
  let adjacent = true;
  if (action.type === "move" || action.type === "build") {
    target = { x: action.x, z: action.z };
    if (action.type === "move") adjacent = false;
  } else if (action.type === "harvest") {
    target = observation.visibleResources.find(
      (r) => r.id === action.targetId && r.remaining > 0,
    );
  } else if (action.type === "break") {
    target = observation.visibleStructures.find(
      (s) => s.id === action.targetId,
    );
  } else if (action.type === "give" || action.type === "attack") {
    target = observation.visiblePeople.find(
      (p) => p.id === action.targetId && p.health > 0,
    );
  }
  if (["harvest", "break", "give", "attack"].includes(action.type) && !target) {
    finish(
      world,
      bot,
      "Action rejected: that target was not in your observation.",
    );
    return false;
  }
  if (
    target &&
    (!Number.isInteger(target.x) || !Number.isInteger(target.z)) &&
    (action.type === "move" || action.type === "build")
  ) {
    finish(world, bot, "Action rejected: use integer grid coordinates.");
    return false;
  }
  if (
    target &&
    (target.x < 1 ||
      target.z < 1 ||
      target.x >= world.size - 1 ||
      target.z >= world.size - 1)
  ) {
    finish(world, bot, "Action rejected: outside the island.");
    return false;
  }
  const path = target ? findPath(world, bot, cell(target), adjacent) : [];
  if (!path) {
    finish(world, bot, "Action failed: no walkable route to that destination.");
    return false;
  }
  bot.task = {
    action,
    path,
    model: bot.model,
    remaining:
      action.type === "harvest"
        ? bot.inventory.axe
          ? 2
          : 4
        : action.type === "rest"
          ? 10
          : 2,
  };
  return true;
}

function execute(world: SurvivalWorld, bot: Survivor, action: Action) {
  if (action.type === "move") {
    finish(world, bot, `Reached (${action.x}, ${action.z}).`);
    return;
  }
  if (action.type === "harvest") {
    const r = world.resources.find((r) => r.id === action.targetId);
    if (!r || r.remaining <= 0 || distance(bot, r) > 1.5) {
      finish(world, bot, "Harvest failed: resource depleted or out of reach.");
      return;
    }
    const item: Item =
      r.kind === "tree" ? "wood" : r.kind === "rock" ? "stone" : "berries";
    const amount = Math.min(
      r.remaining,
      bot.inventory.axe && item === "wood" ? 3 : 2,
    );
    r.remaining -= amount;
    if (r.remaining === 0 && r.kind !== "rock")
      r.regrowAt = world.time + (r.kind === "bush" ? 900 : 1800);
    bot.inventory[item] += amount;
    finish(world, bot, `Gathered ${amount} ${item} from ${r.id}.`);
    return;
  }
  if (action.type === "craft") {
    const cost = RECIPES[action.recipe];
    if (bot.inventory.wood < cost.wood || bot.inventory.stone < cost.stone) {
      finish(
        world,
        bot,
        `Craft failed: ${action.recipe} needs ${cost.wood} wood and ${cost.stone} stone.`,
      );
      return;
    }
    bot.inventory.wood -= cost.wood;
    bot.inventory.stone -= cost.stone;
    bot.inventory[action.recipe]++;
    finish(
      world,
      bot,
      `Crafted a ${action.recipe}${action.recipe === "shelter" ? " kit; build it to create shelter" : ""}.`,
    );
    return;
  }
  if (action.type === "build") {
    const p = { x: action.x, z: action.z };
    const occupied =
      world.structures.some((s) => same(s, p)) ||
      world.resources.some((r) => r.remaining > 0 && same(r, p)) ||
      (action.kind === "wall" &&
        world.bots.some((b) => b.health > 0 && distance(b, p) < 0.85));
    if (!walkable(world, p) || occupied || distance(bot, p) > 1.5) {
      finish(
        world,
        bot,
        "Build failed: this cell is occupied, unreachable, or not land.",
      );
      return;
    }
    const item = action.kind === "wall" ? "wood" : "shelter";
    const cost = action.kind === "wall" ? 2 : 1;
    if (bot.inventory[item] < cost) {
      finish(world, bot, `Build failed: need ${cost} ${item}.`);
      return;
    }
    bot.inventory[item] -= cost;
    world.structures.push({
      ...p,
      id: `structure-${world.nextEvent}`,
      kind: action.kind,
      builderId: bot.id,
    });
    finish(
      world,
      bot,
      `Built ${action.kind} at (${p.x}, ${p.z}).${action.kind === "shelter" ? " Stand inside to stay warm at night." : ""}`,
    );
    return;
  }
  if (action.type === "break") {
    const s = world.structures.find((s) => s.id === action.targetId);
    if (!s || distance(bot, s) > 1.5) {
      finish(world, bot, "Break failed: structure gone or out of reach.");
      return;
    }
    world.structures = world.structures.filter((other) => other.id !== s.id);
    bot.inventory.wood += s.kind === "wall" ? 1 : 3;
    finish(world, bot, `Broke ${s.kind}; recovered some wood.`);
    return;
  }
  if (action.type === "eat") {
    if (bot.inventory.berries < 1) {
      finish(world, bot, "Eat failed: no berries in inventory.");
      return;
    }
    bot.inventory.berries--;
    bot.hunger = Math.min(100, bot.hunger + 24);
    finish(world, bot, "Ate berries; restored 24 hunger.");
    return;
  }
  if (action.type === "give" || action.type === "attack") {
    const target = world.bots.find(
      (b) => b.id === action.targetId && b.id !== bot.id && b.health > 0,
    );
    if (!target || distance(bot, target) > 1.5) {
      finish(world, bot, "Action failed: survivor moved out of reach.");
      return;
    }
    if (action.type === "give") {
      if (
        !Number.isInteger(action.quantity) ||
        action.quantity < 1 ||
        bot.inventory[action.item] < action.quantity
      ) {
        finish(
          world,
          bot,
          "Transfer failed: insufficient items or invalid quantity.",
        );
        return;
      }
      bot.inventory[action.item] -= action.quantity;
      target.inventory[action.item] += action.quantity;
      remember(
        world,
        target,
        `${bot.name} gave you ${action.quantity} ${action.item}.`,
      );
      finish(
        world,
        bot,
        `Gave ${target.name} ${action.quantity} ${action.item}.`,
      );
    } else {
      const damage = bot.inventory.axe ? 16 : 6;
      target.health = Math.max(0, target.health - damage);
      target.task = null;
      remember(world, target, `${bot.name} attacked you for ${damage} damage.`);
      finish(world, bot, `Attacked ${target.name} for ${damage} damage.`);
    }
    return;
  }
  if (action.type === "say") {
    const model = bot.task?.model ?? bot.model;
    bot.speech = { message: action.message, until: world.time + 20 };
    for (const listener of world.bots) {
      if (
        listener.id !== bot.id &&
        listener.health > 0 &&
        distance(bot, listener) <= 6
      ) {
        remember(
          world,
          listener,
          `${bot.name} said: ${action.message}`,
          "heard",
        );
        if (listener.task?.action.type === "rest") listener.task = null;
      }
    }
    bot.task = null;
    remember(world, bot, `You said: ${action.message}`);
    event(world, bot, action.message, "speech", model);
    return;
  }
  if (bot.hunger > 30 && sheltered(world, bot))
    bot.health = Math.min(100, bot.health + 3);
  finish(
    world,
    bot,
    sheltered(world, bot) ? "Rested under shelter." : "Rested outdoors.",
  );
}

export function tickWorld(world: SurvivalWorld, seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const dt = Math.min(seconds, 0.5);
  world.time += dt;
  for (const resource of world.resources) {
    if (
      resource.regrowAt !== null &&
      world.time >= resource.regrowAt &&
      !world.structures.some((s) => same(s, resource)) &&
      !world.bots.some((b) => b.health > 0 && distance(b, resource) < 0.85)
    ) {
      resource.remaining = resource.kind === "bush" ? 4 : 6;
      resource.regrowAt = null;
    }
  }
  for (const bot of world.bots) {
    if (bot.health <= 0) {
      bot.task = null;
      continue;
    }
    bot.hunger = Math.max(0, bot.hunger - dt * 0.06);
    if (bot.hunger === 0) bot.health = Math.max(0, bot.health - dt * 0.35);
    if (!isDaylight(world.time) && !sheltered(world, bot))
      bot.health = Math.max(0, bot.health - dt * 0.08);
    if (bot.health <= 0) {
      bot.task = null;
      event(world, bot, `${bot.name} died.`, "death");
      continue;
    }
    const task = bot.task;
    if (!task) continue;
    const next = task.path[0];
    if (next) {
      if (!walkable(world, next)) {
        finish(
          world,
          bot,
          "Movement interrupted: route blocked. Choose a new route.",
        );
        continue;
      }
      const d = distance(bot, next);
      const step = dt * 1.6;
      if (d <= step) {
        bot.x = next.x;
        bot.z = next.z;
        task.path.shift();
      } else {
        bot.x += ((next.x - bot.x) / d) * step;
        bot.z += ((next.z - bot.z) / d) * step;
      }
    } else {
      task.remaining -= dt;
      if (task.remaining <= 0) execute(world, bot, task.action);
    }
  }
}
