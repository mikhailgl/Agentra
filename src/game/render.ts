import {
  BOT_RADIUS,
  MAP_SIZE,
} from "./constants";
import { areAllied } from "./relationships";
import type { Bot, GameEvent, MatchState } from "./types";

type ViewTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export function renderMatch(
  context: CanvasRenderingContext2D,
  match: MatchState,
  selectedBotId: string | null,
  draftedBotIds: string[] = [],
): void {
  const transform = getViewTransform(context.canvas, match);

  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.save();
  context.translate(transform.offsetX, transform.offsetY);
  context.scale(transform.scale, transform.scale);

  drawMap(context);
  drawBiomes(context, match);
  drawAllianceLinks(context, match);
  drawEventHighlights(context, match);
  drawLoot(context, match);
  drawBots(context, match, selectedBotId, draftedBotIds);
  drawFloatingEvents(context, match);

  context.restore();
}

export function screenToWorld(
  canvas: HTMLCanvasElement,
  match: MatchState,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const transform = getViewTransform(canvas, match);
  const canvasX = (clientX - rect.left) * (canvas.width / rect.width);
  const canvasY = (clientY - rect.top) * (canvas.height / rect.height);

  return {
    x: (canvasX - transform.offsetX) / transform.scale,
    y: (canvasY - transform.offsetY) / transform.scale,
  };
}

export function worldToScreen(
  canvas: HTMLCanvasElement,
  match: MatchState,
  x: number,
  y: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const transform = getViewTransform(canvas, match);
  return {
    x: (transform.offsetX + x * transform.scale) / (canvas.width / rect.width),
    y: (transform.offsetY + y * transform.scale) / (canvas.height / rect.height),
  };
}

function getViewTransform(canvas: HTMLCanvasElement, match: MatchState): ViewTransform {
  const baseScale = Math.min(canvas.width / MAP_SIZE, canvas.height / MAP_SIZE);
  return {
    scale: baseScale,
    offsetX: (canvas.width - MAP_SIZE * baseScale) / 2,
    offsetY: (canvas.height - MAP_SIZE * baseScale) / 2,
  };
}

function drawMap(context: CanvasRenderingContext2D): void {
  context.fillStyle = "#122017";
  context.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

  context.strokeStyle = "rgba(255, 255, 255, 0.07)";
  context.lineWidth = 1;
  for (let line = 0; line <= MAP_SIZE; line += 100) {
    context.beginPath();
    context.moveTo(line, 0);
    context.lineTo(line, MAP_SIZE);
    context.moveTo(0, line);
    context.lineTo(MAP_SIZE, line);
    context.stroke();
  }

}

function drawBiomes(context: CanvasRenderingContext2D, match: MatchState): void {
  for (const zone of match.zones ?? []) {
    context.save();
    context.fillStyle = getBiomeColor(zone.id);
    context.strokeStyle = "rgba(255, 255, 255, 0.12)";
    context.lineWidth = 2;
    if (zone.radius) {
      context.beginPath();
      context.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = "rgba(255,255,255,0.55)";
      context.font = "bold 13px system-ui";
      context.textAlign = "center";
      context.fillText(zone.name, zone.x, zone.y);
    } else {
      context.fillRect(zone.x, zone.y, zone.width ?? 0, zone.height ?? 0);
      context.strokeRect(zone.x, zone.y, zone.width ?? 0, zone.height ?? 0);
      context.fillStyle = "rgba(255,255,255,0.55)";
      context.font = "bold 13px system-ui";
      context.textAlign = "center";
      context.fillText(zone.name, zone.x + (zone.width ?? 0) / 2, zone.y + 22);
    }
    context.restore();
  }
}

function drawAllianceLinks(context: CanvasRenderingContext2D, match: MatchState): void {
  const seen = new Set<string>();
  for (const bot of match.bots) {
    if (!bot.alive) continue;
    for (const other of match.bots) {
      if (!other.alive || other.id === bot.id || !areAllied(bot, other, match.elapsedMs)) continue;
      const key = [bot.id, other.id].sort().join(":");
      if (seen.has(key)) continue;
      seen.add(key);

      context.strokeStyle = "rgba(96, 165, 250, 0.66)";
      context.lineWidth = 4;
      context.setLineDash([10, 9]);
      context.beginPath();
      context.moveTo(bot.x, bot.y);
      context.lineTo(other.x, other.y);
      context.stroke();
      context.setLineDash([]);
    }
  }
}

function drawLoot(context: CanvasRenderingContext2D, match: MatchState): void {
  for (const item of match.loot) {
    if (item.type === "medkit") {
      context.fillStyle = "#f7f4ee";
      context.fillRect(item.x - 9, item.y - 9, 18, 18);
      context.fillStyle = "#ef4444";
      context.fillRect(item.x - 2, item.y - 7, 4, 14);
      context.fillRect(item.x - 7, item.y - 2, 14, 4);
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.strokeRect(item.x - 9, item.y - 9, 18, 18);
    } else if (item.type === "weapon") {
      context.save();
      context.translate(item.x, item.y);
      context.rotate(Math.PI / 4);
      context.fillStyle = "#f2c453";
      context.fillRect(-7, -7, 14, 14);
      context.strokeStyle = "#fff1b8";
      context.lineWidth = 2;
      context.strokeRect(-7, -7, 14, 14);
      context.restore();
    } else {
      context.beginPath();
      context.arc(item.x, item.y, 10, 0, Math.PI * 2);
      context.fillStyle = item.type === "armor" ? "#93c5fd" : "#c4b5fd";
      context.fill();
      context.strokeStyle = "#f8fafc";
      context.lineWidth = 2;
      context.stroke();
    }
  }

  for (const creature of match.creatures ?? []) {
    context.beginPath();
    context.arc(creature.x, creature.y, 18, 0, Math.PI * 2);
    context.fillStyle = "#a855f7";
    context.fill();
    context.strokeStyle = "#f5d0fe";
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = "#fff";
    context.font = "bold 11px system-ui";
    context.textAlign = "center";
    context.fillText("NPC", creature.x, creature.y + 4);
  }
}

function drawEventHighlights(context: CanvasRenderingContext2D, match: MatchState): void {
  for (const event of match.events) {
    if (!event.x || !event.y || !isHighlightEvent(event)) continue;
    const age = match.elapsedMs - event.timeMs;
    if (age < 0 || age > 1700) continue;

    const progress = age / 1700;
    const alpha = 1 - progress;
    const color = getEventColor(event.kind);
    const radius = getHighlightRadius(event.kind) * (0.65 + progress * 0.85);

    context.save();
    context.globalAlpha = alpha * 0.58;
    context.strokeStyle = color;
    context.lineWidth = event.kind === "damage" ? 3 : 5;
    context.beginPath();
    context.arc(event.x, event.y, radius, 0, Math.PI * 2);
    context.stroke();

    context.globalAlpha = alpha * 0.1;
    context.fillStyle = color;
    context.beginPath();
    context.arc(event.x, event.y, radius * 0.72, 0, Math.PI * 2);
    context.fill();

    if (event.kind === "kill" || event.kind === "betrayal" || event.kind === "alliance") {
      drawAttentionBeam(context, event, color, alpha);
    }
    context.restore();
  }
}

function drawBots(context: CanvasRenderingContext2D, match: MatchState, selectedBotId: string | null, draftedBotIds: string[]): void {
  for (const bot of match.bots) {
    const visual = getVisualPosition(bot, match);
    const isDrafted = draftedBotIds.includes(bot.id);
    const isRevealed = hasActiveInfluence(bot, match, "reveal");

    if (!bot.alive) {
      context.globalAlpha = 0.32;
      context.beginPath();
      context.arc(bot.x, bot.y, BOT_RADIUS, 0, Math.PI * 2);
      context.fillStyle = "#86928b";
      context.fill();
      context.globalAlpha = 1;
      drawCross(context, bot.x, bot.y);
      continue;
    }

    drawStateMotion(context, bot, visual);
    const isSelected = bot.id === selectedBotId;
    if (isDrafted || isRevealed) {
      context.beginPath();
      context.arc(visual.x, visual.y, BOT_RADIUS + (isRevealed ? 12 : 9), 0, Math.PI * 2);
      context.strokeStyle = isRevealed ? "rgba(248, 231, 168, 0.9)" : "rgba(125, 211, 252, 0.85)";
      context.lineWidth = isRevealed ? 4 : 3;
      context.setLineDash(isRevealed ? [5, 5] : []);
      context.stroke();
      context.setLineDash([]);
    }
    context.beginPath();
    context.arc(visual.x, visual.y, BOT_RADIUS + (isSelected ? 4 : 0), 0, Math.PI * 2);
    context.fillStyle = getBotColor(bot);
    context.fill();
    context.strokeStyle = isSelected ? "#ffffff" : "rgba(255,255,255,0.45)";
    context.lineWidth = isSelected ? 4 : 2;
    context.stroke();

    drawIdentityBubble(context, bot, visual, hasActiveAlliance(bot, match), isDrafted, isRevealed);
  }
}

function drawIdentityBubble(
  context: CanvasRenderingContext2D,
  bot: Bot,
  visual: { x: number; y: number },
  allied: boolean,
  drafted: boolean,
  revealed: boolean,
): void {
  const width = Math.max(62, Math.min(96, bot.name.length * 8 + 24));
  const x = visual.x - width / 2;
  const y = visual.y - 54;

  context.fillStyle = drafted ? "rgba(17, 45, 53, 0.9)" : "rgba(8, 13, 10, 0.82)";
  roundedRect(context, x, y, width, 31, 7);
  context.fill();
  if (drafted || revealed) {
    context.strokeStyle = revealed ? "#f8e7a8" : "#7dd3fc";
    context.lineWidth = 1.5;
    context.stroke();
  }

  context.fillStyle = "#f6f9f5";
  context.font = "bold 12px system-ui";
  context.textAlign = "center";
  context.fillText(bot.name, visual.x, y + 13);

  context.fillStyle = "rgba(255,255,255,0.18)";
  context.fillRect(x + 9, y + 21, width - 18, 4);
  context.fillStyle = bot.health < 30 ? "#fb7185" : "#7ddf86";
  context.fillRect(x + 9, y + 21, (width - 18) * (bot.health / 100), 4);

  context.beginPath();
  context.arc(x + width - 9, y + 9, 4, 0, Math.PI * 2);
  context.fillStyle = allied ? "#60a5fa" : getStatusColor(bot);
  context.fill();
}

function hasActiveInfluence(bot: Bot, match: MatchState, type: string): boolean {
  return (bot.activeInfluences ?? []).some((influence) => influence.type === type && influence.expiresAtMs > match.elapsedMs);
}

function drawFloatingEvents(context: CanvasRenderingContext2D, match: MatchState): void {
  for (const event of match.events) {
    if (!event.x || !event.y || !event.label) continue;
    const age = match.elapsedMs - event.timeMs;
    if (age < 0 || age > 2200) continue;

    const progress = age / 2200;
    const alpha = progress < 0.15 ? progress / 0.15 : 1 - progress;
    context.globalAlpha = Math.max(0, Math.min(1, alpha));
    context.fillStyle = getEventColor(event.kind);
    context.font = `bold ${event.kind === "damage" ? 18 : 15}px system-ui`;
    context.textAlign = "center";
    context.fillText(event.label, event.x, event.y - 36 - progress * 30);
    context.globalAlpha = 1;
  }
}

function drawStateMotion(context: CanvasRenderingContext2D, bot: Bot, visual: { x: number; y: number }): void {
  if (bot.behavior === "attacking") {
    context.strokeStyle = "rgba(239, 68, 68, 0.32)";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(visual.x, visual.y, BOT_RADIUS + 7, 0, Math.PI * 2);
    context.stroke();
  }

  if (bot.behavior === "fleeing") {
    context.strokeStyle = "rgba(251, 146, 60, 0.42)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(bot.x - 11, bot.y + 10);
    context.lineTo(bot.x - 26, bot.y + 18);
    context.stroke();
  }
}

function drawCross(context: CanvasRenderingContext2D, x: number, y: number): void {
  context.strokeStyle = "#c6ccc8";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(x - 8, y - 8);
  context.lineTo(x + 8, y + 8);
  context.moveTo(x + 8, y - 8);
  context.lineTo(x - 8, y + 8);
  context.stroke();
}

function getVisualPosition(bot: Bot, match: MatchState): { x: number; y: number } {
  if (bot.behavior !== "fleeing") return { x: bot.x, y: bot.y };
  const jitter = Math.sin(match.elapsedMs / 120 + bot.id.length * 2) * 1.2;
  return { x: bot.x + jitter, y: bot.y - jitter * 0.55 };
}

function hasActiveAlliance(bot: Bot, match: MatchState): boolean {
  return match.bots.some((other) => other.id !== bot.id && other.alive && areAllied(bot, other, match.elapsedMs));
}

function getBotColor(bot: Bot): string {
  if (bot.behavior === "fleeing") return "#f97361";
  if (bot.behavior === "attacking") return "#ef4444";
  if (bot.behavior === "seeking_loot") return "#38bdf8";
  return "#9ae66e";
}

function getStatusColor(bot: Bot): string {
  if (bot.behavior === "attacking") return "#ef4444";
  if (bot.behavior === "fleeing") return "#fb923c";
  if (bot.behavior === "seeking_loot") return "#38bdf8";
  return "#a3e635";
}

function getBiomeColor(id: string): string {
  if (id === "forest") return "rgba(34, 111, 65, 0.35)";
  if (id === "open_field") return "rgba(132, 145, 71, 0.24)";
  if (id === "ruins") return "rgba(148, 123, 91, 0.32)";
  if (id === "swamp") return "rgba(47, 83, 68, 0.42)";
  if (id === "high_ground") return "rgba(111, 129, 153, 0.32)";
  if (id === "industrial_yard") return "rgba(111, 118, 129, 0.33)";
  if (id === "cave") return "rgba(86, 71, 106, 0.36)";
  return "rgba(255,255,255,0.08)";
}

function getEventColor(kind: GameEvent["kind"]): string {
  if (kind === "damage") return "#fb7185";
  if (kind === "kill" || kind === "betrayal") return "#f97316";
  if (kind === "alliance") return "#60a5fa";
  if (kind === "trust" || kind === "follow") return "#a3e635";
  return "#f8e7a8";
}

function isHighlightEvent(event: GameEvent): boolean {
  return event.kind === "damage" || event.kind === "kill" || event.kind === "alliance" || event.kind === "betrayal" || event.kind === "winner";
}

function getHighlightRadius(kind: GameEvent["kind"]): number {
  if (kind === "kill" || kind === "betrayal" || kind === "winner") return 58;
  if (kind === "alliance") return 46;
  return 31;
}

function drawAttentionBeam(context: CanvasRenderingContext2D, event: GameEvent, color: string, alpha: number): void {
  if (!event.x || !event.y) return;
  context.globalAlpha = alpha * 0.18;
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.setLineDash([5, 8]);
  context.beginPath();
  context.moveTo(event.x, 0);
  context.lineTo(event.x, MAP_SIZE);
  context.moveTo(0, event.y);
  context.lineTo(MAP_SIZE, event.y);
  context.stroke();
  context.setLineDash([]);
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
}
