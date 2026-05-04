import { useEffect, useState } from "react";
import { formatTime } from "../../format";
import type { Bot, GameEvent } from "../../game/types";

type LogTab = "match" | "thoughts";

export function MatchLogOverlay({ events, selectedBot }: { events: GameEvent[]; selectedBot: Bot | null }) {
  const [activeTab, setActiveTab] = useState<LogTab>("match");
  const thoughts = selectedBot?.thoughts ?? [];

  useEffect(() => {
    if (!selectedBot && activeTab === "thoughts") {
      setActiveTab("match");
    }
  }, [activeTab, selectedBot]);

  return (
    <section className="match-log-overlay">
      <div className="overlay-tabs" role="tablist" aria-label="Match information">
        <button type="button" className={activeTab === "match" ? "active" : ""} onClick={() => setActiveTab("match")}>
          Match Log
        </button>
        <button type="button" className={activeTab === "thoughts" ? "active" : ""} disabled={!selectedBot} onClick={() => setActiveTab("thoughts")}>
          Thoughts
        </button>
      </div>
      {activeTab === "match" ? (
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
