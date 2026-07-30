import { getEventLabel } from "../game/league";
import type { LeagueState, MatchState } from "../game/types";

export function LeagueView({
  league,
  match,
  ownedBotIds,
  onBackToArena,
  onOpenBots,
  onOpenVideos,
  onOpenFantasy,
}: {
  league: LeagueState;
  match: MatchState | null;
  ownedBotIds: string[];
  onBackToArena: () => void;
  onOpenBots: () => void;
  onOpenVideos: () => void;
  onOpenFantasy: () => void;
}) {
  const owned = new Set(ownedBotIds);
  const leader = league.standings[0];
  const progress = Math.min(100, Math.round((league.matchesCompleted / league.matchesPerSeason) * 100));
  const liveBotIds = new Set(match?.bots.filter((bot) => bot.alive).map((bot) => bot.id) ?? []);

  return (
    <main className="league-shell">
      <header className="league-hero">
        <div>
          <span>Season {league.seasonNumber}</span>
          <h1>{league.seasonName}</h1>
          <p>A persistent league where every finish, kill, and rivalry carries into the season table.</p>
        </div>
        <nav className="league-nav" aria-label="Primary views">
          <button type="button" className="secondary-button" onClick={onBackToArena}>Arena</button>
          <button type="button" className="active">League</button>
          <button type="button" className="secondary-button" onClick={onOpenFantasy}>Fantasy</button>
          <button type="button" className="secondary-button" onClick={onOpenBots}>Bots</button>
          <button type="button" className="secondary-button" onClick={onOpenVideos}>Videos</button>
        </nav>
      </header>

      <section className="league-event-card">
        <div className={`event-medallion ${league.currentEvent.type}`} aria-hidden="true">
          {league.currentEvent.type === "championship" ? "C" : league.currentEvent.type === "headline" ? "H" : league.currentEvent.matchOfSeason}
        </div>
        <div className="league-event-copy">
          <span>{league.status === "completed" ? "Season complete" : getEventLabel(league.currentEvent.type)}</span>
          <h2>{league.currentEvent.name}</h2>
          <p>
            {league.status === "completed"
              ? `${league.champions[0]?.botName ?? leader?.name ?? "The champion"} claimed the crown. The next season begins with the next match.`
              : league.currentEvent.type === "championship"
                ? "The highest-ranked fighters contest the season crown."
                : league.currentEvent.type === "headline"
                  ? "Top-ranked fighters take priority in this featured match."
                  : "The open circuit continues. Every entrant can climb the table."}
          </p>
        </div>
        <div className="season-progress">
          <strong>{league.matchesCompleted}/{league.matchesPerSeason}</strong>
          <span>matches complete</span>
          <div><i style={{ width: `${progress}%` }} /></div>
        </div>
      </section>

      <section className="league-layout">
        <div className="standings-panel">
          <div className="league-section-heading">
            <div>
              <span>Official table</span>
              <h2>Season standings</h2>
            </div>
            <small>Points / rating / recent form</small>
          </div>
          <div className="standings-table" role="table" aria-label={`${league.seasonName} standings`}>
            <div className="standing-row standing-header" role="row">
              <span>#</span><span>Fighter</span><span>Division</span><span>Record</span><span>Kills</span><span>Rating</span><span>Points</span><span>Form</span>
            </div>
            {league.standings.map((standing, index) => (
              <div key={standing.botId} className={`standing-row ${owned.has(standing.botId) ? "owned" : ""}`} role="row">
                <strong>{index + 1}</strong>
                <span className="standing-fighter">
                  <b>{standing.name}</b>
                  <small>{liveBotIds.has(standing.botId) ? "Live now" : owned.has(standing.botId) ? "Your fighter" : standing.ownerName ? `by ${standing.ownerName}` : standing.custom ? "Community" : "Arena"}</small>
                </span>
                <span className={`division-badge ${standing.division.toLowerCase()}`}>{standing.division}</span>
                <span>{standing.wins}W / {Math.max(0, standing.matchesPlayed - standing.wins)}L</span>
                <span>{standing.kills}</span>
                <span>{standing.rating}</span>
                <strong>{standing.points}</strong>
                <span className="form-strip" aria-label={`Recent form: ${standing.form.join(", ") || "none"}`}>
                  {standing.form.length ? standing.form.map((result, resultIndex) => <i key={`${standing.botId}-${resultIndex}`} className={result}>{result}</i>) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <aside className="league-sidebar">
          <section>
            <span>Current leader</span>
            <h2>{leader?.name ?? "Awaiting first result"}</h2>
            {leader ? <p>{leader.points} points with {leader.wins} wins and {leader.podiums} podiums.</p> : <p>The first match will establish the table.</p>}
          </section>
          <section>
            <span>Scoring</span>
            <h2>Every decision matters</h2>
            <p>Finishes award 12–1 points to the top six. Every elimination adds one more. Rating adjusts for strength of field.</p>
          </section>
          <section className="champions-card">
            <span>Hall of champions</span>
            <h2>Season crowns</h2>
            {league.champions.length ? (
              <ol>
                {league.champions.slice(0, 5).map((champion) => (
                  <li key={champion.seasonId}><strong>{champion.botName}</strong><small>S{champion.seasonNumber} · {champion.points} pts</small></li>
                ))}
              </ol>
            ) : <p>The first champion has not been crowned.</p>}
          </section>
        </aside>
      </section>
    </main>
  );
}
