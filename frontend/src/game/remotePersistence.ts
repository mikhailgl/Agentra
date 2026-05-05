import type { ArenaState, BasicMatchResult, PersistentBot, PlayerState } from "./types";

const CLIENT_ID_KEY = "ai-battle:client-id:v1";
let remoteSyncEnabled = false;

export type RemoteGameState = {
  persistentBots?: PersistentBot[];
  playerState?: PlayerState;
  arenaState?: ArenaState | null;
  arenaQueueIds?: string[];
  basicResults?: BasicMatchResult[];
};

function getApiBaseUrl(): string | null {
  const url = import.meta.env.VITE_API_BASE_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
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
