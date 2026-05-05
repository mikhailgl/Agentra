import type { ArenaState, BasicMatchResult } from "./types";
import { saveRemoteGameState } from "./remotePersistence";

const ARENA_STATE_KEY = "ai-battle:arena-state:v1";
const BASIC_RESULTS_KEY = "ai-battle:basic-results:v1";
const MAX_BASIC_RESULTS = 10;

export function loadArenaState(): ArenaState | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(ARENA_STATE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ArenaState;
    if (
      typeof parsed.matchNumber === "number" &&
      ["running", "intermission", "paused"].includes(parsed.phase) &&
      Array.isArray(parsed.activeBotIds)
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

export function saveArenaState(state: ArenaState): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ARENA_STATE_KEY, JSON.stringify(state));
  saveRemoteGameState({ arenaState: state });
}

export function loadBasicMatchResults(): BasicMatchResult[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(BASIC_RESULTS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as BasicMatchResult[];
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (result) =>
              typeof result.matchNumber === "number" &&
              typeof result.winnerBotId === "string" &&
              typeof result.winnerName === "string" &&
              typeof result.endedAt === "number",
          )
          .slice(0, MAX_BASIC_RESULTS)
      : [];
  } catch {
    return [];
  }
}

export function saveBasicMatchResult(result: BasicMatchResult): BasicMatchResult[] {
  const results = [result, ...loadBasicMatchResults().filter((candidate) => candidate.matchNumber !== result.matchNumber)].slice(
    0,
    MAX_BASIC_RESULTS,
  );

  if (typeof window !== "undefined") {
    window.localStorage.setItem(BASIC_RESULTS_KEY, JSON.stringify(results));
    saveRemoteGameState({ basicResults: results });
  }

  return results;
}

export function replaceBasicMatchResults(results: BasicMatchResult[]): BasicMatchResult[] {
  const nextResults = results.slice(0, MAX_BASIC_RESULTS);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(BASIC_RESULTS_KEY, JSON.stringify(nextResults));
    saveRemoteGameState({ basicResults: nextResults });
  }
  return nextResults;
}

export function getNextMatchNumber(): number {
  const arenaState = loadArenaState();
  const latestResult = loadBasicMatchResults()[0];
  return Math.max((arenaState?.matchNumber ?? 0) + 1, (latestResult?.matchNumber ?? 0) + 1, 1);
}
