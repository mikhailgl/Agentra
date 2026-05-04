import type { ReactNode } from "react";
import { formatTime } from "../format";
import { getBiomeName } from "../game/biomes";
import {
  createNameMap,
  getBotTimeline,
  getRelationshipLeader,
  type MatchRecord,
} from "../game/history";
import { xpToNextLevel } from "../game/progression";
import { getTraitLabels } from "../game/traits";
import type { Bot } from "../game/types";

export function BotProfileModal({
  bot,
  bots,
  history,
  onClose,
}: {
  bot: Bot;
  bots: Bot[];
  history: MatchRecord[];
  onClose: () => void;
}) {
  const names = createNameMap(bots);
  const timeline = getBotTimeline(bot, history, names);
  const matches = bot.career.matchesPlayed || 0;
  const winRate = matches ? `${Math.round((bot.career.wins / matches) * 100)}%` : "0%";
  const recentRecords = history.filter((record) => record.placements.some((placement) => placement.botId === bot.id)).slice(0, 5);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title-row">
          <div>
            <span>Bot profile</span>
            <h2 id="profile-title">{bot.name}</h2>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="profile-grid">
          <ProfileBlock title="Identity">
            {bot.custom && <Detail label="Origin" value="Player-created" />}
            <Detail label="Level" value={`${bot.level} (${bot.xp}/${xpToNextLevel(bot.level)} XP)`} />
            <Detail label="Traits" value={getTraitLabels(bot.traits ?? []).join(", ") || "None"} />
            <Detail label="Psychology" value={summarizePsychology(bot)} />
          </ProfileBlock>

          <ProfileBlock title="Career">
            <Detail label="Matches" value={String(bot.career.matchesPlayed)} />
            <Detail label="Wins" value={String(bot.career.wins)} />
            <Detail label="Win rate" value={winRate} />
            <Detail label="Kills" value={String(bot.career.kills)} />
            <Detail label="Damage" value={String(Math.round(bot.career.damageDealt))} />
            <Detail label="Best survival" value={formatTime(bot.career.longestSurvivalTime)} />
          </ProfileBlock>

          <ProfileBlock title="Affinities">
            <Detail label="Biome" value={topEntry(bot.affinities.biomes, (key) => getBiomeName(key as Parameters<typeof getBiomeName>[0]))} />
            <Detail label="Weapon" value={topEntry(bot.affinities.weapons)} />
            <Detail label="Tool" value={topEntry(bot.affinities.tools)} />
            <Detail label="Range" value={topEntry(bot.affinities.combatRanges)} />
          </ProfileBlock>

          <ProfileBlock title="Social standing">
            <Detail label="Top ally" value={getRelationshipLeader(bot, names, "trust")} />
            <Detail label="Top feared" value={getRelationshipLeader(bot, names, "fear")} />
            <Detail label="Top respected" value={getRelationshipLeader(bot, names, "respect")} />
            <Detail label="Top resented" value={getRelationshipLeader(bot, names, "resentment")} />
          </ProfileBlock>

          <ProfileBlock title="Recent results">
            {recentRecords.length === 0 ? (
              <p>No archived matches yet.</p>
            ) : (
              recentRecords.map((record) => {
                const placement = record.placements.find((entry) => entry.botId === bot.id);
                const kills = record.kills.filter((kill) => kill.killerBotId === bot.id).length;
                return (
                  <p key={record.matchId}>
                    {record.winnerBotId === bot.id ? "Won" : `Placed #${placement?.place ?? "?"}`} · {kills} kills · {formatTime(placement?.survivalMs ?? 0)}
                  </p>
                );
              })
            )}
          </ProfileBlock>
        </div>

        <div className="timeline-block">
          <h3>Timeline</h3>
          {timeline.length === 0 ? (
            <p>No career history yet.</p>
          ) : (
            timeline.slice(0, 10).map((entry) => (
              <div key={`${entry.matchId}-${entry.kind}-${entry.text}`} className={`timeline-row ${entry.kind}`}>
                <time>{new Date(entry.timestamp).toLocaleDateString()}</time>
                <span>{entry.text}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function topEntry(record: Record<string, number> | Partial<Record<string, number>>, label = (key: string) => key): string {
  const [key, value] = Object.entries(record ?? {}).sort((a, b) => (b[1] ?? 1) - (a[1] ?? 1))[0] ?? [];
  return key ? `${label(key)} (${Number(value).toFixed(2)}x)` : "Neutral";
}

function ProfileBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="profile-block">
      <h3>{title}</h3>
      <div className="profile-details">{children}</div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function summarizePsychology(bot: Bot): string {
  const psychology = bot.psychology;
  const traits = [
    psychology.aggression > 0.68 ? "aggressive" : "",
    psychology.loyalty > 0.68 ? "loyal" : "",
    psychology.opportunism > 0.68 ? "opportunistic" : "",
    psychology.selfPreservation > 0.68 ? "survival-minded" : "",
    psychology.sociability > 0.65 ? "social" : "",
    psychology.vengefulness > 0.65 ? "vengeful" : "",
  ].filter(Boolean);
  return traits.slice(0, 4).join(", ") || bot.personality.toLowerCase();
}
