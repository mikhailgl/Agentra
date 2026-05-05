import { formatTime } from "../format";
import type { GameEvent } from "../game/types";

export function EventLog({ events }: { events: GameEvent[] }) {
  return (
    <section className="event-log">
      <h2>Event Log</h2>
      <div className="event-list">
        {events.map((event) => (
          <div key={event.id} className="event-row">
            <time>{formatTime(event.timeMs)}</time>
            <span>{event.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
