import { BotPanel } from "../BotPanel";
import type { Bot } from "../../game/types";

export function BotInspector({
  bot,
  bots,
  onOpenProfile,
  onFollow,
}: {
  bot: Bot | null;
  bots: Bot[];
  onOpenProfile: (botId: string) => void;
  onFollow: () => void;
}) {
  return (
    <section className="bot-inspector">
      <BotPanel bot={bot} bots={bots} compact />
      {bot && (
        <div className="inspector-actions">
          <button type="button" className="secondary-button" onClick={onFollow}>
            Follow
          </button>
          <button type="button" className="secondary-button" onClick={() => onOpenProfile(bot.id)}>
            Profile
          </button>
        </div>
      )}
    </section>
  );
}
