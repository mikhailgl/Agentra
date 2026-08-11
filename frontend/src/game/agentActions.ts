import { getMatchConfig } from "./matchConfig";
import { distance, moveToward } from "./math";
import { applyBotAttack, applyLootInteraction } from "./simulation";
import type { AgentAction, AgentActionResult, AgentObservation, AgentSpeech, MatchState } from "./types";

export type AgentActionProgress = {
  result: AgentActionResult;
  speech?: Omit<AgentSpeech, "id">;
};

// Typed proposal/validation boundary adapted from Concordia's ActionSpec and
// SOTOPIA's recipient validation. See THIRD_PARTY_NOTICES.md.
export function validateAgentAction(match: MatchState, observation: AgentObservation, action: AgentAction): string | null {
  const actor = match.bots.find((bot) => bot.id === observation.self.id && bot.alive);
  if (!actor) return "The acting participant is no longer alive.";
  if (!action || typeof action !== "object" || typeof action.type !== "string") return "The proposed action is malformed.";

  if (action.type === "move") {
    if (!Number.isFinite(action.destination?.x) || !Number.isFinite(action.destination?.y)) return "The destination is invalid.";
    const config = getMatchConfig(match);
    if (
      action.destination.x < config.arena.edgePadding ||
      action.destination.y < config.arena.edgePadding ||
      action.destination.x > config.arena.size - config.arena.edgePadding ||
      action.destination.y > config.arena.size - config.arena.edgePadding
    ) {
      return "The destination is outside the arena.";
    }
    return null;
  }

  if (action.type === "speak") {
    const message = action.message?.trim();
    if (!message || message.length > 280) return "Speech must contain between 1 and 280 characters.";
    const visibleIds = new Set(observation.visiblePeople.map((person) => person.id));
    const targetIds = action.targetIds ?? [];
    if (new Set(targetIds).size !== targetIds.length || targetIds.some((targetId) => !visibleIds.has(targetId))) {
      return "Speech targets must be distinct visible participants.";
    }
    return null;
  }

  if (action.type === "inspect" || action.type === "take" || action.type === "use") {
    const availability = observation.availableActions.find((available) => available.type === action.type);
    return availability?.objectIds?.includes(action.objectId) ? null : `Object ${action.objectId} is not available for ${action.type}.`;
  }

  if (action.type === "attack") {
    const availability = observation.availableActions.find((available) => available.type === "attack");
    if (!availability?.targetIds?.includes(action.targetId)) return `Participant ${action.targetId} is not an available attack target.`;
    if (action.weaponId && action.weaponId !== actor.inventory.weapon?.name) return "The requested weapon is not equipped.";
    return null;
  }

  return action.type === "wait" ? null : "The proposed action type is unsupported.";
}

export function progressAgentAction(
  match: MatchState,
  observation: AgentObservation,
  action: AgentAction,
  deltaMs: number,
): AgentActionProgress {
  const validationError = validateAgentAction(match, observation, action);
  if (validationError) return { result: result("rejected", action.type, validationError, match.elapsedMs) };

  const actor = match.bots.find((bot) => bot.id === observation.self.id && bot.alive)!;
  const firstEventId = match.nextEventId;

  if (action.type === "move") {
    const maxDistance = actor.speed * Math.max(0, deltaMs) / 1000;
    const next = moveToward(actor, action.destination, maxDistance, getMatchConfig(match));
    actor.x = next.x;
    actor.y = next.y;
    const completed = distance(actor, action.destination) < 0.5;
    return {
      result: result(
        completed ? "completed" : "in_progress",
        action.type,
        completed ? "Reached the destination." : "Moving toward the destination.",
        match.elapsedMs,
        eventIdsSince(match, firstEventId),
      ),
    };
  }

  if (action.type === "speak") {
    return {
      result: result("completed", action.type, "Spoke aloud.", match.elapsedMs),
      speech: {
        speakerId: actor.id,
        message: action.message.trim(),
        targetIds: action.targetIds?.length ? [...action.targetIds] : undefined,
        position: { x: actor.x, y: actor.y },
        createdAtMs: match.elapsedMs,
        hearingRange: getMatchConfig(match).ai.socialScanRange,
      },
    };
  }

  if (action.type === "inspect") {
    const object = observation.visibleObjects.find((candidate) => candidate.id === action.objectId)!;
    return { result: result("completed", action.type, `Inspected ${object.name}.`, match.elapsedMs) };
  }

  if (action.type === "take" || action.type === "use") {
    const applied = applyLootInteraction(match, actor, action.objectId, action.type);
    return {
      result: result(
        applied ? "completed" : "rejected",
        action.type,
        applied ? `${action.type === "take" ? "Took" : "Used"} the object.` : "The object was no longer available.",
        match.elapsedMs,
        eventIdsSince(match, firstEventId),
      ),
    };
  }

  if (action.type === "attack") {
    const target = match.bots.find((bot) => bot.id === action.targetId && bot.alive);
    const weapon = actor.inventory.weapon;
    if (!target || !weapon || distance(actor, target) > weapon.range) {
      return { result: result("rejected", action.type, "The target is no longer in attack range.", match.elapsedMs) };
    }
    if (match.elapsedMs - actor.lastAttackAt < weapon.cooldownMs) {
      return { result: result("in_progress", action.type, "Waiting for the equipped weapon to be ready.", match.elapsedMs) };
    }
    const applied = applyBotAttack(match, actor, target);
    return {
      result: result(
        applied ? "completed" : "rejected",
        action.type,
        applied ? `Attacked ${target.name}.` : "The attack could not be applied.",
        match.elapsedMs,
        eventIdsSince(match, firstEventId),
      ),
    };
  }

  return { result: result("completed", "wait", "Waited and observed.", match.elapsedMs) };
}

function result(
  status: AgentActionResult["status"],
  actionType: AgentAction["type"],
  message: string,
  elapsedMs: number,
  eventIds: number[] = [],
): AgentActionResult {
  return {
    status,
    actionType,
    message,
    completedAtMs: status === "in_progress" ? undefined : elapsedMs,
    eventIds,
  };
}

function eventIdsSince(match: MatchState, firstEventId: number): number[] {
  return match.logEvents.filter((event) => event.id >= firstEventId).map((event) => event.id);
}
