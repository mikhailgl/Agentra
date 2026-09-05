import cors from "cors";
import express from "express";
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { loadActorControllers } from "./modelConfig.js";
import { LocalSurvivalRepository } from "./localRepository.js";
import { SurvivalService } from "./service.js";

// A local survival-only entry point avoids running the competitive league while
// developing the island. Production serves the same service from server.ts.
const port = Number(process.env.PORT ?? 4000);
const service = new SurvivalService(
  new LocalSurvivalRepository(
    fileURLToPath(new URL("../../.local/survival-world.json", import.meta.url)),
  ),
  loadActorControllers(),
  Number(process.env.SURVIVAL_DECISION_LIMIT ?? 120),
);
const app = express();
app.use(
  cors({
    origin: (
      process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:5174"
    ).split(","),
  }),
);
app.get("/api/survival", (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json(service.snapshot());
});
app.get("/health", (_request, response) => {
  const runtime = service.snapshot().runtime;
  response.json({ ok: runtime.status !== "error", status: runtime.status });
});
await service.initialize();
service.start();
const server = app.listen(port, () =>
  console.log(`Survival backend listening on ${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void service.stop().finally(() => {
      server.close(() => process.exit(0));
      server.closeAllConnections();
    });
  });
