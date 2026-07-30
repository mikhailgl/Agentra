import type { ArenaState, BasicMatchResult, BetType, FantasyLeaderboardEntry, FighterPublicProfile, GeneratedMedia, LeagueState, MatchLog, MatchState, PersistentBot, PlayerState } from "./types";
import type { SponsorDropKind } from "./simulation";
import type { ArenaViewModel } from "../lib/simulation/types";

const CLIENT_ID_KEY = "ai-battle:client-id:v1";
const PLAYER_SESSION_TOKEN_KEY = "botarena:player-session:v1";
let remoteSyncEnabled = false;
let playerSessionPromise: Promise<RemotePlayerSession | null> | null = null;

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
  leagueState: LeagueState;
  persistentBots?: PersistentBot[];
  arenaQueueIds?: string[];
  basicResults?: BasicMatchResult[];
  serverTime: number;
};

export type ArenaStreamFrame = {
  matchId: string;
  arena: ArenaViewModel;
  arenaState: ArenaState;
  serverTime: number;
};

export type AuthenticatedArenaAction = {
  snapshot: ArenaSnapshot;
  state: PlayerState;
};

export type RemotePlayerSession = {
  state: PlayerState;
  recoveryCode?: string;
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

export function openRemotePlayerSession(): Promise<RemotePlayerSession | null> {
  if (!playerSessionPromise) {
    playerSessionPromise = requestRemotePlayerSession().catch((error) => {
      playerSessionPromise = null;
      throw error;
    });
  }
  return playerSessionPromise;
}

async function requestRemotePlayerSession(): Promise<RemotePlayerSession | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl || typeof window === "undefined") return null;
  const response = await fetch(`${apiBaseUrl}/api/player/session`, {
    method: "POST",
    headers: getPlayerHeaders(true),
    body: JSON.stringify({ clientId: getGameClientId() }),
  });
  if (!response.ok) throw new Error(await getArenaActionError(response));
  const body = (await response.json()) as { state: PlayerState; sessionToken?: string; recoveryCode?: string };
  if (body.sessionToken) window.localStorage.setItem(PLAYER_SESSION_TOKEN_KEY, body.sessionToken);
  return { state: body.state, recoveryCode: body.recoveryCode };
}

export async function recoverRemotePlayer(recoveryCode: string): Promise<PlayerState | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl || typeof window === "undefined") return null;
  const response = await fetch(`${apiBaseUrl}/api/player/recover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recoveryCode }),
  });
  if (!response.ok) throw new Error(await getArenaActionError(response));
  const body = (await response.json()) as { state: PlayerState; sessionToken: string };
  window.localStorage.setItem(PLAYER_SESSION_TOKEN_KEY, body.sessionToken);
  playerSessionPromise = Promise.resolve({ state: body.state });
  return body.state;
}

export async function rotateRemoteRecoveryCode(): Promise<{ state: PlayerState; recoveryCode: string } | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return null;
  const response = await fetch(`${apiBaseUrl}/api/player/recovery-code`, { method: "POST", headers: getPlayerHeaders() });
  if (!response.ok) throw new Error(await getArenaActionError(response));
  return (await response.json()) as { state: PlayerState; recoveryCode: string };
}

export async function issueRemoteCreatorApiKey(): Promise<string | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return null;
  const response = await fetch(`${apiBaseUrl}/api/player/creator-api-key`, { method: "POST", headers: getPlayerHeaders() });
  if (!response.ok) throw new Error(await getArenaActionError(response));
  return ((await response.json()) as { apiKey: string }).apiKey;
}

export async function updateRemotePlayerName(name: string): Promise<AuthenticatedArenaAction | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return null;
  const response = await fetch(`${apiBaseUrl}/api/player`, {
    method: "PATCH",
    headers: getPlayerHeaders(true),
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(await getArenaActionError(response));
  return (await response.json()) as AuthenticatedArenaAction;
}

export async function loadRemotePlayer(): Promise<PlayerState | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return null;
  const response = await fetch(`${apiBaseUrl}/api/player`, { headers: getPlayerHeaders() });
  if (!response.ok) throw new Error(await getArenaActionError(response));
  return ((await response.json()) as { state: PlayerState }).state;
}

export async function loadRemoteOwnedBots(): Promise<PersistentBot[]> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return [];
  const response = await fetch(`${apiBaseUrl}/api/player/bots`, { headers: getPlayerHeaders() });
  if (!response.ok) throw new Error(await getArenaActionError(response));
  const body = (await response.json()) as { bots?: PersistentBot[] };
  return Array.isArray(body.bots) ? body.bots : [];
}

export async function placeRemoteBet(matchId: string, type: BetType, botId: string, amount: number): Promise<PlayerState | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return null;
  const response = await fetch(`${apiBaseUrl}/api/player/bets`, {
    method: "POST",
    headers: getPlayerHeaders(true),
    body: JSON.stringify({ matchId, type, botId, amount }),
  });
  if (!response.ok) throw new Error(await getArenaActionError(response));
  return ((await response.json()) as { state: PlayerState }).state;
}

export async function saveRemoteFantasyRoster(botIds: string[]): Promise<PlayerState | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return null;
  const response = await fetch(`${apiBaseUrl}/api/player/fantasy-roster`, {
    method: "PUT",
    headers: getPlayerHeaders(true),
    body: JSON.stringify({ botIds }),
  });
  if (!response.ok) throw new Error(await getArenaActionError(response));
  return ((await response.json()) as { state: PlayerState }).state;
}

export async function loadFantasyLeaderboard(limit = 50): Promise<FantasyLeaderboardEntry[]> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return [];
  const response = await fetch(`${apiBaseUrl}/api/fantasy/leaderboard?limit=${encodeURIComponent(String(limit))}`);
  if (!response.ok) throw new Error(await getArenaActionError(response));
  const body = (await response.json()) as { entries?: FantasyLeaderboardEntry[] };
  return Array.isArray(body.entries) ? body.entries : [];
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

export async function loadArenaSnapshot(options: { includeRoster?: boolean } = {}): Promise<ArenaSnapshot | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    return null;
  }

  const query = options.includeRoster ? "?includeRoster=1" : "";
  const response = await fetch(`${apiBaseUrl}/api/arena${query}`);
  if (!response.ok) {
    throw new Error(`Failed to load arena snapshot: ${response.status}`);
  }

  return (await response.json()) as ArenaSnapshot;
}

export async function loadMatchLogs(limit = 25): Promise<MatchLog[]> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    return [];
  }

  const response = await fetch(`${apiBaseUrl}/api/match-logs?limit=${encodeURIComponent(String(limit))}`);
  if (!response.ok) {
    throw new Error(`Failed to load match logs: ${response.status}`);
  }

  const data = (await response.json()) as { logs?: MatchLog[] };
  return Array.isArray(data.logs) ? data.logs : [];
}

export async function loadMatchLog(matchNumber: number): Promise<MatchLog | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return null;
  const response = await fetch(`${apiBaseUrl}/api/match-logs/${encodeURIComponent(String(matchNumber))}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await getArenaActionError(response));
  return ((await response.json()) as { log: MatchLog }).log;
}

export async function loadGeneratedMedia(limit = 24): Promise<GeneratedMedia[]> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return [];
  const response = await fetch(`${apiBaseUrl}/api/media?limit=${encodeURIComponent(String(limit))}`);
  if (!response.ok) throw new Error(await getArenaActionError(response));
  const body = (await response.json()) as { media?: GeneratedMedia[] };
  return Array.isArray(body.media) ? body.media : [];
}

export async function loadFighterProfile(botId: string): Promise<FighterPublicProfile | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return null;
  const response = await fetch(`${apiBaseUrl}/api/fighters/${encodeURIComponent(botId)}/profile`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await getArenaActionError(response));
  return ((await response.json()) as { profile: FighterPublicProfile }).profile;
}

export async function setRemoteFavoriteBot(botId: string, favorite: boolean): Promise<{ state: PlayerState; fanCount: number } | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return null;
  const response = await fetch(`${apiBaseUrl}/api/player/favorites/${encodeURIComponent(botId)}`, {
    method: "PUT",
    headers: getPlayerHeaders(true),
    body: JSON.stringify({ favorite }),
  });
  if (!response.ok) throw new Error(await getArenaActionError(response));
  return (await response.json()) as { state: PlayerState; fanCount: number };
}

export async function uploadGeneratedMedia(input: {
  blob: Blob;
  matchNumber: number;
  title: string;
  sourceVideoId: string;
}): Promise<GeneratedMedia | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return null;
  const response = await fetch(`${apiBaseUrl}/api/player/media`, {
    method: "PUT",
    headers: {
      ...getPlayerHeaders(),
      "content-type": input.blob.type || "video/webm",
      "x-match-number": String(input.matchNumber),
      "x-media-title": encodeURIComponent(input.title),
      "x-source-video-id": encodeURIComponent(input.sourceVideoId),
    },
    body: input.blob,
  });
  if (!response.ok) throw new Error(await getArenaActionError(response));
  return ((await response.json()) as { media: GeneratedMedia }).media;
}

export function subscribeToArenaStream({
  onFrame,
  onError,
}: {
  onFrame: (frame: ArenaStreamFrame) => void;
  onError?: (error: Event) => void;
}): (() => void) | null {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl || typeof window === "undefined" || typeof window.EventSource === "undefined") {
    return null;
  }

  const source = new EventSource(`${apiBaseUrl}/api/arena/stream`);
  const handleSnapshot = (event: MessageEvent<string>) => {
    onFrame(JSON.parse(event.data) as ArenaStreamFrame);
  };
  source.addEventListener("arena", handleSnapshot);
  source.onerror = (event) => {
    onError?.(event);
  };

  return () => {
    source.removeEventListener("arena", handleSnapshot);
    source.close();
  };
}

export async function sendRemoteSponsorDrop(botId: string, kind: SponsorDropKind): Promise<AuthenticatedArenaAction | null> {
  return postPlayerArenaAction("/api/player/sponsor-drop", { botId, kind });
}

export async function registerRemoteBot(bot: PersistentBot, enqueue: boolean): Promise<AuthenticatedArenaAction | null> {
  return postPlayerArenaAction("/api/player/bots", { bot, enqueue });
}

export async function updateRemoteBotDoctrine(botId: string, instruction: string): Promise<ArenaSnapshot | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    return null;
  }

  const response = await fetch(`${apiBaseUrl}/api/player/bots/${encodeURIComponent(botId)}/doctrine`, {
    method: "PUT",
    headers: getPlayerHeaders(true),
    body: JSON.stringify({ instruction }),
  });
  if (!response.ok) {
    throw new Error(await getArenaActionError(response));
  }

  return ((await response.json()) as { snapshot: ArenaSnapshot }).snapshot;
}

async function postPlayerArenaAction(path: string, body: unknown): Promise<AuthenticatedArenaAction | null> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return null;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: getPlayerHeaders(true),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await getArenaActionError(response));
  return (await response.json()) as AuthenticatedArenaAction;
}

async function getArenaActionError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    // Fall back to a status-based message when the server did not return JSON.
  }
  return `Arena action failed: ${response.status}`;
}

function getPlayerHeaders(includeJson = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeJson) headers["content-type"] = "application/json";
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem(PLAYER_SESSION_TOKEN_KEY);
    if (token) headers.authorization = `Bearer ${token}`;
  }
  return headers;
}
