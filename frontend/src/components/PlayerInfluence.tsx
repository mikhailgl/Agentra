import { useState } from "react";
import { DRAFT_COST, getBetTypeLabel, getOddsForBetType, MAX_DRAFTED_BOTS, MAX_NUDGES_PER_MATCH, MIN_BET_AMOUNT, NUDGE_COOLDOWN_MS } from "../game/player";
import type { Bet, BetType, Bot, InfluenceType, MatchInfluenceResults, Nudge, PersistentBot, PlayerState } from "../game/types";
import { getTraitLabels } from "../game/traits";

const BET_TYPES: BetType[] = ["winner", "top3", "mostKills", "firstEliminated"];
const NUDGE_TYPES: InfluenceType[] = ["aggression", "defense", "revenge", "reveal"];
const NUDGE_COSTS: Record<InfluenceType, number> = {
  aggression: 50,
  defense: 50,
  revenge: 75,
  reveal: 40,
};

export function PlayerBar({
  player,
  onToggleStable,
}: {
  player: PlayerState;
  onToggleStable: () => void;
}) {
  return (
    <div className="player-bar">
      <strong>{player.credits} credits</strong>
      <span>{player.draftedBotIds.length}/{MAX_DRAFTED_BOTS} stable</span>
      <button type="button" className="secondary-button" onClick={onToggleStable}>
        Stable
      </button>
    </div>
  );
}

export function BettingPanel({
  player,
  bots,
  matchId,
  introBeats,
  onPlaceBet,
  onStart,
}: {
  player: PlayerState;
  bots: Bot[];
  matchId: string;
  introBeats: string[];
  onPlaceBet: (type: BetType, botId: string, amount: number, odds: number) => void;
  onStart: () => void;
}) {
  const [type, setType] = useState<BetType>("winner");
  const [botId, setBotId] = useState(bots[0]?.id ?? "");
  const [amount, setAmount] = useState(MIN_BET_AMOUNT);
  const selectedBot = bots.find((bot) => bot.id === botId) ?? bots[0];
  const odds = selectedBot ? getOddsForBetType(selectedBot, bots, type) : 1.3;
  const pendingBets = player.bets.filter((bet) => bet.matchId === matchId && bet.status === "pending");
  const betAmount = Math.max(MIN_BET_AMOUNT, Math.min(player.credits, Math.floor(amount || 0)));

  return (
    <section className="story-intro betting-panel">
      <span>Player influence</span>
      <h2>Place bets before the arena locks</h2>
      {introBeats.length > 0 && (
        <div className="previously-card">
          <strong>Previously</strong>
          <ul>
            {introBeats.slice(0, 3).map((beat) => (
              <li key={beat}>{beat}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="credits-line">
        <strong>{player.credits} credits</strong>
        <small>Minimum bet {MIN_BET_AMOUNT}</small>
      </div>
      <div className="bet-form">
        <label>
          Bet
          <select value={type} onChange={(event) => setType(event.target.value as BetType)}>
            {BET_TYPES.map((betType) => (
              <option key={betType} value={betType}>
                {getBetTypeLabel(betType)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bot
          <select value={botId} onChange={(event) => setBotId(event.target.value)}>
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name} L{bot.level}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount
          <input type="number" min={MIN_BET_AMOUNT} max={player.credits} value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
        </label>
        <div className="potential-payout">
          <span>{odds.toFixed(2)}x odds</span>
          <strong>{Math.floor(betAmount * odds)} payout</strong>
        </div>
        <button type="button" disabled={!selectedBot || betAmount > player.credits || player.credits < MIN_BET_AMOUNT} onClick={() => selectedBot && onPlaceBet(type, selectedBot.id, betAmount, odds)}>
          Place Bet
        </button>
      </div>
      <div className="arena-bot-grid">
        {bots.map((bot) => (
          <CompactBotCard key={bot.id} bot={bot} drafted={player.draftedBotIds.includes(bot.id)} odds={getOddsForBetType(bot, bots, type)} />
        ))}
      </div>
      <BetList bets={pendingBets} bots={bots} empty="No bets placed yet." />
      <button type="button" onClick={onStart}>
        Start Match
      </button>
    </section>
  );
}

export function InfluencePanel({
  player,
  bots,
  matchId,
  elapsedMs,
  lastNudgeAt,
  onNudge,
}: {
  player: PlayerState;
  bots: Bot[];
  matchId: string;
  elapsedMs: number;
  lastNudgeAt: number | null;
  onNudge: (type: InfluenceType, targetBotId: string, secondaryBotId?: string) => void;
}) {
  const aliveBots = bots.filter((bot) => bot.alive);
  const [type, setType] = useState<InfluenceType>("aggression");
  const [targetBotId, setTargetBotId] = useState(aliveBots[0]?.id ?? "");
  const [secondaryBotId, setSecondaryBotId] = useState("");
  const usedThisMatch = player.nudgeHistory.filter((nudge) => nudge.matchId === matchId).length;
  const cooldownLeft = lastNudgeAt === null ? 0 : Math.max(0, NUDGE_COOLDOWN_MS - (elapsedMs - lastNudgeAt));
  const cost = NUDGE_COSTS[type];
  const disabledReason =
    usedThisMatch >= MAX_NUDGES_PER_MATCH
      ? "Limit reached"
      : cooldownLeft > 0
        ? `${Math.ceil(cooldownLeft / 1000)}s cooldown`
        : player.credits < cost
          ? "Not enough credits"
          : !targetBotId
            ? "No living target"
            : type === "revenge" && !secondaryBotId
              ? "Pick enemy"
              : "";

  return (
    <section className="influence-panel">
      <div className="panel-title-row">
        <h2>Nudges</h2>
        <span>{usedThisMatch}/{MAX_NUDGES_PER_MATCH}</span>
      </div>
      <div className="nudge-controls">
        <select value={type} onChange={(event) => setType(event.target.value as InfluenceType)}>
          {NUDGE_TYPES.map((nudgeType) => (
            <option key={nudgeType} value={nudgeType}>
              {nudgeType} ({NUDGE_COSTS[nudgeType]})
            </option>
          ))}
        </select>
        <select value={targetBotId} onChange={(event) => setTargetBotId(event.target.value)}>
          <option value="">Target</option>
          {aliveBots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>
        {type === "revenge" && (
          <select value={secondaryBotId} onChange={(event) => setSecondaryBotId(event.target.value)}>
            <option value="">Enemy</option>
            {aliveBots
              .filter((bot) => bot.id !== targetBotId)
              .map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name}
                </option>
              ))}
          </select>
        )}
        <button type="button" disabled={Boolean(disabledReason)} title={disabledReason} onClick={() => onNudge(type, targetBotId, secondaryBotId || undefined)}>
          Use
        </button>
      </div>
      {disabledReason && <small>{disabledReason}</small>}
    </section>
  );
}

export function BetsOverlay({ bets, bots, matchId }: { bets: Bet[]; bots: Bot[]; matchId: string }) {
  const pending = bets.filter((bet) => bet.matchId === matchId && bet.status === "pending");
  if (pending.length === 0) {
    return null;
  }
  return (
    <section className="bets-overlay">
      <h2>Your Bets</h2>
      <BetList bets={pending} bots={bots} empty="" live />
    </section>
  );
}

export function StablePanel({
  player,
  bots,
  pool,
  onClose,
  onUndraft,
}: {
  player: PlayerState;
  bots: Bot[];
  pool: PersistentBot[];
  onClose: () => void;
  onUndraft: (botId: string) => void;
}) {
  const stableBots = player.draftedBotIds
    .map((botId) => bots.find((bot) => bot.id === botId) ?? pool.find((bot) => bot.id === botId))
    .filter(Boolean) as Array<Bot | PersistentBot>;

  return (
    <div className="modal-backdrop">
      <section className="profile-modal stable-modal">
        <div className="modal-title-row">
          <div>
            <span>Your Stable</span>
            <h2>{player.credits} credits</h2>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="stable-slots">
          {Array.from({ length: MAX_DRAFTED_BOTS }, (_, index) => {
            const bot = stableBots[index];
            return bot ? (
              <div key={bot.id} className="stable-card drafted-card">
                <BotSummary bot={bot} />
                <button type="button" className="secondary-button" onClick={() => onUndraft(bot.id)}>
                  Remove
                </button>
              </div>
            ) : (
              <div key={`empty-${index}`} className="stable-card empty-slot">
                Empty slot
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function PostMatchInfluencePanel({
  player,
  bots,
  pool,
  results,
  onDraft,
  onRestart,
}: {
  player: PlayerState;
  bots: Bot[];
  pool: PersistentBot[];
  results: MatchInfluenceResults | null;
  onDraft: (botId: string) => void;
  onRestart: () => void;
}) {
  const draftableBots = pool.filter((bot) => !player.draftedBotIds.includes(bot.id)).slice(0, 12);
  const stablePerformance = bots.filter((bot) => player.draftedBotIds.includes(bot.id));
  const net = results ? results.endingCredits - results.startingCredits : 0;

  return (
    <section className="post-influence-panel">
      <div className="summary-heading">
        <span>Influence results</span>
        <strong>{player.credits} credits</strong>
        <small>{net >= 0 ? "+" : ""}{net} this match</small>
      </div>
      <h2>Bets</h2>
      {results?.betResults.length ? (
        <div className="result-list">
          {results.betResults.map(({ bet, botName, net: betNet }) => (
            <div key={bet.id} className={bet.status === "won" ? "result-row won" : "result-row lost"}>
              <span>{getBetTypeLabel(bet.type)}: {botName}</span>
              <strong>{bet.status === "won" ? `+${bet.payout}` : `-${bet.amount}`}</strong>
              <small>{betNet >= 0 ? "+" : ""}{betNet} net</small>
            </div>
          ))}
        </div>
      ) : (
        <p>No bets were placed.</p>
      )}
      <h2>Nudges</h2>
      {results?.nudges.length ? (
        <div className="result-list">
          {results.nudges.map((nudge) => (
            <div key={nudge.id} className={nudge.success ? "result-row won" : "result-row lost"}>
              <span>{nudge.type} on {bots.find((bot) => bot.id === nudge.targetBotId)?.name ?? "bot"}</span>
              <strong>{nudge.success ? "Worked" : "Ignored"}</strong>
              <small>-{nudge.cost}</small>
            </div>
          ))}
        </div>
      ) : (
        <p>No nudges used.</p>
      )}
      {stablePerformance.length > 0 && (
        <>
          <h2>Stable performance</h2>
          <div className="result-list">
            {stablePerformance.map((bot) => (
              <div key={bot.id} className="result-row drafted-card">
                <span>{bot.name}</span>
                <strong>{bot.kills} K / {bot.damageDealt} dmg</strong>
              </div>
            ))}
          </div>
        </>
      )}
      <h2>Draft opportunities</h2>
      <div className="draft-grid">
        {draftableBots.map((bot) => {
          const disabledReason = player.draftedBotIds.length >= MAX_DRAFTED_BOTS ? "Stable full" : player.credits < DRAFT_COST ? "Need credits" : "";
          return (
            <div key={bot.id} className="draft-card">
              <BotSummary bot={bot} />
              <button type="button" disabled={Boolean(disabledReason)} title={disabledReason} onClick={() => onDraft(bot.id)}>
                Draft {DRAFT_COST}
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={onRestart}>
        Next Match
      </button>
    </section>
  );
}

function BetList({ bets, bots, empty, live = false }: { bets: Bet[]; bots: Bot[]; empty: string; live?: boolean }) {
  if (bets.length === 0) {
    return empty ? <p>{empty}</p> : null;
  }
  return (
    <div className="bet-list">
      {bets.map((bet) => {
        const bot = bots.find((candidate) => candidate.id === bet.botId);
        return (
          <div key={bet.id} className="bet-row">
            <span>{getBetTypeLabel(bet.type)}: {bot?.name ?? "Unknown"}</span>
            <strong>{bet.amount} @ {bet.odds.toFixed(2)}x</strong>
            {live && <small>{bot?.alive ? `${bot.kills} K alive` : "eliminated"}</small>}
          </div>
        );
      })}
    </div>
  );
}

function CompactBotCard({ bot, drafted, odds }: { bot: Bot; drafted: boolean; odds: number }) {
  return (
    <div className={`arena-bot-card ${drafted ? "drafted-card" : ""}`}>
      <strong>{bot.name}</strong>
      <span>L{bot.level} / {bot.career.wins}-{Math.max(0, bot.career.matchesPlayed - bot.career.wins)}</span>
      <small>{getTraitLabels(bot.traits).join(", ") || "No traits"}</small>
      <em>{odds.toFixed(2)}x</em>
    </div>
  );
}

function BotSummary({ bot }: { bot: Bot | PersistentBot }) {
  return (
    <div className="bot-summary">
      <strong>{bot.name}</strong>
      <span>L{bot.level} / {bot.career.wins}W / {bot.career.kills}K</span>
      <small>{getTraitLabels(bot.traits).join(", ") || "No traits"}</small>
      {bot.recentResults?.[0] && <small>{bot.recentResults[0]}</small>}
    </div>
  );
}
