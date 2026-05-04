import { formatTime } from "../../format";
import type { CameraMode } from "../../lib/simulation/types";
import type { MatchState, PlayerState } from "../../game/types";
import { Metric } from "../Metric";
import { PlayerBar } from "../PlayerInfluence";

export function GameOverlay({
  match,
  player,
  cameraMode,
  onCameraModeChange,
  onToggleStable,
  onCreateBot,
  onRestart,
}: {
  match: MatchState;
  player: PlayerState;
  cameraMode: CameraMode;
  onCameraModeChange: (mode: CameraMode) => void;
  onToggleStable: () => void;
  onCreateBot: () => void;
  onRestart: () => void;
}) {
  const aliveCount = match.bots.filter((bot) => bot.alive).length;
  const pendingBets = player.bets.filter((bet) => bet.matchId === match.id && bet.status === "pending").length;

  return (
    <>
      <div className="arena-top-left">
        <Metric label="Alive" value={`${aliveCount}/${match.bots.length}`} />
        <Metric label="Time" value={formatTime(match.elapsedMs)} />
        {match.winnerId && <Metric label="Winner" value={match.bots.find((bot) => bot.id === match.winnerId)?.name ?? "None"} />}
      </div>
      <div className="arena-top-right">
        <PlayerBar player={player} onToggleStable={onToggleStable} />
        <div className="mini-status">
          <span>{pendingBets} active bets</span>
          <span>{player.draftedBotIds.length} drafted</span>
        </div>
        <div className="camera-controls" aria-label="Camera mode">
          {(["orbit", "follow", "auto"] as CameraMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={cameraMode === mode ? "active" : "secondary-button"}
              onClick={() => onCameraModeChange(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        <div className="arena-actions">
          <button type="button" className="secondary-button" onClick={onCreateBot}>
            Create Bot
          </button>
          <button type="button" onClick={onRestart}>
            Restart
          </button>
        </div>
      </div>
    </>
  );
}
