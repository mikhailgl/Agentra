import cors from "cors";
import express from "express";
import { ArenaCheckpointRepository } from "./arenaCheckpointRepository.js";
import { ArenaService } from "./arenaService.js";
import { getConfig } from "./config.js";
import { GameStateRepository } from "./gameStateRepository.js";
import { createSupabaseAdmin } from "./supabase.js";

const config = getConfig();
const app = express();
const supabase = createSupabaseAdmin(config);
const repository = new GameStateRepository(supabase);
const arenaCheckpointRepository = new ArenaCheckpointRepository(supabase);
const arena = new ArenaService({ onCheckpointNeeded: saveArenaCheckpoint });
const restoredArena = await arenaCheckpointRepository.load();
if (restoredArena) {
  arena.restore(restoredArena);
  console.log(`Restored canonical arena checkpoint at match ${restoredArena.matchNumber}`);
}
arena.start();

let checkpointSave = Promise.resolve();
function saveArenaCheckpoint(reason: string): void {
  const checkpoint = arena.getCheckpoint();
  checkpointSave = checkpointSave
    .catch(() => undefined)
    .then(() => arenaCheckpointRepository.save(checkpoint))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to save canonical arena checkpoint after ${reason}: ${message}`);
    });
}

saveArenaCheckpoint(restoredArena ? "restore" : "startup");
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
  response.json({ ok: true });
});

app.get("/api/state", async (request, response, next) => {
  try {
    const clientId = String(request.query.clientId ?? "");
    response.json(await repository.load(clientId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/arena", (request, response) => {
  response.json(arena.getSnapshot({ includeRoster: request.query.includeRoster === "1" }));
});

app.get("/api/arena/stream", (request, response) => {
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

app.post("/api/arena/toggle-pause", (_request, response) => {
  const snapshot = arena.togglePause();
  saveArenaCheckpoint("pause toggle");
  response.json(snapshot);
});

app.post("/api/arena/start-next", (_request, response) => {
  const snapshot = arena.startNextMatch();
  saveArenaCheckpoint("manual next match");
  response.json(snapshot);
});

app.post("/api/arena/sponsor-drop", (request, response) => {
  const { botId, kind } = request.body as { botId?: unknown; kind?: unknown };
  if (typeof botId !== "string" || typeof kind !== "string") {
    response.status(400).json({ error: "botId and kind are required" });
    return;
  }

  const snapshot = arena.sponsorDrop(botId, kind);
  saveArenaCheckpoint("sponsor drop");
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
});
