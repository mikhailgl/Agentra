import { useEffect, useState } from "react";
import { formatTime } from "../../format";
import type { Bot, GameEvent, MatchEvent } from "../../game/types";

type LogTab = "feed" | "highlights" | "thoughts";

export function MatchLogOverlay({ events, matchEvents, selectedBot }: { events: GameEvent[]; matchEvents: MatchEvent[]; selectedBot: Bot | null }) {
  const [activeTab, setActiveTab] = useState<LogTab>("feed");
  const thoughts = selectedBot?.thoughts ?? [];

  useEffect(() => {
    if (!selectedBot && activeTab === "thoughts") {
      setActiveTab("feed");
    }
  }, [activeTab, selectedBot]);

  return (
    <section className="match-log-overlay">
      <div className="overlay-tabs" role="tablist" aria-label="Match information">
        <button type="button" className={activeTab === "feed" ? "active" : ""} onClick={() => setActiveTab("feed")}>
          Event Feed
        </button>
        <button type="button" className={activeTab === "highlights" ? "active" : ""} onClick={() => setActiveTab("highlights")}>
          Highlights
        </button>
        <button type="button" className={activeTab === "thoughts" ? "active" : ""} disabled={!selectedBot} onClick={() => setActiveTab("thoughts")}>
          Thoughts
        </button>
      </div>
      {activeTab === "highlights" ? (
        <div className="match-log-list">
          {matchEvents.length > 0 ? (
            matchEvents.slice(0, 10).map((event) => (
              <article key={event.id} className={`live-event-row ${event.type} ${event.importance >= 8 ? "important" : ""}`}>
                <div>
                  <strong>{getEventLabel(event)}</strong>
                  <time>{formatTime(event.timestamp)}</time>
                </div>
                <span>{event.message}</span>
              </article>
            ))
          ) : (
            <p className="empty-panel-note">Waiting for the first major moment.</p>
          )}
        </div>
      ) : activeTab === "feed" ? (
        <div className="match-log-list">
          {events.slice(0, 8).map((event) => (
            <article key={event.id} className={`log-line ${event.kind ?? "system"}`}>
              <time>{formatTime(event.timeMs)}</time>
              <span>{event.message}</span>
            </article>
          ))}
        </div>
      ) : (
        <div className="match-log-list">
          {thoughts.length > 0 ? (
            thoughts.slice(0, 8).map((thought) => (
              <article key={thought.id} className={`log-line thought ${thought.kind}`}>
                <time>{formatTime(thought.timeMs)}</time>
                <span>{thought.message}</span>
              </article>
            ))
          ) : (
            <p className="empty-panel-note">{selectedBot?.name ?? "This bot"} has not revealed a thought yet.</p>
          )}
        </div>
      )}
    </section>
  );
}

function getEventLabel(event: MatchEvent): string {
  if (event.type === "first_blood") return "First Blood";
  if (event.type === "kill_streak") return "Streak";
  if (event.type === "low_hp") return "Low HP";
  if (event.type === "near_death_escape") return "Escape";
  if (event.type === "weapon_pickup") return "Pickup";
  if (event.type === "sponsor_drop") return "Sponsor";
  if (event.type === "arena_event") return "Arena Event";
  if (event.type === "narrative") return "Moment";
  if (event.type === "match_winner") return "Champion";
  return "Elimination";
}
