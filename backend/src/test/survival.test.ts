import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSurvivalRepository } from "../survival/localRepository.js";
import type {
  Action,
  Decision,
  Observation,
  SurvivalWorld,
} from "../../../frontend/src/game/survival/types.js";
import { sheltered } from "../../../frontend/src/game/survival/types.js";
import {
  AnthropicProvider,
  ChatCompletionsProvider,
  OpenAIProvider,
  decisionSchema,
  type ProviderResult,
  type SurvivalProvider,
} from "../survival/provider.js";
import {
  createActorControllers,
  type ActorControllers,
} from "../survival/modelConfig.js";
import type {
  SurvivalCheckpoint,
  SurvivalStore,
} from "../survival/repository.js";
import { SurvivalService } from "../survival/service.js";
import {
  acceptDecision,
  createWorld,
  observe,
  tickWorld,
  walkable,
} from "../survival/world.js";

const decision = (action: Action): Decision => ({
  action,
  plan: "Survive the day.",
  remember: "",
});
function act(world: SurvivalWorld, id: string, action: Action) {
  const bot = world.bots.find((b) => b.id === id)!;
  const accepted = acceptDecision(
    world,
    bot,
    decision(action),
    observe(world, bot),
  );
  for (let i = 0; i < 500 && bot.task; i++) tickWorld(world, 0.25);
  assert.equal(
    bot.task,
    null,
    "action finishes within its bounded route and execution time",
  );
  return accepted;
}

test("gather → craft → build → enter shelter → survive exposure uses real inventory", () => {
  const world = createWorld();
  const bot = world.bots[0];
  act(world, bot.id, { type: "harvest", targetId: "tree-clearing" });
  act(world, bot.id, { type: "harvest", targetId: "tree-clearing" });
  act(world, bot.id, { type: "harvest", targetId: "tree-clearing" });
  act(world, bot.id, { type: "harvest", targetId: "rock-clearing" });
  assert.equal(bot.inventory.wood, 6);
  assert.equal(bot.inventory.stone, 2);
  act(world, bot.id, { type: "craft", recipe: "shelter" });
  assert.equal(bot.inventory.wood, 0);
  assert.equal(bot.inventory.stone, 0);
  assert.equal(bot.inventory.shelter, 1);
  act(world, bot.id, { type: "build", kind: "shelter", x: 11, z: 11 });
  assert.equal(world.structures.length, 1);
  assert.equal(bot.inventory.shelter, 0);
  act(world, bot.id, { type: "move", x: 11, z: 11 });
  assert.equal(sheltered(world, bot), true);
  world.time = 610;
  for (let i = 0; i < 80; i++) tickWorld(world, 0.25);
  assert.equal(bot.health, 100);
  assert.ok(world.bots[1].health < 100);
});

test("two simultaneous harvests cannot duplicate the last resource", () => {
  const world = createWorld();
  const bush = world.resources.find((r) => r.id === "bush-clearing")!;
  bush.remaining = 1;
  world.bots[0].x = 9;
  world.bots[0].z = 8;
  world.bots[1].x = 11;
  world.bots[1].z = 8;
  for (const bot of world.bots)
    acceptDecision(
      world,
      bot,
      decision({ type: "harvest", targetId: bush.id }),
      observe(world, bot),
    );
  for (let i = 0; i < 30; i++) tickWorld(world, 0.25);
  assert.equal(bush.remaining, 0);
  assert.equal(
    world.bots.reduce((total, b) => total + b.inventory.berries, 0),
    1,
  );
  assert.ok(world.events.some((e) => e.text.includes("depleted")));
});

test("observations isolate memories and inventory; speech is local hearsay", () => {
  const world = createWorld();
  world.bots = world.bots.slice(0, 2);
  world.bots[1].inventory.wood = 99;
  world.bots[1].memories.push({
    time: 0,
    source: "note",
    text: "secret promise",
  });
  let observation = observe(world, world.bots[0]);
  assert.ok(!JSON.stringify(observation).includes("secret promise"));
  assert.ok(!("inventory" in observation.visiblePeople[0]));
  act(world, "moss", { type: "say", message: "I will share food." });
  assert.ok(
    world.bots[1].memories.some(
      (m) => m.source === "heard" && m.text.includes("share food"),
    ),
  );
  world.bots[1].x = 21;
  world.bots[1].z = 3;
  act(world, "moss", { type: "say", message: "Can you hear this?" });
  assert.ok(!world.bots[1].memories.some((m) => m.text.includes("hear this")));
  observation = observe(world, world.bots[0]);
  assert.equal(observation.visiblePeople.length, 0);
});

test("unseen targets, occupied construction, unaffordable crafting and malformed actions fail", () => {
  const world = createWorld();
  const bot = world.bots[0];
  assert.equal(
    act(world, bot.id, { type: "harvest", targetId: "tree-22-22" }),
    false,
  );
  act(world, bot.id, { type: "craft", recipe: "axe" });
  assert.equal(bot.inventory.axe, 0);
  bot.inventory.wood = 4;
  act(world, bot.id, { type: "build", kind: "wall", x: 8, z: 9 });
  assert.equal(world.structures.length, 0);
  assert.equal(bot.inventory.wood, 4);
  assert.equal(
    decisionSchema.safeParse(decision({ type: "move", x: NaN, z: 10 })).success,
    false,
  );
  assert.equal(
    decisionSchema.safeParse({
      ...decision({ type: "eat" }),
      command: "spawn resources",
    }).success,
    false,
  );
  assert.equal(
    decisionSchema.safeParse(
      decision({ type: "give", targetId: "ember", item: "wood", quantity: -2 }),
    ).success,
    false,
  );
});

test("wall placement blocks navigation and sight; breaking returns only partial resources", () => {
  const world = createWorld();
  world.bots = world.bots.slice(0, 2);
  world.bots[0].inventory.wood = 2;
  act(world, "moss", { type: "build", kind: "wall", x: 10, z: 10 });
  assert.equal(walkable(world, { x: 10, z: 10 }), false);
  world.bots[0].x = 9;
  world.bots[0].z = 10;
  world.bots[1].x = 11;
  world.bots[1].z = 10;
  assert.equal(observe(world, world.bots[0]).visiblePeople.length, 0);
  act(world, "moss", { type: "break", targetId: world.structures[0].id });
  assert.equal(world.structures.length, 0);
  assert.equal(world.bots[0].inventory.wood, 1);
});

test("give transfers conserved inventory and eating consumes food", () => {
  const world = createWorld();
  world.bots[0].inventory.berries = 3;
  act(world, "moss", {
    type: "give",
    targetId: "ember",
    item: "berries",
    quantity: 2,
  });
  assert.equal(world.bots[0].inventory.berries, 1);
  assert.equal(world.bots[1].inventory.berries, 2);
  const before = world.bots[1].hunger;
  act(world, "ember", { type: "eat" });
  assert.equal(world.bots[1].inventory.berries, 1);
  assert.ok(world.bots[1].hunger > before);
});

const actors = (provider: SurvivalProvider | null): ActorControllers => ({
  moss: { model: provider?.model ?? "gpt-6-astra", provider },
  ember: { model: provider?.model ?? "gpt-6-astra", provider },
  reed: { model: provider?.model ?? "gpt-5.6-luna", provider },
  flint: { model: provider?.model ?? "gpt-5.6-luna", provider },
});

class MemoryStore implements SurvivalStore {
  value: SurvivalCheckpoint | null = null;
  async load() {
    return structuredClone(this.value);
  }
  async save(value: SurvivalCheckpoint) {
    this.value = structuredClone(value);
  }
}
class ControlledProvider implements SurvivalProvider {
  readonly model = "test-controller";
  calls: {
    observation: Observation;
    signal: AbortSignal;
    resolve: (result: ProviderResult) => void;
    reject: (error: Error) => void;
  }[] = [];
  decide(
    observation: Observation,
    signal: AbortSignal,
  ): Promise<ProviderResult> {
    return new Promise((resolve, reject) =>
      this.calls.push({ observation, signal, resolve, reject }),
    );
  }
}
const result = (action: Action): ProviderResult => ({
  decision: decision(action),
  inputTokens: 120,
  outputTokens: 20,
  latencyMs: 10,
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("missing key pauses time and never substitutes a scripted provider", async () => {
  const service = new SurvivalService(new MemoryStore(), actors(null));
  await service.initialize();
  await service.step();
  assert.equal(service.snapshot().runtime.status, "unconfigured");
  assert.equal(service.snapshot().world.time, 0);
  assert.equal(service.snapshot().runtime.decisions, 0);
});

test("four independent calls continue beyond 120 and pause freezes pending results and time", async () => {
  const store = new MemoryStore();
  const provider = new ControlledProvider();
  store.value = {
    world: createWorld(),
    decisions: 120,
    paused: false,
    speed: 1,
    inputTokens: 0,
    outputTokens: 0,
    savedAt: new Date().toISOString(),
  };
  const service = new SurvivalService(store, actors(provider));
  await service.initialize();
  await service.step();
  assert.equal(provider.calls.length, 4);
  assert.equal(store.value?.decisions, 124);
  await service.control(true, 4);
  const before = service.snapshot().world;
  for (const call of provider.calls) call.resolve(result({ type: "rest" }));
  await flush();
  await service.step();
  assert.deepEqual(service.snapshot().world, before);
  const restored = new SurvivalService(store, actors(provider));
  await restored.initialize();
  assert.equal(restored.snapshot().runtime.status, "paused");
  assert.equal(restored.snapshot().runtime.speed, 4);
  await service.control(false, 4);
  await service.step();
  assert.equal(service.snapshot().world.time - before.time, 1);
  assert.equal(service.snapshot().runtime.inputTokens, 480);
  await service.control(false, 0.25);
  const time = service.snapshot().world.time;
  await service.step();
  assert.equal(service.snapshot().world.time - time, 0.0625);
  await assert.rejects(service.control(false, 99));
});

test("model failure pauses and aborts other calls; late results cannot mutate the world", async () => {
  const provider = new ControlledProvider();
  const service = new SurvivalService(new MemoryStore(), actors(provider));
  await service.initialize();
  await service.step();
  provider.calls[0].reject(new Error("model unavailable"));
  await flush();
  await service.step();
  assert.equal(service.snapshot().runtime.status, "error");
  assert.equal(provider.calls[1].signal.aborted, true);
  const before = service.snapshot().world;
  provider.calls[1].resolve(result({ type: "say", message: "Late message" }));
  await flush();
  await service.step();
  assert.deepEqual(service.snapshot().world, before);
});

test("failed restore never overwrites saved data or calls a model", async () => {
  let saved = false;
  const provider = new ControlledProvider();
  const service = new SurvivalService(
    {
      load: async () => {
        throw new Error("offline");
      },
      save: async () => {
        saved = true;
      },
    },
    actors(provider),
  );
  await service.initialize();
  await service.step();
  assert.equal(service.snapshot().runtime.status, "error");
  assert.equal(saved, false);
  assert.equal(provider.calls.length, 0);
});

test("Astra adapter sends private context through real SDK tool calling and validates the reply", async (t) => {
  let body: Record<string, unknown> = {};
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          id: "resp-test",
          object: "response",
          created_at: 0,
          status: "completed",
          model: "gpt-6-astra",
          output: [
            {
              type: "function_call",
              id: "fc-test",
              call_id: "call-test",
              name: "act",
              arguments: JSON.stringify(decision({ type: "eat" })),
            },
          ],
          usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );
  const world = createWorld();
  const provider = new OpenAIProvider("unit-test-key", "gpt-6-astra", "low");
  const response = await provider.decide(
    observe(world, world.bots[0]),
    new AbortController().signal,
  );
  assert.equal(response.decision.action.type, "eat");
  assert.equal(response.inputTokens, 12);
  assert.equal(body.model, "gpt-6-astra");
  assert.equal(body.parallel_tool_calls, false);
  assert.equal(body.store, false);
  assert.ok(!JSON.stringify(body).includes("unit-test-key"));
});

test("model configuration selects each actor independently and rejects silent endpoint fallbacks", () => {
  const config = {
    moss: { provider: "openai", model: "gpt-6-astra", reasoningEffort: "low" },
    ember: { provider: "anthropic", model: "test-claude" },
    reed: { provider: "openai", model: "gpt-5.6-luna" },
    flint: { provider: "openai", model: "gpt-5.6-luna" },
  };
  const controllers = createActorControllers(config, {
    OPENAI_API_KEY: "test-openai",
    ANTHROPIC_API_KEY: "test-anthropic",
  });
  assert.equal(controllers.moss.provider?.model, "gpt-6-astra");
  assert.equal(controllers.ember.provider?.model, "test-claude");
  assert.equal(
    createActorControllers(config, { OPENAI_API_KEY: "test" }).ember.provider,
    null,
  );
  assert.throws(() =>
    createActorControllers({
      ...config,
      ember: { provider: "chat-completions", model: "test" },
    }),
  );
  assert.throws(() =>
    createActorControllers({
      ...config,
      moss: { provider: "unknown", model: "test" },
    }),
  );
});

test("different model controllers act in one world and retain model attribution after a switch", async () => {
  const store = new MemoryStore();
  const mossProvider = new ControlledProvider();
  const emberProvider = new ControlledProvider();
  const service = new SurvivalService(store, {
    ...actors(emberProvider),
    moss: { model: "model-one", provider: mossProvider },
    ember: { model: "model-two", provider: emberProvider },
  });
  await service.initialize();
  await service.step();
  assert.equal(mossProvider.calls[0].observation.self.id, "moss");
  assert.equal(emberProvider.calls[0].observation.self.id, "ember");
  mossProvider.calls[0].resolve(
    result({ type: "say", message: "Hello from one" }),
  );
  emberProvider.calls[0].resolve(
    result({ type: "harvest", targetId: "rock-clearing" }),
  );
  await flush();
  await service.step();
  await store.save(service.checkpoint());
  const restored = new SurvivalService(store, {
    ...actors(emberProvider),
    moss: { model: "model-three", provider: mossProvider },
    ember: { model: "model-two", provider: emberProvider },
  });
  await restored.initialize();
  for (let i = 0; i < 100; i++) await restored.step();
  assert.equal(restored.snapshot().world.bots[0].model, "model-three");
  assert.equal(
    restored.snapshot().world.events.find((e) => e.text === "Hello from one")
      ?.model,
    "model-one",
  );
  assert.equal(
    restored.snapshot().world.events.find((e) => e.botId === "ember")?.model,
    "model-two",
  );
});

test("local development checkpoint round-trips private memories, inventory and budget", async () => {
  const directory = await mkdtemp(join(tmpdir(), "botarena-survival-"));
  try {
    const repo = new LocalSurvivalRepository(join(directory, "world.json"));
    assert.equal(await repo.load(), null);
    const world = createWorld();
    world.bots[0].inventory.wood = 3;
    world.bots[0].memories.push({
      source: "heard",
      time: 0,
      text: "Ember offered to share.",
    });
    const checkpoint: SurvivalCheckpoint = {
      world,
      paused: false,
      speed: 1,
      decisions: 12,
      inputTokens: 100,
      outputTokens: 40,
      savedAt: new Date().toISOString(),
    };
    await repo.save(checkpoint);
    assert.deepEqual(
      await new LocalSurvivalRepository(join(directory, "world.json")).load(),
      checkpoint,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Anthropic and compatible endpoints share the same validated action contract", async (t) => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push({ url: String(url), body });
      const anthropic = String(url).includes("anthropic");
      return new Response(
        JSON.stringify(
          anthropic
            ? {
                id: "msg-test",
                type: "message",
                role: "assistant",
                model: "claude-test",
                stop_reason: "tool_use",
                content: [
                  {
                    type: "tool_use",
                    id: "tool-test",
                    name: "act",
                    input: decision({ type: "rest" }),
                  },
                ],
                usage: { input_tokens: 12, output_tokens: 8 },
              }
            : {
                id: "chat-test",
                choices: [
                  {
                    finish_reason: "tool_calls",
                    message: {
                      role: "assistant",
                      tool_calls: [
                        {
                          id: "call-test",
                          type: "function",
                          function: {
                            name: "act",
                            arguments: JSON.stringify(
                              decision({ type: "rest" }),
                            ),
                          },
                        },
                      ],
                    },
                  },
                ],
                usage: { prompt_tokens: 12, completion_tokens: 8 },
              },
        ),
        { headers: { "content-type": "application/json" } },
      );
    },
  );
  const world = createWorld();
  const observation = observe(world, world.bots[0]);
  const anthropic = await new AnthropicProvider(
    "test-key",
    "claude-test",
  ).decide(observation, new AbortController().signal);
  const compatible = await new ChatCompletionsProvider(
    "test-key",
    "other-test",
    "https://model.example/v1",
  ).decide(observation, new AbortController().signal);
  assert.deepEqual(anthropic.decision, compatible.decision);
  assert.equal(requests[0].body.model, "claude-test");
  assert.equal(requests[1].body.model, "other-test");
  assert.ok(requests[1].url.startsWith("https://model.example/v1/"));
});

test("shutdown waits for the checkpoint reservation and never dispatches after stopping", async () => {
  let release!: () => void;
  let writes = 0;
  const provider = new ControlledProvider();
  const store: SurvivalStore = {
    load: async () => null,
    save: async () => {
      if (++writes === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    },
  };
  const service = new SurvivalService(store, actors(provider));
  await service.initialize();
  const step = service.step();
  const stop = service.stop();
  release();
  await Promise.all([step, stop]);
  assert.equal(provider.calls.length, 0);
  assert.equal(writes, 2);
});

test("depleted renewables return only after their delay; stone stays depleted", () => {
  const world = createWorld();
  const bush = world.resources.find((r) => r.kind === "bush")!;
  const tree = world.resources.find((r) => r.kind === "tree")!;
  const rock = world.resources.find((r) => r.kind === "rock")!;
  bush.remaining = tree.remaining = rock.remaining = 0;
  bush.regrowAt = 900;
  tree.regrowAt = 1800;
  world.time = 899.5;
  tickWorld(world, 0.25);
  assert.equal(bush.remaining, 0);
  tickWorld(world, 0.25);
  assert.equal(bush.remaining, 4);
  assert.equal(tree.remaining, 0);
  world.time = 1799.75;
  tickWorld(world, 0.25);
  assert.equal(tree.remaining, 6);
  assert.equal(rock.remaining, 0);
});
