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
  onOpenVideos,
  onOpenLeague,
  onOpenFantasy,
  onCreateBot,
  onEnterBot,
  onUpdateDoctrine,
  onUpdateAccountName,
  onRecoverAccount,
  onRotateRecoveryCode,
  onIssueCreatorApiKey,
  newRecoveryCode,
  newCreatorApiKey,
  mutationPending,
  actionError,
}: {
  bots: PersistentBot[];
  player: PlayerState;
  queuedBotIds: string[];
  activeBotIds: string[];
  onBackToArena: () => void;
  onOpenVideos: () => void;
  onOpenLeague: () => void;
  onOpenFantasy: () => void;
  onCreateBot: (build: CustomBotBuild, enterContest: boolean) => Promise<boolean>;
  onEnterBot: (botId: string) => void;
  onUpdateDoctrine: (botId: string, instruction: string) => void;
  onUpdateAccountName: (name: string) => Promise<boolean>;
  onRecoverAccount: (recoveryCode: string) => Promise<boolean>;
  onRotateRecoveryCode: () => Promise<string | null>;
  onIssueCreatorApiKey: () => Promise<string | null>;
  newRecoveryCode: string | null;
  newCreatorApiKey: string | null;
  mutationPending: boolean;
  actionError: string | null;
}) {
  const ownedBotIds = useMemo(() => new Set(player.ownedBotIds), [player.ownedBotIds]);
  const ownedBots = useMemo(() => bots.filter((bot) => bot.custom && ownedBotIds.has(bot.id)), [bots, ownedBotIds]);
  const publicBots = useMemo(() => bots.filter((bot) => !ownedBotIds.has(bot.id)).slice(0, 12), [bots, ownedBotIds]);
  const [selectedBotId, setSelectedBotId] = useState(() => ownedBots[0]?.id ?? bots[0]?.id ?? "");
  const [tab, setTab] = useState<LudusTab>("profile");
  const [showCreator, setShowCreator] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
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
          <div className="credit-tile" title="Server-authoritative virtual credits">
            <span>{player.accountName}</span>
            <strong>{player.credits.toLocaleString()}</strong>
            <small>virtual credits</small>
          </div>
          <button type="button" className="secondary-button" onClick={() => setShowAccount(true)}>
            {newRecoveryCode ? "Save account key" : "Account"}
          </button>
          <button type="button" className="secondary-button" onClick={onBackToArena}>
            Arena
          </button>
          <button type="button" className="secondary-button" onClick={onOpenVideos}>
            Videos
          </button>
          <button type="button" className="secondary-button" onClick={onOpenLeague}>
            League
          </button>
          <button type="button" className="secondary-button" onClick={onOpenFantasy}>
            Fantasy
          </button>
          <button type="button" onClick={() => setShowCreator(true)} disabled={mutationPending}>
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
              isOwned={ownedBotIds.has(selectedBot.id)}
              canEnter={ownedBotIds.has(selectedBot.id) && !queuedBotIds.includes(selectedBot.id) && !activeBotIds.includes(selectedBot.id)}
              isQueued={queuedBotIds.includes(selectedBot.id)}
              isActive={activeBotIds.includes(selectedBot.id)}
              canAfford={player.credits >= BOT_CONTEST_ENTRY_FEE}
              onEnter={() => onEnterBot(selectedBot.id)}
              pending={mutationPending}
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
            {tab === "doctrine" && <DoctrineTab bot={selectedBot} canCoach={ownedBotIds.has(selectedBot.id)} onUpdateDoctrine={onUpdateDoctrine} pending={mutationPending} />}
          </section>
        ) : (
          <section className="ludus-profile empty-ludus">
            <h2>No fighters yet</h2>
            <p>Create a custom fighter to start managing your ludus.</p>
            <button type="button" onClick={() => setShowCreator(true)} disabled={mutationPending}>
              Create fighter
            </button>
          </section>
        )}
      </section>

      {actionError && <p className="ludus-action-error" role="alert">{actionError}</p>}

      {showCreator && (
        <CustomBotCreator
          credits={player.credits}
          creationCost={CUSTOM_BOT_CREATION_COST}
          pending={mutationPending}
          onClose={() => setShowCreator(false)}
          onCreate={(build, enterContest) => {
            void onCreateBot(build, enterContest).then((created) => {
              if (created) setShowCreator(false);
            });
          }}
        />
      )}
      {showAccount && (
        <AccountPanel
          player={player}
          recoveryCode={newRecoveryCode}
          onClose={() => setShowAccount(false)}
          onUpdateName={onUpdateAccountName}
          onRecover={onRecoverAccount}
          onRotateRecoveryCode={onRotateRecoveryCode}
          onIssueCreatorApiKey={onIssueCreatorApiKey}
          creatorApiKey={newCreatorApiKey}
        />
      )}
    </main>
  );
}

function AccountPanel({
  player,
  recoveryCode,
  onClose,
  onUpdateName,
  onRecover,
  onRotateRecoveryCode,
  onIssueCreatorApiKey,
  creatorApiKey,
}: {
  player: PlayerState;
  recoveryCode: string | null;
  onClose: () => void;
  onUpdateName: (name: string) => Promise<boolean>;
  onRecover: (recoveryCode: string) => Promise<boolean>;
  onRotateRecoveryCode: () => Promise<string | null>;
  onIssueCreatorApiKey: () => Promise<string | null>;
  creatorApiKey: string | null;
}) {
  const [name, setName] = useState(player.accountName);
  const [recoveryDraft, setRecoveryDraft] = useState("");
  const [visibleRecoveryCode, setVisibleRecoveryCode] = useState(recoveryCode);
  const [visibleCreatorApiKey, setVisibleCreatorApiKey] = useState(creatorApiKey);
  const [pending, setPending] = useState(false);

  const saveName = async () => {
    setPending(true);
    const saved = await onUpdateName(name);
    setPending(false);
    if (saved) setName(name.trim());
  };

  const recover = async () => {
    setPending(true);
    const recovered = await onRecover(recoveryDraft);
    setPending(false);
    if (recovered) onClose();
  };

  const rotateKey = async () => {
    setPending(true);
    setVisibleRecoveryCode(await onRotateRecoveryCode());
    setPending(false);
  };

  const issueCreatorKey = async () => {
    setPending(true);
    setVisibleCreatorApiKey(await onIssueCreatorApiKey());
    setPending(false);
  };

  return (
    <div className="modal-backdrop account-backdrop" role="presentation">
      <section className="account-panel" role="dialog" aria-modal="true" aria-labelledby="account-title">
        <header className="modal-title-row">
          <div><span>Player identity</span><h2 id="account-title">Your arena account</h2></div>
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        </header>

        <div className="account-section">
          <span>Creator API</span>
          <p>Submit versioned declarative strategies through the constrained SDK. Submitted code never runs inside the arena.</p>
          {visibleCreatorApiKey && (
            <>
              <code>{visibleCreatorApiKey}</code>
              <strong>Copy this key now. Creating another key immediately revokes it.</strong>
            </>
          )}
          <button type="button" className="secondary-button" onClick={() => void issueCreatorKey()} disabled={pending}>
            {visibleCreatorApiKey ? "Rotate creator key" : "Create creator key"}
          </button>
          <small>Use it as a Bearer token with `/api/agent/v1`. Never put it in browser code or a public repository.</small>
        </div>

        <div className="account-section">
          <label htmlFor="arena-name">Public arena name</label>
          <div className="account-field-row">
            <input id="arena-name" value={name} maxLength={24} onChange={(event) => setName(event.target.value)} disabled={pending} />
            <button type="button" onClick={() => void saveName()} disabled={pending || name.trim() === player.accountName}>Save name</button>
          </div>
          <small>This name appears on your fighters, league entries, and generated stories.</small>
        </div>

        <div className="account-section recovery-section">
          <span>Recovery key</span>
          {visibleRecoveryCode ? (
            <>
              <code>{visibleRecoveryCode}</code>
              <strong>Save this key now. It is only shown once and restores your account on another browser.</strong>
            </>
          ) : (
            <p>Create a fresh recovery key if the original was not saved. Creating one invalidates the previous key.</p>
          )}
          <button type="button" className="secondary-button" onClick={() => void rotateKey()} disabled={pending}>
            {visibleRecoveryCode ? "Replace recovery key" : "Create new recovery key"}
          </button>
        </div>

        <div className="account-section">
          <label htmlFor="recovery-key">Restore an existing account</label>
          <div className="account-field-row">
            <input id="recovery-key" value={recoveryDraft} onChange={(event) => setRecoveryDraft(event.target.value)} placeholder="xxxxxx-xxxxxx-xxxxxx-xxxxxx-xxxxxx-xxxxxx" disabled={pending} />
            <button type="button" onClick={() => void recover()} disabled={pending || recoveryDraft.trim().length < 36}>Restore</button>
          </div>
          <small>Restoring rotates that account's browser session and signs this browser into it.</small>
        </div>
      </section>
    </div>
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
  isOwned,
  canEnter,
  isQueued,
  isActive,
  canAfford,
  pending,
  onEnter,
}: {
  bot: PersistentBot;
  isOwned: boolean;
  canEnter: boolean;
  isQueued: boolean;
  isActive: boolean;
  canAfford: boolean;
  pending: boolean;
  onEnter: () => void;
}) {
  return (
    <header className="bot-profile-hero">
      <div className="bot-sigil" aria-hidden="true">
        {bot.name.slice(0, 1).toUpperCase()}
      </div>
      <div>
        <span>{isOwned ? "Your fighter" : bot.ownerName ? `Fighter by ${bot.ownerName}` : "Arena fighter"}</span>
        <h2>{bot.name}</h2>
        <p>{bot.doctrineSummary ?? "Autonomous instincts"}</p>
      </div>
      <button
        type="button"
        disabled={pending || !canEnter || !canAfford}
        title={isActive ? "Already fighting" : isQueued ? "Already queued" : canAfford ? "" : `Need ${BOT_CONTEST_ENTRY_FEE} credits`}
        onClick={onEnter}
      >
        {pending ? "Saving..." : isActive ? "In Arena" : isQueued ? "Queued" : `Enter (${BOT_CONTEST_ENTRY_FEE})`}
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

function DoctrineTab({ bot, canCoach, onUpdateDoctrine, pending }: { bot: PersistentBot; canCoach: boolean; onUpdateDoctrine: (botId: string, instruction: string) => void; pending: boolean }) {
  const [draft, setDraft] = useState(bot.tacticalInstruction ?? "");
  const disabled = !canCoach;
  return (
    <section className="ludus-card doctrine-card">
      <h3>Private Doctrine</h3>
      <p>Only your custom fighters can be coached. Instructions influence future behavior, but fighters remain autonomous.</p>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={180} disabled={disabled} placeholder="Ambush wounded enemies, avoid open-field fights, prioritize credits when safe." />
      <div className="doctrine-summary">
        <span>Current read</span>
        <strong>{bot.doctrineSummary ?? "Autonomous instincts"}</strong>
      </div>
      {bot.agentStrategy && (
        <div className="agent-strategy-card">
          <span>External strategy · v{bot.agentStrategy.version}</span>
          <strong>{bot.agentStrategy.name}</strong>
          <p>{bot.agentStrategy.description}</p>
          <small>by {bot.agentStrategy.authorName} · {bot.agentStrategy.runtime} · targets {bot.agentStrategy.policy.targetPriority}</small>
          <div>{Object.entries(bot.agentStrategy.policy).filter((entry): entry is [string, number] => typeof entry[1] === "number").map(([key, value]) => <span key={key}>{key} {Math.round(value * 100)}</span>)}</div>
        </div>
      )}
      <button type="button" disabled={pending || disabled || draft.trim() === (bot.tacticalInstruction ?? "")} onClick={() => onUpdateDoctrine(bot.id, draft)}>
        {pending ? "Saving..." : "Save doctrine"}
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
          <span>{key.replace(/([A-Z])/g, " $1")}</span>
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
