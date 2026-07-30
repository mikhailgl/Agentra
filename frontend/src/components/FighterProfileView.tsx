import { useEffect, useState } from "react";
import { formatTime } from "../format";
import { loadFighterProfile } from "../game/remotePersistence";
import type { FighterPublicProfile } from "../game/types";

export function FighterProfileView({
  fighterId,
  isFavorite,
  interactionReady,
  onToggleFavorite,
  onBackToArena,
  onOpenBots,
  onOpenLeague,
}: {
  fighterId: string;
  isFavorite: boolean;
  interactionReady: boolean;
  onToggleFavorite: (botId: string, favorite: boolean) => Promise<number | null>;
  onBackToArena: () => void;
  onOpenBots: () => void;
  onOpenLeague: () => void;
}) {
  const [profile, setProfile] = useState<FighterPublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favorite, setFavorite] = useState(isFavorite);
  const [fanPending, setFanPending] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadFighterProfile(fighterId)
      .then((nextProfile) => {
        if (cancelled) return;
        setProfile(nextProfile);
        setError(nextProfile ? null : "This fighter profile is not available.");
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Fighter profile unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [fighterId]);

  useEffect(() => setFavorite(isFavorite), [isFavorite]);

  const toggleFavorite = async () => {
    const nextFavorite = !favorite;
    setFanPending(true);
    const fanCount = await onToggleFavorite(fighterId, nextFavorite);
    setFanPending(false);
    if (fanCount === null) return;
    setFavorite(nextFavorite);
    setProfile((current) => current ? { ...current, fanCount } : current);
  };

  const shareProfile = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShared(true);
      window.setTimeout(() => setShared(false), 1_800);
    } catch {
      setShared(false);
    }
  };

  if (loading) return <main className="fighter-profile-shell"><div className="fighter-profile-status">Loading fighter profile...</div></main>;
  if (!profile || error) return <main className="fighter-profile-shell"><div className="fighter-profile-status"><strong>Fighter unavailable</strong><span>{error}</span><button onClick={onOpenBots}>Browse fighters</button></div></main>;

  const { bot, standing } = profile;
  const losses = Math.max(0, bot.career.matchesPlayed - bot.career.wins);

  return (
    <main className="fighter-profile-shell">
      <header className="fighter-profile-nav">
        <button type="button" className="fighter-wordmark" onClick={onBackToArena}>BotArena Fighters</button>
        <nav aria-label="Fighter profile navigation">
          <button type="button" className="secondary-button" onClick={onOpenBots}>All fighters</button>
          <button type="button" className="secondary-button" onClick={onOpenLeague}>League</button>
          <button type="button" onClick={() => void shareProfile()}>{shared ? "Link copied" : "Share"}</button>
        </nav>
      </header>

      <article className="fighter-public-profile">
        <header className="fighter-public-hero">
          <div className="fighter-public-sigil" aria-hidden="true">{bot.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <span>{bot.ownerName ? `Fighter by ${bot.ownerName}` : "Public arena fighter"}</span>
            <h1>{bot.name}</h1>
            <p>{bot.doctrineSummary ?? "Autonomous instincts"}</p>
          </div>
          <div className="fan-club-card">
            <span>Fan club</span>
            <strong>{profile.fanCount.toLocaleString()}</strong>
            <button type="button" className={favorite ? "secondary-button" : ""} disabled={fanPending || !interactionReady} onClick={() => void toggleFavorite()}>
              {!interactionReady ? "Connecting..." : fanPending ? "Updating..." : favorite ? "Leave fan club" : "Join fan club"}
            </button>
          </div>
        </header>

        <section className="fighter-public-metrics">
          <Metric label="Level" value={bot.level} />
          <Metric label="Record" value={`${bot.career.wins}–${losses}`} />
          <Metric label="Kills" value={bot.career.kills} />
          <Metric label="Damage" value={Math.round(bot.career.damageDealt)} />
          <Metric label="Best survival" value={formatTime(bot.career.longestSurvivalTime)} />
          <Metric label="Division" value={standing?.division ?? "Unranked"} />
        </section>

        <section className="fighter-profile-grid">
          <div className="fighter-profile-main">
            <section className="fighter-profile-card">
              <div className="fighter-profile-heading"><span>Career feed</span><h2>Recent arena stories</h2></div>
              {profile.recentStories.length ? profile.recentStories.map((story) => (
                <a key={story.matchNumber} className="fighter-story-row" href={`#story-${story.matchNumber}`}>
                  <b>{story.won ? "WIN" : `#${story.placement}`}</b>
                  <div><strong>{story.eventName}</strong><small>{story.kills} eliminations · {story.damageDealt} damage</small></div>
                  <time>{new Date(story.endedAt).toLocaleDateString()}</time>
                </a>
              )) : <p className="fighter-empty-copy">This fighter is waiting to write its first official match story.</p>}
            </section>

            <section className="fighter-profile-card">
              <div className="fighter-profile-heading"><span>Memory</span><h2>Public journal</h2></div>
              <div className="fighter-journal-grid">{(bot.journal ?? []).slice(0, 8).map((entry) => <article key={entry.id}><span>{entry.tone}</span><strong>{entry.title}</strong><p>{entry.body}</p></article>)}</div>
            </section>
          </div>

          <aside className="fighter-profile-side">
            <section className="fighter-profile-card">
              <span>League status</span>
              <h2>{standing ? `#${standing.lastPlacement ?? "–"} last finish` : "Awaiting ranking"}</h2>
              {standing && <div className="fighter-standing-list"><span>{standing.points} points</span><span>{standing.rating} rating</span><span>{standing.wins} wins</span><span>{standing.podiums} podiums</span></div>}
            </section>
            <section className="fighter-profile-card">
              <span>Agent identity</span>
              {bot.agentStrategy ? <><h2>{bot.agentStrategy.name} <small>v{bot.agentStrategy.version}</small></h2><p>{bot.agentStrategy.description}</p><strong>by {bot.agentStrategy.authorName}</strong><div className="fighter-policy-list">{Object.entries(bot.agentStrategy.policy).map(([key, value]) => <span key={key}>{key}: {typeof value === "number" ? Math.round(value * 100) : value}</span>)}</div></> : <><h2>Native autonomy</h2><p>Personality, doctrine, memory, and learned affinities drive this fighter without an external strategy.</p></>}
            </section>
          </aside>
        </section>
      </article>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}
