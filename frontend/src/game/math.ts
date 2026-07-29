import { DEFAULT_MATCH_CONFIG } from "./matchConfig";
import { createRng, type Rng } from "./random";
import type { MatchConfig, Point } from "./types";

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampToMap(point: Point, config: MatchConfig = DEFAULT_MATCH_CONFIG): Point {
  return {
    x: clamp(point.x, 0, config.arena.size),
    y: clamp(point.y, 0, config.arena.size),
  };
}

export function moveToward(from: Point, to: Point, maxDistance: number, config: MatchConfig = DEFAULT_MATCH_CONFIG): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (length === 0 || length <= maxDistance) {
    return clampToMap(to, config);
  }

  return clampToMap({
    x: from.x + (dx / length) * maxDistance,
    y: from.y + (dy / length) * maxDistance,
  }, config);
}

export function moveAway(from: Point, threat: Point, maxDistance: number, config: MatchConfig = DEFAULT_MATCH_CONFIG): Point {
  const dx = from.x - threat.x;
  const dy = from.y - threat.y;
  const length = Math.hypot(dx, dy) || 1;

  return clampToMap({
    x: from.x + (dx / length) * maxDistance,
    y: from.y + (dy / length) * maxDistance,
  }, config);
}

export function randomPointInCircle(center: Point, radius: number, rng: Rng = createRng(1), config: MatchConfig = DEFAULT_MATCH_CONFIG): Point {
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * radius;

  return clampToMap({
    x: center.x + Math.cos(angle) * r,
    y: center.y + Math.sin(angle) * r,
  }, config);
}
