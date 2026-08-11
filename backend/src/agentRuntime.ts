import { progressAgentAction } from "../../frontend/src/game/agentActions.js";
import { buildAgentObservation, getSpeechListenerIds } from "../../frontend/src/game/perception.js";
import type {
  AgentAction,
  AgentDecisionTrace,
  AgentMemory,
  AgentObservation,
  AgentSpeech,
  MatchState,
  ObservedObject,
  ObservedPerson,
  Point,
} from "../../frontend/src/game/types.js";
import { AgentOperationRegistry, type OperationRegistryCheckpoint } from "./agents/operationRegistry.js";

const OPERATION_TIMEOUT_MS = 15_000;
const MAX_MEMORIES_PER_AGENT = 64;
const MAX_SPEECH = 256;
const MAX_DECISION_TRACE = 5_000;

export type AgentRuntimeMode = "legacy" | "autonomous-fake";

export type AgentProviderInput = {
  observation: AgentObservation;
  operationId: string;
};

export interface AgentModelProvider {
  decide(input: AgentProviderInput): AgentAction | Promise<AgentAction>;
}

type ActiveAgentAction = {
  agentId: string;
  operationId: string;
  observation: AgentObservation;
  action: AgentAction;
};

type CompletedProviderOperation = {
  agentId: string;
  operationId: string;
  observation: AgentObservation;
  action: AgentAction;
};

export type AgentRuntimeCheckpoint = {
  version: 1;
  mode: AgentRuntimeMode;
  operations: OperationRegistryCheckpoint;
  activeActions: ActiveAgentAction[];
  memories: Record<string, AgentMemory[]>;
  speech: AgentSpeech[];
  decisionTrace: AgentDecisionTrace[];
  nextSpeechNumber: number;
  nextMemoryNumber: number;
  nextTraceNumber: number;
};

export class AgentRuntime {
  private readonly operations = new AgentOperationRegistry();
  private readonly activeActions = new Map<string, ActiveAgentAction>();
  private readonly memories = new Map<string, AgentMemory[]>();
  private speech: AgentSpeech[] = [];
  private decisionTrace: AgentDecisionTrace[] = [];
  private completedOperations: CompletedProviderOperation[] = [];
  private nextSpeechNumber = 1;
  private nextMemoryNumber = 1;
  private nextTraceNumber = 1;

  constructor(
    readonly mode: AgentRuntimeMode,
    private readonly provider: AgentModelProvider = new FakeAgentProvider(),
  ) {}

  tick(match: MatchState, deltaMs: number, nowMs = Date.now()): void {
    if (this.mode === "legacy") return;

    for (const expired of this.operations.expireOlderThan(nowMs, OPERATION_TIMEOUT_MS)) {
      this.addMemory(expired.agentId, match.elapsedMs, "action_result", "A decision attempt timed out; no action occurred.");
    }

    this.acceptCompletedOperations(match);
    this.progressActiveActions(match, deltaMs);
    this.removeDeadAgentWork(match);
    this.speech = this.speech.filter((utterance) => match.elapsedMs - utterance.createdAtMs <= 30_000).slice(-MAX_SPEECH);

    if (match.ended) return;
    for (const agent of match.bots) {
      if (!agent.alive || this.operations.has(agent.id) || this.activeActions.has(agent.id)) continue;
      this.requestDecision(match, agent.id, nowMs);
    }
  }

  checkpoint(): AgentRuntimeCheckpoint {
    return {
      version: 1,
      mode: this.mode,
      operations: this.operations.checkpoint(),
      activeActions: cloneJson([...this.activeActions.values()]),
      memories: Object.fromEntries([...this.memories.entries()].map(([agentId, memories]) => [agentId, cloneJson(memories)])),
      speech: cloneJson(this.speech),
      decisionTrace: cloneJson(this.decisionTrace),
      nextSpeechNumber: this.nextSpeechNumber,
      nextMemoryNumber: this.nextMemoryNumber,
      nextTraceNumber: this.nextTraceNumber,
    };
  }

  restore(checkpoint?: AgentRuntimeCheckpoint): void {
    this.activeActions.clear();
    this.memories.clear();
    this.completedOperations = [];
    this.operations.restore(checkpoint?.operations);
    // Provider promises cannot survive a process restart. Cancelling their
    // restored tokens lets the next tick safely re-request; any late in-process
    // completion is rejected because its operation ID no longer matches.
    this.operations.expireOlderThan(Number.POSITIVE_INFINITY, 0);

    for (const active of checkpoint?.activeActions ?? []) this.activeActions.set(active.agentId, cloneJson(active));
    for (const [agentId, memories] of Object.entries(checkpoint?.memories ?? {})) this.memories.set(agentId, cloneJson(memories));
    this.speech = cloneJson(checkpoint?.speech ?? []);
    this.decisionTrace = cloneJson(checkpoint?.decisionTrace ?? []);
    this.nextSpeechNumber = checkpoint?.nextSpeechNumber ?? 1;
    this.nextMemoryNumber = checkpoint?.nextMemoryNumber ?? 1;
    this.nextTraceNumber = checkpoint?.nextTraceNumber ?? 1;
  }

  reset(): void {
    this.restore();
  }

  private requestDecision(match: MatchState, agentId: string, nowMs: number): void {
    const observation = buildAgentObservation(match, agentId, {
      speech: this.speech,
      memories: this.memories.get(agentId) ?? [],
    });
    const operation = this.operations.start(agentId, observation.id, nowMs);
    if (!operation) return;

    try {
      const proposed = this.provider.decide({ observation: cloneJson(observation), operationId: operation.operationId });
      if (isPromise(proposed)) {
        void proposed
          .then((action) => this.queueCompletion(agentId, operation.operationId, observation, action))
          .catch(() => this.queueCompletion(agentId, operation.operationId, observation, { type: "wait" }));
      } else {
        this.queueCompletion(agentId, operation.operationId, observation, proposed);
      }
    } catch {
      this.queueCompletion(agentId, operation.operationId, observation, { type: "wait" });
    }
  }

  private queueCompletion(agentId: string, operationId: string, observation: AgentObservation, action: AgentAction): void {
    this.completedOperations.push({ agentId, operationId, observation: cloneJson(observation), action: cloneJson(action) });
  }

  private acceptCompletedOperations(match: MatchState): void {
    const completed = this.completedOperations;
    this.completedOperations = [];
    for (const completion of completed) {
      const operation = this.operations.accept(completion.agentId, completion.operationId);
      if (!operation || !match.bots.some((bot) => bot.id === completion.agentId && bot.alive)) continue;
      this.activeActions.set(completion.agentId, {
        agentId: completion.agentId,
        operationId: completion.operationId,
        observation: completion.observation,
        action: completion.action,
      });
    }
  }

  private progressActiveActions(match: MatchState, deltaMs: number): void {
    for (const active of [...this.activeActions.values()]) {
      const progress = progressAgentAction(match, active.observation, active.action, deltaMs);
      if (progress.result.status === "in_progress") continue;

      this.activeActions.delete(active.agentId);
      this.addMemory(active.agentId, match.elapsedMs, "action_result", progress.result.message, progress.result.eventIds);
      if (progress.speech) this.recordSpeech(match, progress.speech);
      this.decisionTrace.push({
        id: `agent-trace-${this.nextTraceNumber++}`,
        matchId: match.id,
        agentId: active.agentId,
        observationId: active.observation.id,
        operationId: active.operationId,
        proposedAction: cloneJson(active.action),
        result: cloneJson(progress.result),
        recordedAtMs: match.elapsedMs,
      });
      if (this.decisionTrace.length > MAX_DECISION_TRACE) {
        this.decisionTrace.splice(0, this.decisionTrace.length - MAX_DECISION_TRACE);
      }
    }
  }

  private recordSpeech(match: MatchState, speechInput: Omit<AgentSpeech, "id">): void {
    const speech: AgentSpeech = { id: `speech-${this.nextSpeechNumber++}`, ...cloneJson(speechInput) };
    this.speech.push(speech);
    this.addMemory(speech.speakerId, match.elapsedMs, "action_result", `I said: “${speech.message}”`);
    for (const listenerId of getSpeechListenerIds(match, speech)) {
      const speakerName = match.bots.find((bot) => bot.id === speech.speakerId)?.name ?? "Someone";
      this.addMemory(listenerId, match.elapsedMs, "heard", `${speakerName} said: “${speech.message}”`, [], speech.speakerId);
    }
  }

  private addMemory(
    agentId: string,
    createdAtMs: number,
    source: AgentMemory["source"],
    summary: string,
    eventIds: number[] = [],
    speakerId?: string,
  ): void {
    const memories = this.memories.get(agentId) ?? [];
    memories.push({
      id: `agent-memory-${this.nextMemoryNumber++}`,
      createdAtMs,
      source,
      summary,
      eventIds: [...eventIds],
      speakerId,
    });
    this.memories.set(agentId, memories.slice(-MAX_MEMORIES_PER_AGENT));
  }

  private removeDeadAgentWork(match: MatchState): void {
    const livingIds = new Set(match.bots.filter((bot) => bot.alive).map((bot) => bot.id));
    for (const agentId of this.activeActions.keys()) {
      if (!livingIds.has(agentId)) this.activeActions.delete(agentId);
    }
    for (const bot of match.bots) {
      if (!livingIds.has(bot.id)) this.operations.cancel(bot.id);
    }
  }
}

export class FakeAgentProvider implements AgentModelProvider {
  decide({ observation, operationId }: AgentProviderInput): AgentAction {
    const usable = getAvailableObjectIds(observation, "use");
    if (observation.self.health < 82 && usable.length) return { type: "use", objectId: usable[0] };

    const attackable = new Set(getAvailableTargetIds(observation, "attack"));
    const attackTarget = [...observation.visiblePeople]
      .filter((person) => attackable.has(person.id))
      .sort(comparePeople)[0];
    if (attackTarget) return { type: "attack", targetId: attackTarget.id, weaponId: observation.self.inventory.weapon?.name };

    const takeable = new Set(getAvailableObjectIds(observation, "take"));
    const takeTarget = [...observation.visibleObjects]
      .filter((object) => takeable.has(object.id))
      .sort(compareObjects)[0];
    if (takeTarget) return { type: "take", objectId: takeTarget.id };

    const operationNumber = Number(operationId.split("-").at(-1) ?? 0);
    if (observation.visiblePeople.length && operationNumber % 17 === 0) {
      const target = [...observation.visiblePeople].sort(comparePeople)[0];
      return { type: "speak", message: "I see you. What are you planning?", targetIds: [target.id] };
    }

    const desiredObject = chooseDesiredObject(observation);
    if (desiredObject) return { type: "move", destination: desiredObject.position };
    if (observation.self.inventory.weapon && observation.visiblePeople.length) {
      return { type: "move", destination: [...observation.visiblePeople].sort(comparePeople)[0].position };
    }
    return { type: "move", destination: explorationPoint(observation.self.position, `${observation.self.id}:${operationId}`) };
  }
}

function chooseDesiredObject(observation: AgentObservation): ObservedObject | null {
  const candidates = observation.visibleObjects.filter((object) => object.kind === "loot");
  if (!candidates.length) return null;
  if (!observation.self.inventory.weapon) {
    const weapon = candidates.filter((object) => object.details.category === "weapon").sort(compareObjects)[0];
    if (weapon) return weapon;
  }
  return [...candidates].sort(compareObjects)[0];
}

function explorationPoint(origin: Point, seed: string): Point {
  const first = hashSeed(seed);
  const second = hashSeed(`${seed}:radius`);
  const angle = (first / 0xffffffff) * Math.PI * 2;
  const radius = 70 + (second % 100);
  return {
    x: Math.max(18, Math.min(982, origin.x + Math.cos(angle) * radius)),
    y: Math.max(18, Math.min(982, origin.y + Math.sin(angle) * radius)),
  };
}

function getAvailableObjectIds(observation: AgentObservation, type: AgentAction["type"]): string[] {
  return observation.availableActions.find((action) => action.type === type)?.objectIds ?? [];
}

function getAvailableTargetIds(observation: AgentObservation, type: AgentAction["type"]): string[] {
  return observation.availableActions.find((action) => action.type === type)?.targetIds ?? [];
}

function comparePeople(a: ObservedPerson, b: ObservedPerson): number {
  const conditionScore = { critical: 0, hurt: 1, healthy: 2 } as const;
  return conditionScore[a.condition] - conditionScore[b.condition] || a.distance - b.distance || a.id.localeCompare(b.id);
}

function compareObjects(a: ObservedObject, b: ObservedObject): number {
  return a.distance - b.distance || a.id.localeCompare(b.id);
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return Boolean(value && typeof (value as Promise<T>).then === "function");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
