import cors from "cors";
import express from "express";
import { ArenaService } from "./arenaService.js";
import { getConfig } from "./config.js";
import { GameStateRepository } from "./gameStateRepository.js";
import { createSupabaseAdmin } from "./supabase.js";

const config = getConfig();
const app = express();
const repository = new GameStateRepository(createSupabaseAdmin(config));
const arena = new ArenaService();
arena.start();

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

app.post("/api/arena/toggle-pause", (_request, response) => {
  response.json(arena.togglePause());
});

app.post("/api/arena/start-next", (_request, response) => {
  response.json(arena.startNextMatch());
});

app.post("/api/arena/sponsor-drop", (request, response) => {
  const { botId, kind } = request.body as { botId?: unknown; kind?: unknown };
  if (typeof botId !== "string" || typeof kind !== "string") {
    response.status(400).json({ error: "botId and kind are required" });
    return;
  }

  response.json(arena.sponsorDrop(botId, kind));
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
