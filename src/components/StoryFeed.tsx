import { formatTime } from "../format";
import type { GameEvent } from "../game/types";

const MAJOR_EVENTS = new Set(["kill", "alliance", "betrayal", "winner", "system", "player"]);

export function StoryFeed({ events }: { events: GameEvent[] }) {
  const storyEvents = events.filter((event) => event.kind && MAJOR_EVENTS.has(event.kind)).slice(0, 5);

  return (
    <section className="story-feed">
      <h2>Story</h2>
      {storyEvents.length === 0 ? (
        <p>Watching for major turns.</p>
      ) : (
        storyEvents.map((event) => (
          <div key={event.id} className={`story-row ${event.kind ?? ""}`}>
            <time>{formatTime(event.timeMs)}</time>
            <span>{event.message}</span>
          </div>
        ))
      )}
    </section>
  );
}
