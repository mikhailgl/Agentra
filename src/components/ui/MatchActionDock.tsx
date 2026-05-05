import { useEffect, useMemo, useState } from "react";
import { getBetTypeLabel, getOddsForBetType, MIN_BET_AMOUNT } from "../../game/player";
import type { SponsorDropKind } from "../../game/simulation";
import type { BetType, Bot, PlayerState } from "../../game/types";

const BET_TYPES: BetType[] = ["winner", "top3", "mostKills", "firstEliminated"];
const SPONSOR_DROPS: SponsorDropKind[] = ["Knife", "Spear", "Bow", "Medkit"];

export function MatchActionDock({
  player,
  bots,
  matchId,
  selectedBot,
  onPlaceBet,
  onSponsorDrop,
  onCreateBot,
}: {
  player: PlayerState;
  bots: Bot[];
  matchId: string;
  selectedBot: Bot | null;
  onPlaceBet: (type: BetType, botId: string, amount: number, odds: number) => void;
  onSponsorDrop: (botId: string, kind: SponsorDropKind) => void;
  onCreateBot: () => void;
}) {
  const aliveBots = useMemo(() => bots.filter((bot) => bot.alive), [bots]);
  const [betType, setBetType] = useState<BetType>("winner");
  const [betBotId, setBetBotId] = useState(selectedBot?.id ?? aliveBots[0]?.id ?? bots[0]?.id ?? "");
  const [sponsorBotId, setSponsorBotId] = useState(selectedBot?.alive ? selectedBot.id : aliveBots[0]?.id ?? "");
  const [amount, setAmount] = useState(MIN_BET_AMOUNT);
  const betBot = bots.find((bot) => bot.id === betBotId) ?? aliveBots[0] ?? bots[0];
  const odds = betBot ? getOddsForBetType(betBot, bots, betType) : 1.3;
  const betAmount = Math.max(MIN_BET_AMOUNT, Math.min(player.credits, Math.floor(amount || 0)));
  const potentialPayout = Math.floor(betAmount * odds);
  const pendingBets = player.bets.filter((bet) => bet.matchId === matchId && bet.status === "pending");
  const latestBet = pendingBets[0];

  useEffect(() => {
    if (selectedBot?.id) {
      setBetBotId(selectedBot.id);
    }
    if (selectedBot?.alive) {
      setSponsorBotId(selectedBot.id);
    }
  }, [selectedBot?.alive, selectedBot?.id]);

  return (
    <aside className="match-action-dock">
      <header className="action-dock-header">
        <div>
          <span>{player.accountName ?? "Guest account"}</span>
          <strong>{player.credits.toLocaleString()} credits</strong>
        </div>
        <button type="button" className="secondary-button" onClick={onCreateBot}>
          Create bot
        </button>
      </header>

      <section className="betting-card" aria-label="Betting">
        <div className="betting-card-title">
          <div>
            <span>Betting</span>
            <strong>{betBot?.name ?? "Choose a bot"}</strong>
          </div>
          <div className="odds-pill">
            {odds.toFixed(2)}x
          </div>
        </div>
        <div className="dock-field-row">
          <select value={betType} onChange={(event) => setBetType(event.target.value as BetType)} aria-label="Bet type">
            {BET_TYPES.map((type) => (
              <option key={type} value={type}>
                {getBetTypeLabel(type)}
              </option>
            ))}
          </select>
          <select value={betBotId} onChange={(event) => setBetBotId(event.target.value)} aria-label="Bet bot">
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}{bot.alive ? "" : " (out)"}
              </option>
            ))}
          </select>
        </div>
        <div className="amount-row">
          {[25, 50, 100].map((value) => (
            <button key={value} type="button" className={betAmount === value ? "active" : "secondary-button"} onClick={() => setAmount(value)} disabled={player.credits < value}>
              {value}
            </button>
          ))}
          <input type="number" min={MIN_BET_AMOUNT} max={player.credits} value={amount} onChange={(event) => setAmount(Number(event.target.value))} aria-label="Bet amount" />
        </div>
        <button className="primary-bet-button" type="button" disabled={!betBot || player.credits < betAmount} onClick={() => betBot && onPlaceBet(betType, betBot.id, betAmount, odds)}>
          Place {betAmount.toLocaleString()} credit bet
        </button>
        <div className="betting-meta">
          <span>Potential payout {potentialPayout.toLocaleString()}</span>
          <span>{pendingBets.length} active</span>
        </div>
        {latestBet && (
          <small>
            Latest: {getBetTypeLabel(latestBet.type)} on {bots.find((bot) => bot.id === latestBet.botId)?.name ?? "bot"} for {latestBet.amount}
          </small>
        )}
      </section>

      <section className="sponsor-strip" aria-label="Sponsor bot">
        <select value={sponsorBotId} onChange={(event) => setSponsorBotId(event.target.value)} aria-label="Sponsor target">
          <option value="">Sponsor target</option>
          {aliveBots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>
        <div className="sponsor-quick-grid">
          {SPONSOR_DROPS.map((drop) => (
            <button key={drop} type="button" disabled={!sponsorBotId} onClick={() => onSponsorDrop(sponsorBotId, drop)}>
              {drop}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
