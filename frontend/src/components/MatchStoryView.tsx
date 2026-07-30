import { useEffect, useMemo, useState } from "react";
import { formatTime } from "../format";
import { loadGeneratedMedia, loadMatchLog } from "../game/remotePersistence";
import type { GeneratedMedia, MatchLog } from "../game/types";

export function MatchStoryView({
  matchNumber,
  onBackToArena,
  onOpenVideos,
  onOpenLeague,
}: {
  matchNumber: number;
  onBackToArena: () => void;
  onOpenVideos: () => void;
  onOpenLeague: () => void;
}) {
  const [log, setLog] = useState<MatchLog | null>(null);
  const [media, setMedia] = useState<GeneratedMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([loadMatchLog(matchNumber), loadGeneratedMedia(100)])
      .then(([nextLog, allMedia]) => {
        if (cancelled) return;
        setLog(nextLog);
        setMedia(allMedia.filter((item) => item.matchNumber === matchNumber));
        setError(nextLog ? null : "This match story is not available.");
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Match story unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [matchNumber]);

  const placements = useMemo(() => {
    if (!log) return [];
    return [...log.botResults]
      .sort((a, b) => b.survivalTimeMs - a.survivalTimeMs || b.kills - a.kills || b.damageDealt - a.damageDealt)
      .map((result, index) => ({ ...result, placement: index + 1, entrant: log.entrants.find((entrant) => entrant.botId === result.botId) }));
  }, [log]);

  const shareStory = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShared(true);
      window.setTimeout(() => setShared(false), 1_800);
    } catch {
      setShared(false);
    }
  };

  if (loading) return <main className="story-shell"><div className="story-status">Loading match story...</div></main>;
  if (!log || error) return <main className="story-shell"><div className="story-status"><strong>Story unavailable</strong><span>{error}</span><button onClick={onOpenVideos}>Back to videos</button></div></main>;

  const winner = placements[0];
  const killCount = log.botResults.reduce((sum, bot) => sum + bot.kills, 0);
  const headline = log.competition?.eventType === "championship" ? `${log.winnerName ?? "A survivor"} claimed the season crown` : `${log.winnerName ?? "A survivor"} outlasted the arena`;

  return (
    <main className="story-shell">
      <header className="story-nav">
        <a href="#arena" onClick={(event) => { event.preventDefault(); onBackToArena(); }}>BotArena Stories</a>
        <nav aria-label="Story navigation">
          <button type="button" className="secondary-button" onClick={onOpenLeague}>League</button>
          <button type="button" className="secondary-button" onClick={onOpenVideos}>Videos</button>
          <button type="button" onClick={() => void shareStory()}>{shared ? "Link copied" : "Share story"}</button>
        </nav>
      </header>

      <article className="match-story">
        <header className="story-hero">
          <span>{log.competition?.seasonName ?? "BotArena"} · {log.competition?.eventName ?? `Match ${log.matchNumber}`}</span>
          <h1>{headline}</h1>
          <p>{winner?.entrant?.ownerName ? `${winner.entrant.ownerName}'s fighter wrote the latest chapter in the league.` : "Another autonomous fighter added its name to arena history."}</p>
          <div className="story-byline"><time>{new Date(log.endedAt).toLocaleString()}</time><span>{formatTime(log.durationMs)}</span><span>{log.entrants.length} fighters</span><span>{killCount} eliminations</span></div>
        </header>

        <section className="story-lede">
          <div className="winner-monogram" aria-hidden="true">{(log.winnerName ?? "?").slice(0, 1)}</div>
          <div><span>Winner</span><h2>{log.winnerName ?? "No survivor"}</h2><p>{winner ? `${winner.kills} eliminations, ${winner.damageDealt} damage, and ${winner.carriedCredits} credits extracted.` : "The arena claimed every entrant."}</p></div>
        </section>

        {media.length > 0 && <section className="story-media"><div className="story-section-heading"><span>Watch</span><h2>Archived match cuts</h2></div><div className="story-media-grid">{media.map((item) => <article key={item.id}><video src={item.publicUrl} controls playsInline preload="metadata" /><div><strong>{item.title}</strong><span>Archived by {item.accountName}</span><a href={item.publicUrl} target="_blank" rel="noreferrer">Open video</a></div></article>)}</div></section>}

        <section className="story-grid">
          <div className="story-timeline">
            <div className="story-section-heading"><span>The story</span><h2>Defining moments</h2></div>
            {(log.highlights.length ? log.highlights : log.events).slice(0, 14).map((event) => {
              const timestamp = "timestamp" in event ? event.timestamp : event.timeMs;
              return <article key={event.id}><time>{formatTime(timestamp)}</time><div><strong>{"type" in event ? event.type.replaceAll("_", " ") : event.kind ?? "arena"}</strong><p>{event.message}</p></div></article>;
            })}
          </div>
          <aside className="story-results">
            <div className="story-section-heading"><span>Final table</span><h2>Placements</h2></div>
            {placements.slice(0, 10).map((result) => <article key={result.botId}><b>#{result.placement}</b><div><strong>{result.name}</strong><small>{result.entrant?.ownerName ? `by ${result.entrant.ownerName}` : `${result.kills} eliminations`}</small></div><span>{result.damageDealt} dmg</span></article>)}
          </aside>
        </section>

        {log.narrativeMoments.length > 0 && <section className="story-epilogue"><span>Arena record</span><h2>What people will remember</h2><div>{log.narrativeMoments.slice(0, 6).map((moment) => <article key={moment.id}><strong>{moment.title}</strong><p>{moment.description ?? "The arena shifted around its fighters."}</p></article>)}</div></section>}
      </article>
    </main>
  );
}
