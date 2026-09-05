import type {
  Observation,
  SurvivalSnapshot,
  SurvivalWorld,
} from "../../../frontend/src/game/survival/types.js";
import { AgentOperationRegistry } from "../agents/operationRegistry.js";
import { decisionSchema, type ProviderResult } from "./provider.js";
import type { ActorControllers } from "./modelConfig.js";
import type { SurvivalCheckpoint, SurvivalStore } from "./repository.js";
import { acceptDecision, createWorld, observe, tickWorld } from "./world.js";

type Completion = {
  botId: string;
  operationId: string;
  observation: Observation;
  result?: ProviderResult;
  error?: unknown;
};
export class SurvivalService {
  private world: SurvivalWorld = createWorld();
  private readonly operations = new AgentOperationRegistry();
  private readonly requests = new Map<string, AbortController>();
  private readonly nextDecision = new Map<string, number>();
  private completions: Completion[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private stepping = false;
  private stopped = false;
  private stepFinished: (() => void) | null = null;
  private runtime: SurvivalSnapshot["runtime"];

  constructor(
    private readonly store: SurvivalStore,
    private readonly actors: ActorControllers,
    decisionLimit = 120,
  ) {
    if (!Number.isInteger(decisionLimit) || decisionLimit < 1)
      throw new Error("SURVIVAL_DECISION_LIMIT must be a positive integer.");
    this.runtime = {
      status: "starting",
      message: "Restoring the island…",
      models: Object.fromEntries(
        Object.entries(actors).map(([id, actor]) => [id, actor.model]),
      ),
      thinking: [],
      decisions: 0,
      decisionLimit,
      inputTokens: 0,
      outputTokens: 0,
      lastLatencyMs: null,
      savedAt: null,
    };
  }

  async initialize(): Promise<void> {
    try {
      const checkpoint = await this.store.load();
      if (checkpoint) {
        this.world = structuredClone(checkpoint.world);
        Object.assign(this.runtime, {
          decisions: checkpoint.decisions,
          inputTokens: checkpoint.inputTokens,
          outputTokens: checkpoint.outputTokens,
          savedAt: checkpoint.savedAt,
        });
      }
      for (const bot of this.world.bots)
        bot.model = this.actors[bot.id as keyof ActorControllers].model;
      const missing = Object.entries(this.actors)
        .filter(([, actor]) => !actor.provider)
        .map(([id]) => id);
      this.runtime.status = missing.length ? "unconfigured" : "running";
      this.runtime.message = missing.length
        ? `The island is ready. Configure model credentials for ${missing.join(" and ")} to start.`
        : "Two independent minds. One shared world.";
    } catch {
      this.fail(
        "Could not restore the saved island. Check the backend checkpoint storage; the saved world has not been overwritten.",
      );
    }
  }

  start() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => {
      void this.step();
    }, 250);
    this.timer.unref();
  }

  snapshot(): SurvivalSnapshot {
    const world = structuredClone(this.world);
    return {
      world: {
        ...world,
        bots: world.bots.map(
          ({
            memories: _m,
            knownResources: _k,
            disposition: _d,
            ...publicBot
          }) => publicBot,
        ),
      },
      runtime: { ...this.runtime, thinking: [...this.requests.keys()] },
    };
  }

  checkpoint(): SurvivalCheckpoint {
    return {
      world: structuredClone(this.world),
      decisions: this.runtime.decisions,
      inputTokens: this.runtime.inputTokens,
      outputTokens: this.runtime.outputTokens,
      savedAt: new Date().toISOString(),
    };
  }

  private async save() {
    const checkpoint = this.checkpoint();
    await this.store.save(checkpoint);
    this.runtime.savedAt = checkpoint.savedAt;
  }

  async step(now = Date.now()): Promise<void> {
    if (this.stepping || this.stopped || this.runtime.status !== "running")
      return;
    this.stepping = true;
    try {
      for (const completion of this.completions.splice(0)) {
        if (!this.operations.accept(completion.botId, completion.operationId))
          continue;
        this.requests.delete(completion.botId);
        if (completion.error || !completion.result) {
          this.fail(
            "An actor’s model could not complete a decision. The world is paused. Check model access, API billing and the backend log, then restart the backend.",
          );
          // API error bodies can include request details; log only status and class.
          const e = completion.error as
            | { name?: string; status?: number }
            | undefined;
          console.error("Survival provider failed", {
            name: e?.name ?? "InvalidResponse",
            status: e?.status,
          });
          break;
        }
        this.runtime.inputTokens += completion.result.inputTokens;
        this.runtime.outputTokens += completion.result.outputTokens;
        this.runtime.lastLatencyMs = completion.result.latencyMs;
        const bot = this.world.bots.find((b) => b.id === completion.botId)!;
        const decision = decisionSchema.parse(completion.result.decision);
        acceptDecision(this.world, bot, decision, completion.observation);
        this.nextDecision.set(bot.id, now + 6_000);
      }
      if (this.runtime.status !== "running") {
        await this.save();
        return;
      }
      tickWorld(this.world, 0.25);
      for (const bot of this.world.bots) {
        if (bot.health <= 0 && this.requests.has(bot.id)) {
          this.requests.get(bot.id)?.abort();
          this.requests.delete(bot.id);
          this.operations.cancel(bot.id);
        }
      }
      if (this.world.bots.every((bot) => bot.health <= 0)) {
        this.runtime.status = "ended";
        this.runtime.message =
          "Both survivors have died. Their island and history are saved.";
        await this.save();
        return;
      }
      if (
        this.runtime.decisions >= this.runtime.decisionLimit &&
        !this.requests.size &&
        this.world.bots.every((b) => !b.task)
      ) {
        this.runtime.status = "paused";
        this.runtime.message = `Paused after ${this.runtime.decisions} decisions. Raise SURVIVAL_DECISION_LIMIT and restart to continue this island.`;
        await this.save();
        return;
      }
      const candidates = this.world.bots
        .filter(
          (b) =>
            b.health > 0 &&
            !b.task &&
            !this.requests.has(b.id) &&
            now >= (this.nextDecision.get(b.id) ?? 0),
        )
        .slice(
          0,
          Math.max(0, this.runtime.decisionLimit - this.runtime.decisions),
        );
      if (candidates.length) {
        this.runtime.decisions += candidates.length;
        for (const bot of candidates) bot.decisions++;
        // Reserve the paid calls durably before dispatch, so a restart cannot reset the budget.
        await this.save();
        if (this.stopped) return;
        for (const bot of candidates) {
          const observation = observe(this.world, bot);
          const operation = this.operations.start(
            bot.id,
            `${bot.id}:${bot.decisions}`,
            now,
          )!;
          const controller = new AbortController();
          this.requests.set(bot.id, controller);
          const timeout = setTimeout(() => controller.abort(), 60_000);
          timeout.unref();
          void this.actors[bot.id as keyof ActorControllers]
            .provider!.decide(observation, controller.signal)
            .then((result) => {
              if (!this.stopped)
                this.completions.push({
                  botId: bot.id,
                  operationId: operation.operationId,
                  observation,
                  result,
                });
            })
            .catch((error: unknown) => {
              if (!this.stopped)
                this.completions.push({
                  botId: bot.id,
                  operationId: operation.operationId,
                  observation,
                  error,
                });
            })
            .finally(() => clearTimeout(timeout));
        }
      } else if (
        !this.runtime.savedAt ||
        now - Date.parse(this.runtime.savedAt) > 10_000
      ) {
        await this.save();
      }
    } catch {
      this.fail(
        "The island paused because a decision or checkpoint could not be saved safely. Check the backend connection and restart to resume.",
      );
    } finally {
      this.stepping = false;
      this.stepFinished?.();
      this.stepFinished = null;
    }
  }

  private fail(message: string) {
    this.runtime.status = "error";
    this.runtime.message = message;
    for (const [botId, controller] of this.requests) {
      controller.abort();
      this.operations.cancel(botId);
    }
    this.requests.clear();
    this.completions = [];
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const controller of this.requests.values()) controller.abort();
    this.requests.clear();
    if (this.stepping)
      await new Promise<void>((resolve) => {
        this.stepFinished = resolve;
      });
    if (this.runtime.savedAt) await this.save();
  }
}
