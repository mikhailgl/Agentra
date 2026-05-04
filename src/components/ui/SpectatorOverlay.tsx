import { useState } from "react";
import { formatTime } from "../../format";
import type { ArenaState, BasicMatchResult, Bot } from "../../game/types";
import { getTraitLabels } from "../../game/traits";

type DetailTab = "loadout" | "skills";

export function SpectatorOverlay({
  arenaState,
  bots,
  selectedBot,
  results,
  onSelectBot,
  onTogglePause,
  onFollowSelected,
  onResetCamera,
  onStartNextNow,
}: {
  arenaState: ArenaState;
  bots: Bot[];
  selectedBot: Bot | null;
  results: BasicMatchResult[];
  onSelectBot: (botId: string) => void;
  onTogglePause: () => void;
  onFollowSelected: () => void;
  onResetCamera: () => void;
  onStartNextNow: () => void;
}) {
  const [detailTab, setDetailTab] = useState<DetailTab>("loadout");
  const aliveCount = bots.filter((bot) => bot.alive).length;
  const winner = arenaState.lastWinnerId ? bots.find((bot) => bot.id === arenaState.lastWinnerId) ?? null : null;
  const countdownSeconds = arenaState.intermissionEndsAt
    ? Math.max(0, Math.ceil((arenaState.intermissionEndsAt - Date.now()) / 1000))
    : 0;

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
          <span>Phase</span>
          <strong>{arenaState.phase}</strong>
        </div>
        <button type="button" className="secondary-button" onClick={onTogglePause}>
          {arenaState.phase === "paused" ? "Resume" : "Pause"}
        </button>
      </section>

      <aside className="current-bot-list">
        <div className="overlay-heading">
          <h2>Current Match</h2>
          <span>{formatTime(Math.max(...bots.map((bot) => bot.survivalTimeMs), 0))}</span>
        </div>
        <div className="bot-list-scroll">
          {bots.map((bot) => (
            <button
              key={bot.id}
              type="button"
              className={`bot-list-row ${selectedBot?.id === bot.id ? "selected" : ""} ${bot.alive ? "" : "dead"}`}
              onClick={() => onSelectBot(bot.id)}
            >
              <span className="bot-list-name">{bot.name}</span>
              <span>{Math.round(bot.health)} hp</span>
              <span>{bot.alive ? "Alive" : "Dead"}</span>
              <span>{bot.kills} K</span>
            </button>
          ))}
        </div>
        {results.length > 0 && (
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

      <section className="selected-bot-overlay">
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
            <button type="button" className="secondary-button" onClick={onFollowSelected}>
              Follow selected bot
            </button>
            <button type="button" className="secondary-button" onClick={onResetCamera}>
              Reset camera
            </button>
          </>
        ) : (
          <>
            <div>
              <span>Selected Bot</span>
              <strong>None</strong>
            </div>
            <button type="button" className="secondary-button" onClick={onResetCamera}>
              Reset camera
            </button>
          </>
        )}
      </section>

      {selectedBot && <SelectedBotDetails bot={selectedBot} activeTab={detailTab} onTabChange={setDetailTab} />}

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
