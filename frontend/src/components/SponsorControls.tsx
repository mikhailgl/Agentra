import type { SponsorDropKind } from "../game/simulation";
import type { Bot } from "../game/types";

const DROPS: SponsorDropKind[] = ["Knife", "Spear", "Bow", "Medkit"];

export function SponsorControls({
  selectedBot,
  onDrop,
}: {
  selectedBot: Bot | null;
  onDrop: (kind: SponsorDropKind) => void;
}) {
  return (
    <section className="sponsor-panel">
      <h2>Sponsor Drop</h2>
      <div className="sponsor-grid">
        {DROPS.map((drop) => (
          <button key={drop} type="button" disabled={!selectedBot?.alive} onClick={() => onDrop(drop)}>
            {drop}
          </button>
        ))}
      </div>
    </section>
  );
}
