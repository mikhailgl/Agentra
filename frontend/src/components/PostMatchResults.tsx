import { formatTime } from "../format";
import { getBetTypeLabel } from "../game/player";
import type { BetResolution, MatchState } from "../game/types";

export type PostMatchSummary = {
  matchNumber: number;
  winnerName: string;
  extractedCredits: number;
  awardedCredits: number;
  betResults: BetResolution[];
  placements: Array<{
    botId: string;
    name: string;
    place: number;
    kills: number;
    damage: number;
    survivalMs: number;
    carriedCredits: number;
    custom?: boolean;
    level: number;
    recentResult?: string;
  }>;
};

export function createPostMatchSummary(
  matchNumber: number,
  match: MatchState,
  betResults: BetResolution[],
  awardedCredits: number,
): PostMatchSummary {
  const placements = [...match.bots]
    .sort((a, b) => b.survivalTimeMs - a.survivalTimeMs || b.kills - a.kills || b.damageDealt - a.damageDealt)
    .map((bot, index) => ({
      botId: bot.id,
      name: bot.name,
      place: index + 1,
      kills: bot.kills,
      damage: Math.round(bot.damageDealt),
      survivalMs: bot.survivalTimeMs,
      carriedCredits: bot.carriedCredits,
      custom: bot.custom,
      level: bot.level,
      recentResult: bot.recentResults[0],
    }));
  const winner = match.winnerId ? match.bots.find((bot) => bot.id === match.winnerId) : null;

  return {
    matchNumber,
    winnerName: winner?.name ?? "No survivor",
    extractedCredits: winner?.carriedCredits ?? 0,
    awardedCredits,
    betResults,
    placements,
  };
}

export function PostMatchResults({
  summary,
  countdownSeconds,
  onStartNextNow,
}: {
  summary: PostMatchSummary;
  countdownSeconds: number;
  onStartNextNow: () => void;
}) {
  const yourPlacements = summary.placements.filter((placement) => placement.custom);
  const netBetCredits = summary.betResults.reduce((sum, result) => sum + result.net, 0);

  return (
    <section className="post-match-overlay">
      <header className="post-match-header">
        <div>
          <span>Match #{summary.matchNumber} complete</span>
          <h2>{summary.winnerName} wins</h2>
          <p>Next match starts in {countdownSeconds}s.</p>
        </div>
        <button type="button" onClick={onStartNextNow}>
          Start Next Now
        </button>
      </header>

      <div className="post-match-metrics">
        <ResultMetric label="Extracted" value={`${summary.extractedCredits.toLocaleString()}`} meta="winner loot" />
        <ResultMetric label="Your reward" value={`${summary.awardedCredits.toLocaleString()}`} meta="owned winner payout" />
        <ResultMetric label="Bets" value={`${netBetCredits >= 0 ? "+" : ""}${netBetCredits.toLocaleString()}`} meta={`${summary.betResults.length} resolved`} />
      </div>

      {yourPlacements.length > 0 && (
        <section className="your-fighters-panel">
          <h3>Your Fighters</h3>
          {yourPlacements.map((placement) => (
            <article key={placement.botId}>
              <strong>#{placement.place} {placement.name}</strong>
              <span>{placement.recentResult ?? `${placement.kills} kills / ${formatTime(placement.survivalMs)}`}</span>
            </article>
          ))}
        </section>
      )}

      <section className="placements-panel">
        <h3>Final Placements</h3>
        <div className="placements-list">
          {summary.placements.slice(0, 8).map((placement) => (
            <article key={placement.botId} className={placement.custom ? "owned" : ""}>
              <strong>#{placement.place} {placement.name}</strong>
              <span>{placement.kills}K / {placement.damage} dmg / {formatTime(placement.survivalMs)}</span>
              <small>Lv {placement.level}{placement.carriedCredits ? ` / ${placement.carriedCredits} credits` : ""}</small>
            </article>
          ))}
        </div>
      </section>

      {summary.betResults.length > 0 && (
        <section className="bet-results-panel">
          <h3>Bet Results</h3>
          {summary.betResults.map((result) => (
            <article key={result.bet.id} className={result.net >= 0 ? "won" : "lost"}>
              <strong>{getBetTypeLabel(result.bet.type)} on {result.botName}</strong>
              <span>{result.net >= 0 ? "+" : ""}{result.net.toLocaleString()} credits</span>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}

function ResultMetric({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </article>
  );
}
