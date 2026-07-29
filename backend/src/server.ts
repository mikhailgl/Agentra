import cors from "cors";
import express from "express";
import { ArenaCheckpointRepository } from "./arenaCheckpointRepository.js";
import { ArenaService } from "./arenaService.js";
import { getConfig } from "./config.js";
import { GameStateRepository } from "./gameStateRepository.js";
import { MatchLogRepository } from "./matchLogRepository.js";
import { createSupabaseAdmin } from "./supabase.js";
import type { SponsorDropKind } from "../../frontend/src/game/simulation.js";
import type { MatchLog } from "../../frontend/src/game/types.js";

const ARENA_INITIALIZATION_TIMEOUT_MS = 10_000;
const ARENA_INITIALIZATION_RETRY_MS = 30_000;
const SPONSOR_DROP_KINDS: ReadonlySet<SponsorDropKind> = new Set(["Knife", "Spear", "Bow", "Axe", "Medkit"]);

const config = getConfig();
const app = express();
const supabase = createSupabaseAdmin(config);
const repository = new GameStateRepository(supabase);
const arenaCheckpointRepository = new ArenaCheckpointRepository(supabase);
const matchLogRepository = new MatchLogRepository(supabase);
const arena = new ArenaService({ onCheckpointNeeded: saveArenaCheckpoint, onMatchLogReady: saveMatchLog });
let arenaReady = false;
let arenaInitializationInFlight = false;

let checkpointSave = Promise.resolve();
function saveArenaCheckpoint(reason: string): void {
  if (!arenaReady) {
    return;
  }
  const checkpoint = arena.getCheckpoint();
  checkpointSave = checkpointSave
    .catch(() => undefined)
    .then(() => arenaCheckpointRepository.save(checkpoint))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to save canonical arena checkpoint after ${reason}: ${message}`);
    });
}

function saveMatchLog(log: MatchLog): void {
  void matchLogRepository.saveCanonical(log).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to save match log for match ${log.matchNumber}: ${message}`);
  });
}

const checkpointTimer = setInterval(() => saveArenaCheckpoint("periodic checkpoint"), 15_000);
checkpointTimer.unref();

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
  response.json({ ok: true, ready: arenaReady });
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

app.get("/api/arena/stream", requireArenaReady, (request, response) => {
  response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream",
    "x-accel-buffering": "no",
  });
  response.flushHeaders?.();

  const sendSnapshot = () => {
    response.write(`event: arena\n`);
    response.write(`data: ${JSON.stringify(arena.getStreamFrame())}\n\n`);
  };
  const keepAlive = () => {
    response.write(`: keep-alive\n\n`);
  };

  sendSnapshot();
  const snapshotTimer = setInterval(sendSnapshot, 120);
  const keepAliveTimer = setInterval(keepAlive, 15_000);

  request.on("close", () => {
    clearInterval(snapshotTimer);
    clearInterval(keepAliveTimer);
  });
});

app.post("/api/arena/toggle-pause", requireArenaReady, (_request, response) => {
  const snapshot = arena.togglePause();
  saveArenaCheckpoint("pause toggle");
  response.json(snapshot);
});

app.post("/api/arena/start-next", requireArenaReady, (_request, response) => {
  const snapshot = arena.startNextMatch();
  saveArenaCheckpoint("manual next match");
  response.json(snapshot);
});

app.post("/api/arena/sponsor-drop", requireArenaReady, (request, response) => {
  const { botId, kind } = (request.body ?? {}) as { botId?: unknown; kind?: unknown };
  if (typeof botId !== "string" || !isSponsorDropKind(kind)) {
    response.status(400).json({ error: "A valid botId and sponsor-drop kind are required" });
    return;
  }

  const snapshot = arena.sponsorDrop(botId, kind);
  if (!snapshot) {
    response.status(409).json({ error: "Sponsor drop could not be applied to that bot" });
    return;
  }
  saveArenaCheckpoint("sponsor drop");
  response.json(snapshot);
});

app.post("/api/arena/bots", requireArenaReady, (request, response) => {
  const { bot, enqueue } = (request.body ?? {}) as { bot?: unknown; enqueue?: unknown };
  const snapshot = arena.registerCustomBot(bot, enqueue === true);
  if (!snapshot) {
    response.status(400).json({ error: "A valid custom bot is required" });
    return;
  }
  response.json(snapshot);
});

app.put("/api/arena/bots/:botId/doctrine", requireArenaReady, (request, response) => {
  const instruction = (request.body as { instruction?: unknown } | undefined)?.instruction;
  if (typeof instruction !== "string") {
    response.status(400).json({ error: "instruction is required" });
    return;
  }

  const snapshot = arena.updateBotDoctrine(request.params.botId, instruction);
  if (!snapshot) {
    response.status(404).json({ error: "Custom bot not found" });
    return;
  }
  response.json(snapshot);
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
  const status = message === "Invalid client id" ? 400 : 500;
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

async function initializeArena(): Promise<void> {
  if (arenaReady || arenaInitializationInFlight) {
    return;
  }

  arenaInitializationInFlight = true;
  try {
    const restoredArena = await withTimeout(
      arenaCheckpointRepository.load(),
      ARENA_INITIALIZATION_TIMEOUT_MS,
      "Timed out while loading the canonical arena checkpoint",
    );
    if (restoredArena) {
      arena.restore(restoredArena);
      console.log(`Restored canonical arena checkpoint at match ${restoredArena.matchNumber}`);
    }
    arena.start();
    arenaReady = true;
    saveArenaCheckpoint(restoredArena ? "restore" : "startup");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Arena initialization failed; retrying in ${ARENA_INITIALIZATION_RETRY_MS / 1000}s: ${message}`);
    const retryTimer = setTimeout(() => void initializeArena(), ARENA_INITIALIZATION_RETRY_MS);
    retryTimer.unref();
  } finally {
    arenaInitializationInFlight = false;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
