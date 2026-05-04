import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThreeArena } from "./components/arena/ThreeArena";
import { MatchLogOverlay } from "./components/ui/MatchLogOverlay";
import { SpectatorOverlay } from "./components/ui/SpectatorOverlay";
import { getNextMatchNumber, loadBasicMatchResults, saveArenaState, saveBasicMatchResult } from "./game/arenaPersistence";
import { createMatch } from "./game/createMatch";
import { updatePersistentBotsAfterMatch } from "./game/persistence";
import { stepSimulation } from "./game/simulation";
import type { ArenaState, BasicMatchResult, MatchState } from "./game/types";
import { toArenaViewModel } from "./lib/simulation/simulationTo3D";
import type { CameraMode } from "./lib/simulation/types";

const INTERMISSION_MS = 5_000;

function getLatestWinnerId(): string | undefined {
  const winnerId = loadBasicMatchResults()[0]?.winnerBotId;
  return winnerId && winnerId !== "no-survivor" ? winnerId : undefined;
}

function createRunningArenaState(matchNumber: number, match: MatchState): ArenaState {
  return {
    matchNumber,
    phase: "running",
    activeBotIds: match.bots.map((bot) => bot.id),
  };
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function App() {
  const initialMatchNumber = useMemo(() => getNextMatchNumber(), []);
  const initialMatch = useMemo(() => createMatch(getLatestWinnerId()), []);
  const matchRef = useRef<MatchState>(initialMatch);
  const arenaStateRef = useRef<ArenaState>(createRunningArenaState(initialMatchNumber, initialMatch));
  const animationRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef<number | null>(null);
  const lastUiSyncAtRef = useRef(0);

  const [matchView, setMatchView] = useState(matchRef.current);
  const [arenaState, setArenaState] = useState(arenaStateRef.current);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>("auto");
  const [cameraResetToken, setCameraResetToken] = useState(0);
  const [basicResults, setBasicResults] = useState<BasicMatchResult[]>(() => loadBasicMatchResults());
  const [, forceClockSync] = useState(0);

  const selectedBot = useMemo(
    () => matchView.bots.find((bot) => bot.id === selectedBotId) ?? null,
    [matchView.bots, selectedBotId],
  );

  const arenaView = useMemo(
    () => toArenaViewModel(matchView, selectedBotId, [], []),
    [matchView, selectedBotId],
  );

  const syncMatchView = useCallback(() => {
    setMatchView({
      ...matchRef.current,
      bots: [...matchRef.current.bots],
      loot: [...matchRef.current.loot],
      events: [...matchRef.current.events],
      historyEvents: [...matchRef.current.historyEvents],
    });
  }, []);

  const updateArenaState = useCallback((nextState: ArenaState) => {
    arenaStateRef.current = nextState;
    saveArenaState(nextState);
    setArenaState(nextState);
  }, []);

  const startMatch = useCallback(
    (matchNumber: number, carryOverBotId?: string) => {
      const nextMatch = createMatch(carryOverBotId);
      matchRef.current = nextMatch;
      lastFrameAtRef.current = null;
      lastUiSyncAtRef.current = 0;
      setSelectedBotId(null);
      setCameraMode("auto");
      setCameraResetToken((token) => token + 1);
      updateArenaState(createRunningArenaState(matchNumber, nextMatch));
      setMatchView(nextMatch);
    },
    [updateArenaState],
  );

  const startNextMatch = useCallback(() => {
    startMatch(arenaStateRef.current.matchNumber + 1, arenaStateRef.current.lastWinnerId);
  }, [startMatch]);

  const finishMatch = useCallback(() => {
    const match = matchRef.current;
    if (!match.ended || match.finalized) {
      return;
    }

    match.finalized = true;
    updatePersistentBotsAfterMatch(match);
    const winner = match.winnerId ? match.bots.find((bot) => bot.id === match.winnerId) ?? null : null;

    setBasicResults(
      saveBasicMatchResult({
        matchNumber: arenaStateRef.current.matchNumber,
        winnerBotId: winner?.id ?? "no-survivor",
        winnerName: winner?.name ?? "No survivor",
        endedAt: Date.now(),
      }),
    );

    updateArenaState({
      ...arenaStateRef.current,
      phase: "intermission",
      activeBotIds: match.bots.filter((bot) => bot.alive).map((bot) => bot.id),
      lastWinnerId: winner?.id,
      intermissionEndsAt: Date.now() + INTERMISSION_MS,
    });
  }, [updateArenaState]);

  const togglePause = useCallback(() => {
    const current = arenaStateRef.current;
    if (current.phase === "intermission") {
      return;
    }

    lastFrameAtRef.current = null;
    updateArenaState({
      ...current,
      phase: current.phase === "paused" ? "running" : "paused",
    });
  }, [updateArenaState]);

  const selectBot = useCallback((botId: string) => {
    setSelectedBotId(botId);
    setCameraMode("follow");
  }, []);

  const resetCamera = useCallback(() => {
    setCameraMode("auto");
    setCameraResetToken((token) => token + 1);
  }, []);

  useEffect(() => {
    saveArenaState(arenaStateRef.current);
  }, []);

  useEffect(() => {
    const clock = window.setInterval(() => forceClockSync((value) => value + 1), 250);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    const tick = (timestamp: number) => {
      const currentArenaState = arenaStateRef.current;

      if (currentArenaState.phase === "intermission") {
        if (currentArenaState.intermissionEndsAt && Date.now() >= currentArenaState.intermissionEndsAt) {
          startNextMatch();
        }
        animationRef.current = window.requestAnimationFrame(tick);
        return;
      }

      if (currentArenaState.phase === "running") {
        const lastFrameAt = lastFrameAtRef.current ?? timestamp;
        const deltaMs = Math.min(50, timestamp - lastFrameAt);
        lastFrameAtRef.current = timestamp;
        stepSimulation(matchRef.current, deltaMs);
        finishMatch();
      }

      const shouldSyncUi = matchRef.current.ended || timestamp - lastUiSyncAtRef.current > 80;

      if (shouldSyncUi) {
        lastUiSyncAtRef.current = timestamp;
        syncMatchView();
        if (arenaStateRef.current.phase !== "intermission") {
          const activeBotIds = matchRef.current.bots.filter((bot) => bot.alive).map((bot) => bot.id);
          if (!areStringArraysEqual(arenaStateRef.current.activeBotIds, activeBotIds)) {
            updateArenaState({
              ...arenaStateRef.current,
              activeBotIds,
            });
          }
        }
      }

      animationRef.current = window.requestAnimationFrame(tick);
    };

    animationRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (animationRef.current) {
        window.cancelAnimationFrame(animationRef.current);
      }
    };
  }, [finishMatch, startNextMatch, syncMatchView, updateArenaState]);

  return (
    <main className="app-shell">
      <section className="simulation-area">
        <div className="stage">
          <ThreeArena
            arena={arenaView}
            cameraMode={cameraMode}
            selectedBotId={selectedBotId}
            cameraResetToken={cameraResetToken}
            onSelectBot={selectBot}
            onClearSelection={() => setSelectedBotId(null)}
          />
          <SpectatorOverlay
            arenaState={arenaState}
            bots={matchView.bots}
            selectedBot={selectedBot}
            results={basicResults}
            onSelectBot={selectBot}
            onTogglePause={togglePause}
            onFollowSelected={() => selectedBotId && setCameraMode("follow")}
            onResetCamera={resetCamera}
            onStartNextNow={startNextMatch}
          />
          <MatchLogOverlay events={matchView.events} selectedBot={selectedBot} />
        </div>
      </section>
    </main>
  );
}

export default App;
