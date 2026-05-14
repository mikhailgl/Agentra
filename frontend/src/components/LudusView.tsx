import { useMemo, useState } from "react";
import { formatTime } from "../format";
import { BOT_CONTEST_ENTRY_FEE, CUSTOM_BOT_CREATION_COST } from "../game/player";
import { getTraitLabels } from "../game/traits";
import type { BotAffinities, PersistentBot, PlayerState, Psychology } from "../game/types";
import { CustomBotCreator } from "./CustomBotCreator";

type LudusTab = "profile" | "journal" | "doctrine";
type CustomBotBuild = {
  name: string;
  baseStats: {
    strength: number;
    speed: number;
    perception: number;
    endurance: number;
  };
  psychology: Psychology;
  traits: string[];
  affinities: BotAffinities;
  tacticalInstruction: string;
};

export function LudusView({
  bots,
  player,
  queuedBotIds,
  activeBotIds,
  onBackToArena,
  onCreateBot,
  onEnterBot,
  onAddCredits,
  onUpdateDoctrine,
}: {
  bots: PersistentBot[];
  player: PlayerState;
  queuedBotIds: string[];
  activeBotIds: string[];
  onBackToArena: () => void;
  onCreateBot: (build: CustomBotBuild, enterContest: boolean) => void;
  onEnterBot: (botId: string) => void;
  onAddCredits: () => void;
  onUpdateDoctrine: (botId: string, instruction: string) => void;
}) {
  const ownedBots = useMemo(() => bots.filter((bot) => bot.custom), [bots]);
  const publicBots = useMemo(() => bots.filter((bot) => !bot.custom).slice(0, 8), [bots]);
  const [selectedBotId, setSelectedBotId] = useState(() => ownedBots[0]?.id ?? bots[0]?.id ?? "");
  const [tab, setTab] = useState<LudusTab>("profile");
  const [showCreator, setShowCreator] = useState(false);
  const selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? ownedBots[0] ?? bots[0] ?? null;

  return (
    <main className="ludus-shell">
      <header className="ludus-hero">
        <div>
          <span>Your Ludus</span>
          <h1>Train fighters. Enter the arena. Build legends.</h1>
          <p>Private doctrine changes how your custom fighters behave across future matches.</p>
        </div>
        <div className="ludus-hero-actions">
          <button type="button" className="credit-tile" onClick={onAddCredits} title="Add 1,000 credits">
            <span>Credits</span>
            <strong>{player.credits.toLocaleString()}</strong>
          </button>
          <button type="button" className="secondary-button" onClick={onBackToArena}>
            Arena
          </button>
          <button type="button" onClick={() => setShowCreator(true)}>
            Create fighter
          </button>
        </div>
      </header>

      <section className="ludus-layout">
        <aside className="ludus-roster">
          <RosterSection
            title="My Fighters"
            emptyText="Create your first gladiator to start building a stable."
            bots={ownedBots}
            selectedBotId={selectedBot?.id ?? ""}
            queuedBotIds={queuedBotIds}
            activeBotIds={activeBotIds}
            onSelect={(botId) => {
              setSelectedBotId(botId);
              setTab("profile");
            }}
          />
          <RosterSection
            title="Public Pool"
            emptyText="No public fighters loaded."
            bots={publicBots}
            selectedBotId={selectedBot?.id ?? ""}
            queuedBotIds={queuedBotIds}
            activeBotIds={activeBotIds}
            onSelect={(botId) => {
              setSelectedBotId(botId);
              setTab("profile");
            }}
          />
        </aside>

        {selectedBot ? (
          <section className="ludus-profile">
            <BotProfileHeader
              bot={selectedBot}
              canEnter={Boolean(selectedBot.custom) && !queuedBotIds.includes(selectedBot.id) && !activeBotIds.includes(selectedBot.id)}
              isQueued={queuedBotIds.includes(selectedBot.id)}
              isActive={activeBotIds.includes(selectedBot.id)}
              canAfford={player.credits >= BOT_CONTEST_ENTRY_FEE}
              onEnter={() => onEnterBot(selectedBot.id)}
            />
            <nav className="ludus-tabs" aria-label="Bot profile sections">
              {(["profile", "journal", "doctrine"] as const).map((entry) => (
                <button key={entry} type="button" className={tab === entry ? "active" : "secondary-button"} onClick={() => setTab(entry)}>
                  {entry}
                </button>
              ))}
            </nav>
            {tab === "profile" && <ProfileTab bot={selectedBot} />}
            {tab === "journal" && <JournalTab bot={selectedBot} />}
            {tab === "doctrine" && <DoctrineTab bot={selectedBot} onUpdateDoctrine={onUpdateDoctrine} />}
          </section>
        ) : (
          <section className="ludus-profile empty-ludus">
            <h2>No fighters yet</h2>
            <p>Create a custom fighter to start managing your ludus.</p>
            <button type="button" onClick={() => setShowCreator(true)}>
              Create fighter
            </button>
          </section>
        )}
      </section>

      {showCreator && (
        <CustomBotCreator
          credits={player.credits}
          creationCost={CUSTOM_BOT_CREATION_COST}
          onClose={() => setShowCreator(false)}
          onCreate={(build, enterContest) => {
            onCreateBot(build, enterContest);
            setShowCreator(false);
          }}
        />
      )}
    </main>
  );
}

function RosterSection({
  title,
  emptyText,
  bots,
  selectedBotId,
  queuedBotIds,
  activeBotIds,
  onSelect,
}: {
  title: string;
  emptyText: string;
  bots: PersistentBot[];
  selectedBotId: string;
  queuedBotIds: string[];
  activeBotIds: string[];
  onSelect: (botId: string) => void;
}) {
  return (
    <section className="roster-section">
      <div className="roster-heading">
        <h2>{title}</h2>
        <span>{bots.length}</span>
      </div>
      {bots.length === 0 ? (
        <p className="empty-panel-note">{emptyText}</p>
      ) : (
        <div className="ludus-roster-list">
          {bots.map((bot) => (
            <button key={bot.id} type="button" className={`ludus-roster-card ${selectedBotId === bot.id ? "selected" : ""}`} onClick={() => onSelect(bot.id)}>
              <strong>{bot.name}</strong>
              <span>Lv {bot.level} / {bot.career.wins}-{Math.max(0, bot.career.matchesPlayed - bot.career.wins)}</span>
              <small>{activeBotIds.includes(bot.id) ? "In arena" : queuedBotIds.includes(bot.id) ? "Queued" : bot.doctrineSummary ?? "Autonomous instincts"}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function BotProfileHeader({
  bot,
  canEnter,
  isQueued,
  isActive,
  canAfford,
  onEnter,
}: {
  bot: PersistentBot;
  canEnter: boolean;
  isQueued: boolean;
  isActive: boolean;
  canAfford: boolean;
  onEnter: () => void;
}) {
  return (
    <header className="bot-profile-hero">
      <div className="bot-sigil" aria-hidden="true">
        {bot.name.slice(0, 1).toUpperCase()}
      </div>
      <div>
        <span>{bot.custom ? "Owned fighter" : "Public fighter"}</span>
        <h2>{bot.name}</h2>
        <p>{bot.doctrineSummary ?? "Autonomous instincts"}</p>
      </div>
      <button
        type="button"
        disabled={!canEnter || !canAfford}
        title={isActive ? "Already fighting" : isQueued ? "Already queued" : canAfford ? "" : `Need ${BOT_CONTEST_ENTRY_FEE} credits`}
        onClick={onEnter}
      >
        {isActive ? "In Arena" : isQueued ? "Queued" : `Enter (${BOT_CONTEST_ENTRY_FEE})`}
      </button>
    </header>
  );
}

function ProfileTab({ bot }: { bot: PersistentBot }) {
  return (
    <div className="ludus-grid">
      <section className="ludus-card">
        <h3>Career</h3>
        <div className="career-metrics">
          <Metric label="Level" value={`${bot.level}`} />
          <Metric label="Wins" value={`${bot.career.wins}`} />
          <Metric label="Matches" value={`${bot.career.matchesPlayed}`} />
          <Metric label="Kills" value={`${bot.career.kills}`} />
          <Metric label="Damage" value={`${Math.round(bot.career.damageDealt)}`} />
          <Metric label="Best survival" value={formatTime(bot.career.longestSurvivalTime)} />
        </div>
      </section>
      <section className="ludus-card">
        <h3>Stats</h3>
        <StatLine label="Strength" value={bot.baseStats.strength} />
        <StatLine label="Speed" value={bot.baseStats.speed} />
        <StatLine label="Perception" value={bot.baseStats.perception} />
        <StatLine label="Endurance" value={bot.baseStats.endurance} />
      </section>
      <section className="ludus-card">
        <h3>Personality</h3>
        <PsychologyGrid psychology={bot.psychology} />
      </section>
      <section className="ludus-card">
        <h3>Traits and Preferences</h3>
        <p>{getTraitLabels(bot.traits ?? []).join(", ") || "No traits yet"}</p>
        <PreferenceList affinities={bot.affinities} />
      </section>
    </div>
  );
}

function JournalTab({ bot }: { bot: PersistentBot }) {
  const entries = bot.journal ?? [];
  return (
    <section className="ludus-card journal-card">
      <h3>{bot.name}'s Journal</h3>
      {entries.length === 0 ? (
        <p className="empty-panel-note">No journal entries yet.</p>
      ) : (
        entries.map((entry) => (
          <article key={entry.id} className={`journal-entry ${entry.tone}`}>
            <div>
              <strong>{entry.title}</strong>
              <time>{new Date(entry.timestamp).toLocaleDateString()}</time>
            </div>
            <p>{entry.body}</p>
          </article>
        ))
      )}
    </section>
  );
}

function DoctrineTab({ bot, onUpdateDoctrine }: { bot: PersistentBot; onUpdateDoctrine: (botId: string, instruction: string) => void }) {
  const [draft, setDraft] = useState(bot.tacticalInstruction ?? "");
  const disabled = !bot.custom;
  return (
    <section className="ludus-card doctrine-card">
      <h3>Private Doctrine</h3>
      <p>Only your custom fighters can be coached. Instructions influence future behavior, but fighters remain autonomous.</p>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={180} disabled={disabled} placeholder="Ambush wounded enemies, avoid open-field fights, prioritize credits when safe." />
      <div className="doctrine-summary">
        <span>Current read</span>
        <strong>{bot.doctrineSummary ?? "Autonomous instincts"}</strong>
      </div>
      <button type="button" disabled={disabled || draft.trim() === (bot.tacticalInstruction ?? "")} onClick={() => onUpdateDoctrine(bot.id, draft)}>
        Save doctrine
      </button>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="career-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="ludus-stat-line">
      <div>
        <span>{label}</span>
        <strong>{Math.round(value)}</strong>
      </div>
      <meter min={0} max={16} value={Math.max(1, Math.min(16, value))} />
    </div>
  );
}

function PsychologyGrid({ psychology }: { psychology: Psychology }) {
  return (
    <div className="psychology-grid">
      {Object.entries(psychology).map(([key, value]) => (
        <div key={key}>
          <span>{key}</span>
          <strong>{Math.round(value * 100)}</strong>
        </div>
      ))}
    </div>
  );
}

function PreferenceList({ affinities }: { affinities: BotAffinities }) {
  const topWeapons = Object.entries(affinities.weapons).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const topBiomes = Object.entries(affinities.biomes).sort((a, b) => (b[1] ?? 1) - (a[1] ?? 1)).slice(0, 3);
  return (
    <div className="preference-list">
      <span>Weapons: {topWeapons.map(([name]) => name).join(", ")}</span>
      <span>Biomes: {topBiomes.map(([name]) => name.replace("_", " ")).join(", ")}</span>
      <span>Range: close {affinities.combatRanges.close.toFixed(2)} / mid {affinities.combatRanges.mid.toFixed(2)} / long {affinities.combatRanges.long.toFixed(2)}</span>
    </div>
  );
}
