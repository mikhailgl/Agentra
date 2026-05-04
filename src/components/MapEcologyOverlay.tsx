import { getBiomeName } from "../game/biomes";
import type { MatchState } from "../game/types";

export function MapEcologyOverlay({ match }: { match: MatchState }) {
  const activeEvents = match.mapEvents.filter((event) => event.startedAtMs + event.durationMs > match.elapsedMs);
  const lootByCategory = match.loot.reduce<Record<string, number>>((counts, item) => {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
  }, {});

  return (
    <section className="ecology-overlay">
      <h2>Map Ecology</h2>
      <div className="ecology-metrics">
        <span>{match.zones.length} biomes</span>
        <span>{match.loot.length} loot</span>
        <span>{match.creatures.length} NPC</span>
      </div>
      {activeEvents.length > 0 ? (
        <div className="event-list compact-events">
          {activeEvents.slice(0, 3).map((event) => (
            <div key={event.id} className="event-row">
              <span>{event.type.replace("_", " ")}</span>
              <time>{getBiomeName(event.biome)}</time>
            </div>
          ))}
        </div>
      ) : (
        <p>No active map event.</p>
      )}
      <small>
        {Object.entries(lootByCategory)
          .map(([category, count]) => `${category} ${count}`)
          .join(" / ")}
      </small>
    </section>
  );
}
