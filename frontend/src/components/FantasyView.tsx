import { useEffect, useMemo, useState } from "react";
import { loadFantasyLeaderboard } from "../game/remotePersistence";
import type { FantasyLeaderboardEntry, LeagueState, PersistentBot, PlayerState } from "../game/types";

export function FantasyView({
  league,
  bots,
  player,
  onSaveRoster,
  onBackToArena,
  onOpenLeague,
  onOpenBots,
}: {
  league: LeagueState;
  bots: PersistentBot[];
  player: PlayerState;
  onSaveRoster: (botIds: string[]) => Promise<boolean>;
  onBackToArena: () => void;
  onOpenLeague: () => void;
  onOpenBots: () => void;
}) {
  const [draft, setDraft] = useState(player.draftedBotIds);
  const [leaderboard, setLeaderboard] = useState<FantasyLeaderboardEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);
  const standingsById = useMemo(() => new Map(league.standings.map((standing, index) => [standing.botId, { standing, rank: index + 1 }])), [league.standings]);
  const rosterBots = draft.map((id) => botsById.get(id)).filter((bot): bot is PersistentBot => Boolean(bot));
  const discoverBots = league.standings.map((entry) => botsById.get(entry.botId)).filter((bot): bot is PersistentBot => Boolean(bot)).slice(0, 16);
  const hasChanges = draft.length !== player.draftedBotIds.length || draft.some((id, index) => id !== player.draftedBotIds[index]);

  useEffect(() => {
    setDraft(player.draftedBotIds);
  }, [player.draftedBotIds]);

  useEffect(() => {
    let cancelled = false;
    void loadFantasyLeaderboard(50)
      .then((entries) => {
        if (!cancelled) setLeaderboard(entries);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Fantasy leaderboard unavailable");
      });
    return () => { cancelled = true; };
  }, [league.seasonId, player.fantasy.points]);

  const toggleFighter = (botId: string) => {
    setDraft((current) => current.includes(botId)
      ? current.filter((id) => id !== botId)
      : current.length < 5
        ? [...current, botId]
        : current);
  };

  const saveRoster = async () => {
    setPending(true);
    setError(null);
    const saved = await onSaveRoster(draft);
    if (!saved) setError("Fantasy roster could not be saved.");
    setPending(false);
  };

  return (
    <main className="fantasy-shell">
      <header className="fantasy-hero">
        <div>
          <span>Season {league.seasonNumber} fantasy</span>
          <h1>Build your five.</h1>
          <p>Scout the league, back autonomous fighters, and score every time your roster survives, deals damage, or gets an elimination.</p>
        </div>
        <nav className="fantasy-nav" aria-label="Primary views">
          <button type="button" className="secondary-button" onClick={onBackToArena}>Arena</button>
          <button type="button" className="secondary-button" onClick={onOpenLeague}>League</button>
          <button type="button" className="active">Fantasy</button>
          <button type="button" className="secondary-button" onClick={onOpenBots}>Bots</button>
        </nav>
      </header>

      <section className="fantasy-scoreboard">
        <div><span>Your coach</span><strong>{player.accountName}</strong></div>
        <div><span>Season score</span><strong>{player.fantasy.seasonId === league.seasonId ? player.fantasy.points : 0}</strong></div>
        <div><span>Roster</span><strong>{draft.length}/5</strong></div>
        <div><span>Next event</span><strong>{league.currentEvent.name}</strong></div>
      </section>

      <section className="fantasy-layout">
        <div className="fantasy-main">
          <section className="fantasy-roster-panel">
            <div className="fantasy-section-heading">
              <div><span>Your roster</span><h2>Five fighters, one season</h2></div>
              <button type="button" onClick={() => void saveRoster()} disabled={pending || !hasChanges}>{pending ? "Saving..." : "Save roster"}</button>
            </div>
            <div className="fantasy-roster-grid">
              {Array.from({ length: 5 }, (_, index) => {
                const bot = rosterBots[index];
                const ranking = bot ? standingsById.get(bot.id) : undefined;
                return bot ? (
                  <article key={bot.id}>
                    <span>Slot {index + 1} · Rank #{ranking?.rank ?? "—"}</span>
                    <h3>{bot.name}</h3>
                    <p>{bot.ownerName ? `Coached by ${bot.ownerName}` : bot.doctrineSummary ?? "Autonomous instincts"}</p>
                    <button type="button" className="secondary-button" onClick={() => toggleFighter(bot.id)}>Remove</button>
                  </article>
                ) : <article key={`empty-${index}`} className="empty-fantasy-slot"><span>Slot {index + 1}</span><strong>Open</strong></article>;
              })}
            </div>
          </section>

          <section className="fantasy-pool-panel">
            <div className="fantasy-section-heading"><div><span>Scouting board</span><h2>League fighters</h2></div><small>Ordered by official standing</small></div>
            <div className="fantasy-pool-grid">
              {discoverBots.map((bot) => {
                const ranking = standingsById.get(bot.id);
                const selected = draft.includes(bot.id);
                return (
                  <article key={bot.id} className={selected ? "selected" : ""}>
                    <div><span>#{ranking?.rank ?? "—"} · {ranking?.standing.division}</span><strong>{ranking?.standing.points ?? 0} pts</strong></div>
                    <h3>{bot.name}</h3>
                    <p>{bot.ownerName ? `by ${bot.ownerName}` : `${bot.career.wins} career wins`}</p>
                    <button type="button" className={selected ? "secondary-button" : ""} onClick={() => toggleFighter(bot.id)} disabled={!selected && draft.length >= 5}>
                      {selected ? "Selected" : "Draft"}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="fantasy-sidebar">
          <section>
            <span>Scoring</span><h2>Performance, not popularity</h2>
            <ul><li>10–1 points for a top-six finish</li><li>2 points per elimination</li><li>1 point per 50 damage</li></ul>
          </section>
          <section>
            <span>Coach table</span><h2>Fantasy leaders</h2>
            {leaderboard.length ? <ol>{leaderboard.slice(0, 12).map((entry, index) => (
              <li key={entry.accountId} className={entry.accountId === player.accountId ? "you" : ""}><b>#{index + 1}</b><span>{entry.accountName}</span><strong>{entry.points}</strong></li>
            ))}</ol> : <p>The first fantasy points have not been scored.</p>}
          </section>
          {player.fantasy.history.length > 0 && <section><span>Recent score</span><h2>+{player.fantasy.history[0].points} points</h2><p>{player.fantasy.history[0].fighterScores.map((score) => `${score.botName} +${score.points}`).join(" · ")}</p></section>}
          {error && <p className="fantasy-error" role="alert">{error}</p>}
        </aside>
      </section>
    </main>
  );
}
