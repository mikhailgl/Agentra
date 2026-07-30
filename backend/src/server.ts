import compression from "compression";
import cors from "cors";
import express from "express";
import { ArenaCheckpointRepository } from "./arenaCheckpointRepository.js";
import { ArenaService, type ArenaCheckpoint } from "./arenaService.js";
import { getConfig } from "./config.js";
import { GameStateRepository } from "./gameStateRepository.js";
import { MatchLogRepository } from "./matchLogRepository.js";
import { PlayerAccountRepository } from "./playerAccountRepository.js";
import { InvalidPlayerSessionError, PlayerActionError, PlayerService } from "./playerService.js";
import { createSupabaseAdmin } from "./supabase.js";
import { BOT_CONTEST_ENTRY_FEE, CUSTOM_BOT_CREATION_COST, getOddsForBetType, getSponsorDropCost } from "../../frontend/src/game/player.js";
import type { SponsorDropKind } from "../../frontend/src/game/simulation.js";
import type { BetType, MatchLog } from "../../frontend/src/game/types.js";

const ARENA_INITIALIZATION_TIMEOUT_MS = 10_000;
const ARENA_LATE_RESTORE_TIMEOUT_MS = 50_000;
const ARENA_CHECKPOINT_INTERVAL_MS = 5 * 60_000;
const ARENA_STREAM_INTERVAL_MS = 500;
const SPONSOR_DROP_KINDS: ReadonlySet<SponsorDropKind> = new Set(["Knife", "Spear", "Bow", "Axe", "Medkit"]);

const config = getConfig();
const app = express();
const supabase = createSupabaseAdmin(config);
const repository = new GameStateRepository(supabase);
const arenaCheckpointRepository = new ArenaCheckpointRepository(supabase);
const matchLogRepository = new MatchLogRepository(supabase);
const playerService = new PlayerService(new PlayerAccountRepository(supabase));
const arena = new ArenaService({
  onCheckpointNeeded: saveArenaCheckpoint,
  onMatchLogReady: saveMatchLog,
  onMatchCompleted: settleCompletedMatch,
});
let arenaReady = false;
let arenaInitializationInFlight = false;
let checkpointPersistenceReady = false;
let arenaRecoveryWarning: string | null = null;

let checkpointSaveInFlight = false;
let pendingCheckpoint: { checkpoint: ArenaCheckpoint; reason: string } | null = null;

function saveArenaCheckpoint(reason: string): void {
  if (!arenaReady || !checkpointPersistenceReady) {
    return;
  }

  // Keep only the newest state while a slow write is in flight. The previous
  // promise chain retained every large checkpoint and could grow without bound.
  pendingCheckpoint = { checkpoint: arena.getCheckpoint(), reason };
  void flushArenaCheckpoint();
}

async function flushArenaCheckpoint(): Promise<void> {
  if (checkpointSaveInFlight) {
    return;
  }

  checkpointSaveInFlight = true;
  try {
    while (pendingCheckpoint) {
      const nextCheckpoint = pendingCheckpoint;
      pendingCheckpoint = null;
      try {
        await arenaCheckpointRepository.save(nextCheckpoint.checkpoint);
        arenaRecoveryWarning = null;
      } catch (error) {
        const message = getErrorMessage(error);
        arenaRecoveryWarning = message;
        console.error(`Failed to save canonical arena checkpoint after ${nextCheckpoint.reason}: ${message}`);
      }
    }
  } finally {
    checkpointSaveInFlight = false;
    if (pendingCheckpoint) {
      void flushArenaCheckpoint();
    }
  }
}

function saveMatchLog(log: MatchLog): void {
  void matchLogRepository.saveCanonical(log).catch((error: unknown) => {
    const message = getErrorMessage(error);
    console.error(`Failed to save match log for match ${log.matchNumber}: ${message}`);
  });
}

function settleCompletedMatch(match: Parameters<PlayerService["resolveMatch"]>[0]): void {
  const settle = () => {
    void playerService.resolveMatch(match).catch((error: unknown) => {
      console.error(`Failed to settle predictions for ${match.id}: ${getErrorMessage(error)}`);
    });
  };
  settle();
  for (const delay of [500, 2_000]) {
    const timer = setTimeout(settle, delay);
    timer.unref();
  }
}

// Match boundaries and player actions already request checkpoints. This slower
// safety checkpoint limits repeated rewrites of the growing in-match JSONB state.
const checkpointTimer = setInterval(() => saveArenaCheckpoint("periodic safety checkpoint"), ARENA_CHECKPOINT_INTERVAL_MS);
checkpointTimer.unref();

// Compress the long-lived SSE response at the origin so repeated arena frames
// do not count at their full JSON size against Render's outbound bandwidth.
app.use(compression());
app.use(express.json({ limit: "2mb" }));
app.use(
  cors({
    origin(origin, callback) {
      const hostname = getHostname(origin);
      const suffixAllowed = config.corsOriginSuffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
      if (!origin || config.corsOrigins.includes(origin) || suffixAllowed) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
  }),
);

function getHostname(origin: string | undefined): string {
  if (!origin) {
    return "";
  }

  try {
    return new URL(origin).hostname;
  } catch {
    return "";
  }
}

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    ready: arenaReady,
    checkpointPersistenceReady,
    ...(arenaRecoveryWarning ? { warning: arenaRecoveryWarning } : {}),
  });
});

app.get("/api/state", async (request, response, next) => {
  try {
    const clientId = String(request.query.clientId ?? "");
    response.json(await repository.load(clientId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/arena", requireArenaReady, (request, response) => {
  response.json(arena.getSnapshot({ includeRoster: request.query.includeRoster === "1" }));
});

app.get("/api/match-logs", requireArenaReady, async (request, response, next) => {
  try {
    const limit = Number(request.query.limit ?? 25);
    response.json({ logs: await matchLogRepository.listCanonical(limit) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/player/session", async (request, response, next) => {
  try {
    const clientId = typeof request.body?.clientId === "string" ? request.body.clientId : "";
    const legacy = clientId ? await repository.load(clientId) : {};
    const ownedBotIds = Array.isArray(legacy.playerState?.ownedBotIds)
      ? legacy.playerState.ownedBotIds.filter((id): id is string => typeof id === "string")
      : [];
    const result = await playerService.openSession(getSessionToken(request), { ownedBotIds });
    response.status(result.sessionToken ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/player", async (request, response, next) => {
  try {
    response.json({ state: await playerService.getState(getSessionToken(request)) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/player/bets", requireArenaReady, async (request, response, next) => {
  try {
    const { matchId, type, botId, amount } = (request.body ?? {}) as Record<string, unknown>;
    const snapshot = arena.getSnapshot();
    if (matchId !== snapshot.match.id || !isBetType(type) || typeof botId !== "string" || typeof amount !== "number") {
      throw new PlayerActionError("A valid prediction for the current match is required");
    }
    const bot = snapshot.match.bots.find((candidate) => candidate.id === botId);
    if (!bot) throw new PlayerActionError("That fighter is not in the current match");
    const odds = getOddsForBetType(bot, snapshot.match.bots, type);
    const state = await playerService.placeBet(getSessionToken(request), snapshot.match, { type, botId, amount, odds });
    response.json({ state });
  } catch (error) {
    next(error);
  }
});

app.post("/api/player/sponsor-drop", requireArenaReady, async (request, response, next) => {
  const token = getSessionToken(request);
  const { botId, kind } = (request.body ?? {}) as { botId?: unknown; kind?: unknown };
  if (typeof botId !== "string" || !isSponsorDropKind(kind)) {
    next(new PlayerActionError("A valid fighter and sponsor drop are required"));
    return;
  }

  const cost = getSponsorDropCost(kind);
  try {
    await playerService.charge(token, cost);
    const snapshot = arena.sponsorDrop(botId, kind);
    if (!snapshot) {
      await playerService.refund(token, cost);
      throw new PlayerActionError("Sponsor drop could not be applied to that fighter");
    }
    const state = await playerService.recordSponsorship(token);
    saveArenaCheckpoint("sponsor drop");
    response.json({ snapshot, state });
  } catch (error) {
    next(error);
  }
});

app.post("/api/player/bots", requireArenaReady, async (request, response, next) => {
  const token = getSessionToken(request);
  const { bot, enqueue } = (request.body ?? {}) as { bot?: unknown; enqueue?: unknown };
  const botId = bot && typeof bot === "object" && typeof (bot as { id?: unknown }).id === "string" ? (bot as { id: string }).id : "";
  try {
    const currentPlayer = await playerService.getState(token);
    const alreadyOwned = currentPlayer.ownedBotIds.includes(botId);
    const currentArena = arena.getSnapshot({ includeRoster: true });
    if (enqueue === true && (currentArena.arenaQueueIds?.includes(botId) || currentArena.match.bots.some((candidate) => candidate.id === botId))) {
      throw new PlayerActionError("That fighter is already active or queued");
    }
    let state = alreadyOwned
      ? currentPlayer
      : await playerService.claimBot(token, botId, CUSTOM_BOT_CREATION_COST);
    if (alreadyOwned && enqueue === true) {
      state = await playerService.charge(token, BOT_CONTEST_ENTRY_FEE);
    }

    const snapshot = arena.registerCustomBot(bot, enqueue === true);
    if (!snapshot) {
      state = alreadyOwned && enqueue === true
        ? await playerService.refund(token, BOT_CONTEST_ENTRY_FEE)
        : !alreadyOwned
          ? await playerService.releaseBotClaim(token, botId, CUSTOM_BOT_CREATION_COST)
          : state;
      throw new PlayerActionError("A valid custom fighter is required");
    }
    response.json({ snapshot, state });
  } catch (error) {
    next(error);
  }
});

app.put("/api/player/bots/:botId/doctrine", requireArenaReady, async (request, response, next) => {
  try {
    await playerService.requireOwnedBot(getSessionToken(request), request.params.botId);
    const instruction = (request.body as { instruction?: unknown } | undefined)?.instruction;
    if (typeof instruction !== "string") throw new PlayerActionError("instruction is required");
    const snapshot = arena.updateBotDoctrine(request.params.botId, instruction);
    if (!snapshot) throw new PlayerActionError("Custom fighter not found");
    response.json({ snapshot });
  } catch (error) {
    next(error);
  }
});

app.get("/api/arena/stream", requireArenaReady, (request, response) => {
  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream",
    "x-accel-buffering": "no",
  });
  response.flushHeaders?.();

  const sendSnapshot = () => {
    response.write(`event: arena\n`);
    response.write(`data: ${JSON.stringify(arena.getStreamFrame())}\n\n`);
    response.flush?.();
  };
  const keepAlive = () => {
    response.write(`: keep-alive\n\n`);
    response.flush?.();
  };

  sendSnapshot();
  const snapshotTimer = setInterval(sendSnapshot, ARENA_STREAM_INTERVAL_MS);
  const keepAliveTimer = setInterval(keepAlive, 15_000);

  request.on("close", () => {
    clearInterval(snapshotTimer);
    clearInterval(keepAliveTimer);
  });
});

app.post("/api/arena/toggle-pause", requireArenaReady, (_request, response) => {
  response.status(403).json({ error: "The canonical arena schedule is server-controlled" });
});

app.post("/api/arena/start-next", requireArenaReady, (_request, response) => {
  response.status(403).json({ error: "The canonical arena schedule is server-controlled" });
});

app.post("/api/arena/sponsor-drop", requireArenaReady, (request, response) => {
  response.status(410).json({ error: "Use the authenticated player sponsor endpoint" });
});

app.post("/api/arena/bots", requireArenaReady, (request, response) => {
  response.status(410).json({ error: "Use the authenticated player fighter endpoint" });
});

app.put("/api/arena/bots/:botId/doctrine", requireArenaReady, (request, response) => {
  response.status(410).json({ error: "Use the authenticated player doctrine endpoint" });
});

app.put("/api/state", async (request, response, next) => {
  try {
    const clientId = String(request.query.clientId ?? "");
    response.json(await repository.save(clientId, request.body));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const status = error instanceof InvalidPlayerSessionError ? 401 : error instanceof PlayerActionError ? 409 : message === "Invalid client id" ? 400 : 500;
  response.status(status).json({ error: message });
});

app.listen(config.port, () => {
  console.log(`BotArena backend listening on ${config.port}`);
  void initializeArena();
});

function requireArenaReady(_request: express.Request, response: express.Response, next: express.NextFunction): void {
  if (!arenaReady) {
    response.status(503).json({ error: "Arena is initializing" });
    return;
  }
  next();
}

function isSponsorDropKind(value: unknown): value is SponsorDropKind {
  return typeof value === "string" && SPONSOR_DROP_KINDS.has(value as SponsorDropKind);
}

function isBetType(value: unknown): value is BetType {
  return typeof value === "string" && ["winner", "top3", "mostKills", "firstEliminated"].includes(value);
}

function getSessionToken(request: express.Request): string | undefined {
  const authorization = request.header("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
}

async function initializeArena(): Promise<void> {
  if (arenaReady || arenaInitializationInFlight) {
    return;
  }

  arenaInitializationInFlight = true;
  const checkpointLoad = arenaCheckpointRepository.load();
  try {
    const restoredArena = await withTimeout(
      checkpointLoad,
      ARENA_INITIALIZATION_TIMEOUT_MS,
      "Timed out while loading the canonical arena checkpoint",
    );
    finishArenaInitialization(restoredArena);
  } catch (error) {
    const message = getErrorMessage(error);
    arenaRecoveryWarning = message;
    arena.start();
    arenaReady = true;

    if (error instanceof TimeoutError) {
      console.error(`Arena checkpoint restore is slow; serving a temporary arena while recovery continues: ${message}`);
    } else {
      console.error(`Arena checkpoint restore failed; serving a temporary arena while recovery retries: ${message}`);
    }
    void finishLateArenaRestore(checkpointLoad);
  } finally {
    arenaInitializationInFlight = false;
  }
}

function finishArenaInitialization(restoredArena: ArenaCheckpoint | null): void {
  if (restoredArena) {
    arena.restore(restoredArena);
    console.log(`Restored canonical arena checkpoint at match ${restoredArena.matchNumber}`);
  }
  arena.start();
  arenaReady = true;
  checkpointPersistenceReady = true;
  arenaRecoveryWarning = null;
  saveArenaCheckpoint(restoredArena ? "restore" : "startup");
}

async function finishLateArenaRestore(checkpointLoad: Promise<ArenaCheckpoint | null>): Promise<void> {
  const recoveryDeadline = Date.now() + ARENA_LATE_RESTORE_TIMEOUT_MS;
  let nextLoad = checkpointLoad;
  try {
    while (Date.now() < recoveryDeadline) {
      try {
        const restoredArena = await withTimeout(
          nextLoad,
          recoveryDeadline - Date.now(),
          "Timed out waiting for the late canonical arena checkpoint restore",
        );
        if (restoredArena) {
          arena.restore(restoredArena);
          console.log(`Late-restored canonical arena checkpoint at match ${restoredArena.matchNumber}`);
        }
        arenaRecoveryWarning = null;
        return;
      } catch (error) {
        const message = getErrorMessage(error);
        arenaRecoveryWarning = message;
        if (Date.now() >= recoveryDeadline) {
          throw error;
        }
        await delay(Math.min(5_000, recoveryDeadline - Date.now()));
        nextLoad = arenaCheckpointRepository.load();
      }
    }
    throw new TimeoutError("Timed out waiting for the canonical arena checkpoint recovery");
  } catch (error) {
    const message = getErrorMessage(error);
    arenaRecoveryWarning = message;
    console.error(`Arena checkpoint recovery was abandoned; continuing with the fresh arena: ${message}`);
  } finally {
    checkpointPersistenceReady = true;
    saveArenaCheckpoint("checkpoint recovery completed");
  }
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, durationMs);
    timer.unref();
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

class TimeoutError extends Error {}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
