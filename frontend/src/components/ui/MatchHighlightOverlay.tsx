import { useEffect, useState } from "react";
import type { MatchEvent } from "../../game/types";

const HIGHLIGHT_MS = 2600;

export function MatchHighlightOverlay({ events }: { events: MatchEvent[] }) {
  const latestImportantEvent = events.find((event) => event.importance >= 8) ?? null;
  const [visibleEvent, setVisibleEvent] = useState<MatchEvent | null>(latestImportantEvent);

  useEffect(() => {
    if (!latestImportantEvent) {
      setVisibleEvent(null);
      return;
    }

    setVisibleEvent(latestImportantEvent);
    const timeout = window.setTimeout(() => setVisibleEvent(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timeout);
  }, [latestImportantEvent?.id]);

  if (!visibleEvent) {
    return null;
  }

  return (
    <section key={visibleEvent.id} className={`match-highlight ${visibleEvent.type}`} aria-live="polite">
      <span>{getHighlightTitle(visibleEvent)}</span>
      <strong>{getHighlightSubject(visibleEvent)}</strong>
      <small>{visibleEvent.message}</small>
    </section>
  );
}

function getHighlightTitle(event: MatchEvent): string {
  if (event.type === "first_blood") return "First Blood";
  if (event.type === "kill_streak") return `${Number(event.metadata?.streak ?? 2)} Kill Streak`;
  if (event.type === "match_winner") return "New Champion";
  if (event.type === "near_death_escape") return "Near-Death Escape";
  if (event.type === "arena_event") return String(event.metadata?.title ?? "Arena Event");
  if (event.type === "narrative") return String(event.metadata?.title ?? "Narrative Moment");
  return "Highlight";
}

function getHighlightSubject(event: MatchEvent): string {
  const botName = typeof event.metadata?.botName === "string" ? event.metadata.botName : undefined;
  const killerName = typeof event.metadata?.killerName === "string" ? event.metadata.killerName : undefined;
  return botName ?? killerName ?? event.message;
}
