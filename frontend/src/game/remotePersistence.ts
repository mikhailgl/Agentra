import type { ArenaState, BasicMatchResult, MatchState, PersistentBot, PlayerState } from "./types";
import type { SponsorDropKind } from "./simulation";

const CLIENT_ID_KEY = "ai-battle:client-id:v1";
let remoteSyncEnabled = false;

export type RemoteGameState = {
  persistentBots?: PersistentBot[];
  playerState?: PlayerState;
  arenaState?: ArenaState | null;
  arenaQueueIds?: string[];
  basicResults?: BasicMatchResult[];
};

export type ArenaSnapshot = {
  match: MatchState;
  arenaState: ArenaState;
  persistentBots: PersistentBot[];
  arenaQueueIds: string[];
  basicResults: BasicMatchResult[];
  serverTime: number;
};

function getApiBaseUrl(): string | null {
  const env = (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env;
  const url = env?.VITE_API_BASE_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

export function hasArenaBackend(): boolean {
  return Boolean(getApiBaseUrl());
}

export function getGameClientId(): string {
  if (typeof window === "undefined") {
    return "server";
  }

  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }

  const id = `guest:${crypto.randomUUID()}`;
  window.localStorage.setItem(CLIENT_ID_KEY, id);
  return id;
}

export async function loadRemoteGameState(): Promise<RemoteGameState | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    return null;
  }

  const response = await fetch(`${apiBaseUrl}/api/state?clientId=${encodeURIComponent(getGameClientId())}`);
  if (!response.ok) {
    throw new Error(`Failed to load remote game state: ${response.status}`);
  }

  return (await response.json()) as RemoteGameState;
}

export function enableRemoteGameStateSync(): void {
  remoteSyncEnabled = true;
}

export function saveRemoteGameState(state: RemoteGameState): void {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl || !remoteSyncEnabled || typeof window === "undefined") {
    return;
  }

  void fetch(`${apiBaseUrl}/api/state?clientId=${encodeURIComponent(getGameClientId())}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(state),
  }).catch((error) => {
    console.warn("Remote game state sync failed", error);
  });
}

export async function loadArenaSnapshot(): Promise<ArenaSnapshot | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    return null;
  }

  const response = await fetch(`${apiBaseUrl}/api/arena`);
  if (!response.ok) {
    throw new Error(`Failed to load arena snapshot: ${response.status}`);
  }

  return (await response.json()) as ArenaSnapshot;
}

export async function toggleRemoteArenaPause(): Promise<ArenaSnapshot | null> {
  return postArenaAction("/api/arena/toggle-pause");
}

export async function startRemoteNextMatch(): Promise<ArenaSnapshot | null> {
  return postArenaAction("/api/arena/start-next");
}

export async function sendRemoteSponsorDrop(botId: string, kind: SponsorDropKind): Promise<ArenaSnapshot | null> {
  return postArenaAction("/api/arena/sponsor-drop", { botId, kind });
}

async function postArenaAction(path: string, body?: unknown): Promise<ArenaSnapshot | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    return null;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Arena action failed: ${response.status}`);
  }

  return (await response.json()) as ArenaSnapshot;
}
