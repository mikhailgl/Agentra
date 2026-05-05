import { formatTime } from "../format";
import type { MatchRecord } from "../game/history";
import { buildPostMatchRecap } from "../game/history";
import type { Bot } from "../game/types";

export function MatchSummary({
  bots,
  durationMs,
  winner,
  record,
  history,
  draftedBotIds = [],
  learningEvents = [],
}: {
  bots: Bot[];
  durationMs: number;
  winner: Bot | null;
  record: MatchRecord | null;
  history: MatchRecord[];
  draftedBotIds?: string[];
  learningEvents?: string[];
}) {
  const recap = record ? buildPostMatchRecap(record, bots, history) : null;

  return (
    <section className="match-summary">
      <div className="summary-heading">
        <span>Winner</span>
        <strong>{winner?.name ?? "No survivor"}</strong>
        <small>{formatTime(durationMs)}</small>
      </div>
      {recap && (
        <div className="recap-grid">
          <RecapDetail label="Top killer" value={recap.topKiller} />
          <RecapDetail label="Most damage" value={recap.mostDamage} />
          <RecapDetail label="Longest survivor" value={recap.longestSurvivor} />
          <RecapDetail label="Major betrayal" value={recap.majorBetrayal} />
          <RecapDetail label="Strongest alliance" value={recap.strongestAlliance} />
          <RecapDetail label="Biggest upset" value={recap.biggestUpset} />
        </div>
      )}
      {learningEvents.length > 0 && (
        <div className="learning-recap">
          <h3>Learning</h3>
          {learningEvents.slice(0, 4).map((event) => (
            <p key={event}>{event}</p>
          ))}
        </div>
      )}
      <div className="summary-table" role="table" aria-label="Match summary">
        <div className="summary-row summary-header" role="row">
          <span>Bot</span>
          <span>K</span>
          <span>Dmg</span>
          <span>Survived</span>
        </div>
        {[...bots]
          .sort((a, b) => b.kills - a.kills || b.damageDealt - a.damageDealt)
          .map((bot) => (
            <div key={bot.id} className={`summary-row ${draftedBotIds.includes(bot.id) ? "drafted-summary-row" : ""}`} role="row">
              <span>{draftedBotIds.includes(bot.id) ? `${bot.name} (stable)` : bot.name}</span>
              <span>{bot.kills}</span>
              <span>{bot.damageDealt}</span>
              <span>{formatTime(bot.survivalTimeMs)}</span>
            </div>
          ))}
      </div>
    </section>
  );
}

function RecapDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
