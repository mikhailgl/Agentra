import { Router, json } from "express";
import { z } from "zod";
import type { SurvivalService } from "./service.js";

const controls = z
  .object({ paused: z.boolean(), speed: z.number().min(0.25).max(8) })
  .strict();
export function survivalRouter(service: SurvivalService) {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/", (_request, response) => response.json(service.snapshot()));
  router.post("/control", json({ limit: "1kb" }), async (request, response) => {
    const parsed = controls.safeParse(request.body);
    if (!parsed.success) {
      response
        .status(400)
        .json({ error: "Provide paused and a speed between 0.25 and 8." });
      return;
    }
    try {
      await service.control(parsed.data.paused, parsed.data.speed);
      response.json(service.snapshot());
    } catch {
      response
        .status(409)
        .json({ error: "Time controls could not be saved. Try again." });
    }
  });
  return router;
}
