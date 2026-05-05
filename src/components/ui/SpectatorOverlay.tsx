import { useEffect, useState } from "react";
import { formatTime } from "../../format";
import type { ArenaState, BasicMatchResult, Bot, NarrativeMoment, PersistentBot } from "../../game/types";
import { getTraitLabels } from "../../game/traits";
import type { CameraMode } from "../../lib/simulation/types";

type DetailTab = "loadout" | "skills";
type MatchTableTab = "current" | "queue";

export function SpectatorOverlay({
  arenaState,
  bots,
  queuedBots,
  selectedBot,
  credits,
  results,
  cameraMode,
  onSelectBot,
  onCameraModeChange,
  onTogglePause,
  onResetCamera,
  onStartNextNow,
  narrativeMoments,
}: {
  arenaState: ArenaState;
  bots: Bot[];
  queuedBots: PersistentBot[];
  selectedBot: Bot | null;
  credits: number;
  results: BasicMatchResult[];
  cameraMode: CameraMode;
  narrativeMoments: NarrativeMoment[];
  onSelectBot: (botId: string) => void;
  onCameraModeChange: (mode: CameraMode) => void;
  onTogglePause: () => void;
  onResetCamera: () => void;
  onStartNextNow: () => void;
}) {
  const [detailTab, setDetailTab] = useState<DetailTab>("loadout");
  const [matchTableTab, setMatchTableTab] = useState<MatchTableTab>("current");
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const activeBots = bots.filter((bot) => bot.alive);
  const aliveCount = activeBots.length;
  const winner = arenaState.lastWinnerId ? bots.find((bot) => bot.id === arenaState.lastWinnerId) ?? null : null;
  const countdownSeconds = arenaState.intermissionEndsAt
    ? Math.max(0, Math.ceil((arenaState.intermissionEndsAt - Date.now()) / 1000))
    : 0;

  useEffect(() => {
    setDetailsExpanded(false);
  }, [selectedBot?.id]);

  return (
    <>
      <section className="spectator-top">
        <div className="metric">
          <span>Match</span>
          <strong>#{arenaState.matchNumber}</strong>
        </div>
        <div className="metric">
          <span>Alive</span>
          <strong>
            {aliveCount}/{bots.length}
          </strong>
        </div>
        <div className="metric">
          <span>Credits</span>
          <strong>{credits.toLocaleString()}</strong>
        </div>
        <div className="metric">
          <span>Phase</span>
          <strong>{arenaState.phase}</strong>
        </div>
        <select value={cameraMode} onChange={(event) => onCameraModeChange(event.target.value as CameraMode)} aria-label="Camera mode">
          <option value="follow_action">Follow action</option>
          <option value="follow_leader">Follow leader</option>
          <option value="follow_bot">Follow bot</option>
          <option value="free">Free camera</option>
        </select>
        <select value={selectedBot?.alive ? selectedBot.id : ""} onChange={(event) => event.target.value && onSelectBot(event.target.value)} aria-label="Follow bot">
          <option value="">Bot</option>
          {activeBots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>
        <button type="button" className="secondary-button" onClick={onTogglePause}>
          {arenaState.phase === "paused" ? "Resume" : "Pause"}
        </button>
        <button type="button" className={cameraMode === "free" ? "active" : "secondary-button"} onClick={onResetCamera}>
          Free
        </button>
      </section>

      <NarrativeToasts moments={narrativeMoments} />

      <aside className="current-bot-list">
        <div className="overlay-heading">
          <h2>{matchTableTab === "current" ? "Current Match" : "Bot Queue"}</h2>
          <span>
            {matchTableTab === "current"
              ? formatTime(Math.max(...bots.map((bot) => bot.survivalTimeMs), 0))
              : `${queuedBots.length} waiting`}
          </span>
        </div>
        <div className="overlay-tabs match-table-tabs" role="tablist" aria-label="Match table views">
          <button type="button" className={matchTableTab === "current" ? "active" : ""} onClick={() => setMatchTableTab("current")}>
            Match
          </button>
          <button type="button" className={matchTableTab === "queue" ? "active" : ""} onClick={() => setMatchTableTab("queue")}>
            Queue
          </button>
        </div>
        {matchTableTab === "current" ? (
          <div className="bot-list-scroll">
            {bots.map((bot) => (
              <div
                key={bot.id}
                className={`bot-list-row ${selectedBot?.id === bot.id ? "selected" : ""} ${bot.alive ? "" : "dead"}`}
              >
                <button type="button" className="bot-list-main" onClick={() => onSelectBot(bot.id)}>
                  <span className="bot-list-name">{bot.name}</span>
                  <span>{Math.round(bot.health)} hp</span>
                  <span>{bot.alive ? "Alive" : "Dead"}</span>
                  <span>{bot.kills} K</span>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <QueuedBotList bots={queuedBots} />
        )}
        {matchTableTab === "current" && results.length > 0 && (
          <div className="recent-winners">
            <h2>Recent Winners</h2>
            {results.slice(0, 3).map((result) => (
              <span key={`${result.matchNumber}-${result.winnerBotId}`}>
                #{result.matchNumber} {result.winnerName}
              </span>
            ))}
          </div>
        )}
      </aside>

      <section className={`selected-bot-dock ${detailsExpanded ? "expanded" : ""}`}>
        {selectedBot && detailsExpanded && <SelectedBotDetails bot={selectedBot} activeTab={detailTab} onTabChange={setDetailTab} />}
        <button
          type="button"
          className="selected-bot-overlay"
          onClick={() => selectedBot && setDetailsExpanded((value) => !value)}
          disabled={!selectedBot}
          aria-expanded={selectedBot ? detailsExpanded : undefined}
        >
          {selectedBot ? (
            <>
              <div>
                <span>Selected Bot</span>
                <strong>{selectedBot.name}</strong>
              </div>
              <div>
                <span>Health</span>
                <strong>{Math.round(selectedBot.health)}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{selectedBot.alive ? "Alive" : "Dead"}</strong>
              </div>
              <div>
                <span>Kills</span>
                <strong>{selectedBot.kills}</strong>
              </div>
              <div className="selected-bot-toggle">
                <span>Details</span>
                <strong>{detailsExpanded ? "Hide" : "Show"}</strong>
              </div>
            </>
          ) : (
            <div>
              <span>Selected Bot</span>
              <strong>None</strong>
            </div>
          )}
        </button>
      </section>

      {arenaState.phase === "intermission" && (
        <section className="intermission-overlay">
          <span>Intermission</span>
          <h2>{winner ? `${winner.name} wins match #${arenaState.matchNumber}` : `Match #${arenaState.matchNumber} ended`}</h2>
          <p>Next match starts in {countdownSeconds}s.</p>
          <button type="button" onClick={onStartNextNow}>
            Start Next Now
          </button>
        </section>
      )}
    </>
  );
}

function QueuedBotList({ bots }: { bots: PersistentBot[] }) {
  if (bots.length === 0) {
    return <p className="empty-panel-note">No bots are waiting for the next match.</p>;
  }

  return (
    <div className="bot-list-scroll">
      {bots.map((bot, index) => (
        <article key={bot.id} className="bot-list-row queue-list-row">
          <div className="bot-list-main queue-list-main">
            <span className="queue-position">#{index + 1}</span>
            <span className="bot-list-name">{bot.name}</span>
            <span>Lv {bot.level}</span>
            <span>{bot.career.wins}/{bot.career.matchesPlayed}</span>
          </div>
          <small>{summarizeQueuedBot(bot)}</small>
        </article>
      ))}
    </div>
  );
}

function summarizeQueuedBot(bot: PersistentBot): string {
  const traits = getTraitLabels(bot.traits ?? []).slice(0, 2).join(", ") || "No traits";
  const origin = bot.custom ? "Custom" : "Pool";
  return `${origin} / ${traits} / ${Math.round(bot.career.kills)} career kills`;
}

function NarrativeToasts({ moments }: { moments: NarrativeMoment[] }) {
  if (moments.length === 0) return null;

  return (
    <section className="narrative-toasts" aria-live="polite">
      {moments.slice(0, 3).map((moment) => (
        <article key={moment.id} className={`narrative-toast ${moment.severity}`}>
          <strong>{moment.title}</strong>
          {moment.description && <span>{moment.description}</span>}
        </article>
      ))}
    </section>
  );
}

function SelectedBotDetails({
  bot,
  activeTab,
  onTabChange,
}: {
  bot: Bot;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
}) {
  return (
    <aside className="selected-bot-details">
      <div className="overlay-tabs" role="tablist" aria-label={`${bot.name} details`}>
        <button type="button" className={activeTab === "loadout" ? "active" : ""} onClick={() => onTabChange("loadout")}>
          Loadout
        </button>
        <button type="button" className={activeTab === "skills" ? "active" : ""} onClick={() => onTabChange("skills")}>
          Skills
        </button>
      </div>
      {activeTab === "loadout" ? <LoadoutTab bot={bot} /> : <SkillsTab bot={bot} />}
    </aside>
  );
}

function LoadoutTab({ bot }: { bot: Bot }) {
  const weapon = bot.inventory.weapon;
  const armor = bot.inventory.armor;
  const tool = bot.inventory.tool;

  return (
    <div className="bot-detail-grid">
      <DetailRow label="Weapon" value={weapon?.name ?? "Unarmed"} meta={weapon ? `${weapon.damage} dmg / ${weapon.range} range` : "Needs a pickup"} />
      <DetailRow label="Armor" value={armor?.name ?? "None"} meta={armor ? describeEffects(armor.effects) : "No protection"} />
      <DetailRow label="Tool" value={tool?.name ?? "None"} meta={tool ? describeEffects(tool.effects) : "No utility item"} />
      <DetailRow label="Credits" value={`${bot.carriedCredits ?? 0}`} meta="Dropped on elimination" />
      <DetailRow label="Health" value={`${Math.round(bot.health)} hp`} meta={`${bot.kills} kills / ${Math.round(bot.damageDealt)} damage`} />
    </div>
  );
}

function SkillsTab({ bot }: { bot: Bot }) {
  const traits = getTraitLabels(bot.traits ?? []);
  return (
    <div className="bot-detail-grid">
      <div className="stat-bars">
        <StatBar label="Strength" value={bot.baseStats.strength} />
        <StatBar label="Speed" value={bot.baseStats.speed} />
        <StatBar label="Perception" value={bot.baseStats.perception} />
        <StatBar label="Endurance" value={bot.baseStats.endurance} />
      </div>
      <DetailRow label="Level" value={`${bot.level}`} meta={`${bot.xp} XP / ${formatTime(bot.survivalTimeMs)} survived`} />
      <DetailRow label="Traits" value={traits.join(", ") || "None"} meta={bot.personality} />
      <DetailRow label="Career" value={`${bot.career.wins}/${bot.career.matchesPlayed} wins`} meta={`${bot.career.kills} kills / ${Math.round(bot.career.damageDealt)} damage`} />
    </div>
  );
}

function DetailRow({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <article className="bot-detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </article>
  );
}

function StatBar({ label, value }: { label: string; value: number }) {
  const percent = Math.max(8, Math.min(100, (value / 14) * 100));
  return (
    <div className="stat-bar">
      <div>
        <span>{label}</span>
        <strong>{Math.round(value)}</strong>
      </div>
      <meter min={0} max={100} value={percent} aria-label={label} />
    </div>
  );
}

function describeEffects(effects: Record<string, number | undefined>): string {
  const entries = Object.entries(effects).filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] !== 0);
  if (entries.length === 0) {
    return "No modifiers";
  }
  return entries.map(([key, value]) => `${key} ${value > 0 ? "+" : ""}${Math.round(value * 100)}%`).join(" / ");
}
