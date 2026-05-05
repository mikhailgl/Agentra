import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThreeArena } from "./components/arena/ThreeArena";
import { CustomBotCreator } from "./components/CustomBotCreator";
import { LudusView } from "./components/LudusView";
import { PostMatchResults, createPostMatchSummary } from "./components/PostMatchResults";
import type { PostMatchSummary } from "./components/PostMatchResults";
import { MatchActionDock } from "./components/ui/MatchActionDock";
import { MatchHighlightOverlay } from "./components/ui/MatchHighlightOverlay";
import { MatchLogOverlay } from "./components/ui/MatchLogOverlay";
import { SpectatorOverlay } from "./components/ui/SpectatorOverlay";
import { getNextMatchNumber, loadBasicMatchResults, saveArenaState, saveBasicMatchResult } from "./game/arenaPersistence";
import { createMatch } from "./game/createMatch";
import { awardCredits, BOT_CONTEST_ENTRY_FEE, getPlayerState, placeBet, resolveMatchBets, savePlayerState, spendCredits } from "./game/player";
import { addCustomPersistentBot, loadPersistentBots, updatePersistentBotDoctrine, updatePersistentBotsAfterMatch } from "./game/persistence";
import { enqueueBotForArena, loadArenaQueue } from "./game/queue";
import { spawnSponsorDrop, stepSimulation } from "./game/simulation";
import type { ArenaState, BasicMatchResult, BaseStats, BetType, BotAffinities, MatchState, PersistentBot, Psychology } from "./game/types";
import type { SponsorDropKind } from "./game/simulation";
import { toArenaViewModel } from "./lib/simulation/simulationTo3D";
import type { CameraMode } from "./lib/simulation/types";

const INTERMISSION_MS = 5_000;

type CustomBotBuild = {
  name: string;
  baseStats: BaseStats;
  psychology: Psychology;
  traits: string[];
  affinities: BotAffinities;
  tacticalInstruction: string;
};

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
  const [cameraMode, setCameraMode] = useState<CameraMode>("follow_action");
  const [cameraResetToken, setCameraResetToken] = useState(0);
  const [basicResults, setBasicResults] = useState<BasicMatchResult[]>(() => loadBasicMatchResults());
  const [playerState, setPlayerState] = useState(() => getPlayerState());
  const [persistentBots, setPersistentBots] = useState<PersistentBot[]>(() => loadPersistentBots());
  const [arenaQueue, setArenaQueue] = useState<PersistentBot[]>(() => loadArenaQueue(loadPersistentBots(), initialMatch.bots.map((bot) => bot.id)));
  const [showCreator, setShowCreator] = useState(false);
  const [activeView, setActiveView] = useState<"arena" | "ludus">("arena");
  const [postMatchSummary, setPostMatchSummary] = useState<PostMatchSummary | null>(null);
  const playerStateRef = useRef(playerState);
  const [, forceClockSync] = useState(0);

  const selectedBot = useMemo(
    () => matchView.bots.find((bot) => bot.id === selectedBotId) ?? null,
    [matchView.bots, selectedBotId],
  );

  const arenaView = useMemo(
    () => toArenaViewModel(matchView, selectedBotId, [], []),
    [matchView, selectedBotId],
  );

  const queuedBots = useMemo(() => {
    const activeBotIds = new Set(matchView.bots.map((bot) => bot.id));
    return arenaQueue.filter((bot) => !activeBotIds.has(bot.id));
  }, [arenaQueue, matchView.bots]);

  const syncMatchView = useCallback(() => {
    setMatchView({
      ...matchRef.current,
      bots: [...matchRef.current.bots],
      loot: [...matchRef.current.loot],
      events: [...matchRef.current.events],
      matchEvents: [...matchRef.current.matchEvents],
      arenaEvents: [...matchRef.current.arenaEvents],
      narrativeMoments: [...matchRef.current.narrativeMoments],
      creatures: [...matchRef.current.creatures],
      historyEvents: [...matchRef.current.historyEvents],
    });
  }, []);

  const updateArenaState = useCallback((nextState: ArenaState) => {
    arenaStateRef.current = nextState;
    saveArenaState(nextState);
    setArenaState(nextState);
  }, []);

  const startMatch = useCallback(
    (matchNumber: number, carryOverBotId?: string, carryOverCredits = 0) => {
      const nextMatch = createMatch(carryOverBotId, carryOverCredits);
      const nextPool = loadPersistentBots();
      matchRef.current = nextMatch;
      lastFrameAtRef.current = null;
      lastUiSyncAtRef.current = 0;
      setSelectedBotId(null);
      setCameraMode("follow_action");
      setCameraResetToken((token) => token + 1);
      setPostMatchSummary(null);
      setActiveView("arena");
      updateArenaState(createRunningArenaState(matchNumber, nextMatch));
      setMatchView(nextMatch);
      setPersistentBots(nextPool);
      setArenaQueue(loadArenaQueue(nextPool, nextMatch.bots.map((bot) => bot.id)));
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
    const winner = match.winnerId ? match.bots.find((bot) => bot.id === match.winnerId) ?? null : null;
    const resolvedMatch = resolveMatchBets(playerStateRef.current, match);
    const resolved = resolvedMatch.state;
    const survivorCredits = winner?.custom && winner.carriedCredits > 0 ? winner.carriedCredits : 0;
    const nextPlayer = survivorCredits > 0 ? awardCredits(resolved, survivorCredits) : resolved;
    const nextPool = updatePersistentBotsAfterMatch(match, arenaStateRef.current.matchNumber);
    setPersistentBots(nextPool);
    setArenaQueue(loadArenaQueue(nextPool, match.bots.map((bot) => bot.id)));
    playerStateRef.current = nextPlayer;
    savePlayerState(nextPlayer);
    setPlayerState(nextPlayer);
    setPostMatchSummary(createPostMatchSummary(arenaStateRef.current.matchNumber, match, resolvedMatch.results, survivorCredits));

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
    setCameraMode("follow_bot");
  }, []);

  const resetCamera = useCallback(() => {
    setCameraMode("free");
    setCameraResetToken((token) => token + 1);
  }, []);

  const handlePlaceBet = useCallback((type: BetType, botId: string, amount: number, odds: number) => {
    const nextPlayer = placeBet(playerStateRef.current, matchRef.current, type, botId, amount, odds);
    if (!nextPlayer) {
      return;
    }
    playerStateRef.current = nextPlayer;
    savePlayerState(nextPlayer);
    setPlayerState(nextPlayer);
  }, []);

  const handleSponsorDrop = useCallback((botId: string, kind: SponsorDropKind) => {
    if (!spawnSponsorDrop(matchRef.current, botId, kind)) {
      return;
    }
    const nextPlayer = {
      ...playerStateRef.current,
      stats: {
        ...playerStateRef.current.stats,
        totalSponsorshipsSent: playerStateRef.current.stats.totalSponsorshipsSent + 1,
      },
    };
    playerStateRef.current = nextPlayer;
    savePlayerState(nextPlayer);
    setPlayerState(nextPlayer);
    syncMatchView();
  }, [syncMatchView]);

  const handleCreateCustomBot = useCallback((build: CustomBotBuild, enterContest: boolean) => {
    const [createdBot] = addCustomPersistentBot(build);
    const nextPool = loadPersistentBots();
    setPersistentBots(nextPool);
    setShowCreator(false);
    if (!createdBot || !enterContest) {
      setArenaQueue(loadArenaQueue(nextPool, matchRef.current.bots.map((bot) => bot.id)));
      return;
    }
    const chargedPlayer = spendCredits(playerStateRef.current, BOT_CONTEST_ENTRY_FEE);
    if (!chargedPlayer) {
      setArenaQueue(loadArenaQueue(nextPool, matchRef.current.bots.map((bot) => bot.id)));
      return;
    }
    playerStateRef.current = chargedPlayer;
    savePlayerState(chargedPlayer);
    setPlayerState(chargedPlayer);
    setArenaQueue(enqueueBotForArena(createdBot.id, nextPool, matchRef.current.bots.map((bot) => bot.id)));
  }, []);

  const handleEnterBot = useCallback((botId: string) => {
    const bot = persistentBots.find((candidate) => candidate.id === botId && candidate.custom);
    if (!bot) {
      return;
    }
    const chargedPlayer = spendCredits(playerStateRef.current, BOT_CONTEST_ENTRY_FEE);
    if (!chargedPlayer) {
      return;
    }
    playerStateRef.current = chargedPlayer;
    savePlayerState(chargedPlayer);
    setPlayerState(chargedPlayer);
    setArenaQueue(enqueueBotForArena(bot.id, persistentBots, matchRef.current.bots.map((candidate) => candidate.id)));
  }, [persistentBots]);

  const handleUpdateDoctrine = useCallback((botId: string, instruction: string) => {
    const nextPool = updatePersistentBotDoctrine(botId, instruction);
    setPersistentBots(nextPool);
    setArenaQueue(loadArenaQueue(nextPool, matchRef.current.bots.map((bot) => bot.id)));
  }, []);

  useEffect(() => {
    if (cameraMode !== "follow_bot") return;
    if (!selectedBotId) {
      setCameraMode("follow_action");
      return;
    }
    const selected = matchView.bots.find((bot) => bot.id === selectedBotId);
    if (selected && !selected.alive) {
      setCameraMode("follow_action");
    }
  }, [cameraMode, matchView.bots, selectedBotId]);

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

  if (activeView === "ludus") {
    return (
      <LudusView
        bots={persistentBots}
        player={playerState}
        queuedBotIds={queuedBots.map((bot) => bot.id)}
        activeBotIds={matchView.bots.map((bot) => bot.id)}
        onBackToArena={() => setActiveView("arena")}
        onCreateBot={handleCreateCustomBot}
        onEnterBot={handleEnterBot}
        onUpdateDoctrine={handleUpdateDoctrine}
      />
    );
  }

  return (
    <main className="app-shell">
      <section className="simulation-area">
        <div className="stage">
          <nav className="view-switcher" aria-label="Primary views">
            <button type="button" className="active">
              Arena
            </button>
            <button type="button" className="secondary-button" onClick={() => setActiveView("ludus")}>
              Bots
            </button>
          </nav>
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
            queuedBots={queuedBots}
            selectedBot={selectedBot}
            credits={playerState.credits}
            results={basicResults}
            cameraMode={cameraMode}
            onSelectBot={selectBot}
            onCameraModeChange={setCameraMode}
            onTogglePause={togglePause}
            onResetCamera={resetCamera}
            onStartNextNow={startNextMatch}
            narrativeMoments={matchView.narrativeMoments}
            showIntermissionCard={!postMatchSummary}
          />
          {arenaState.phase === "intermission" && postMatchSummary && (
            <PostMatchResults
              summary={postMatchSummary}
              countdownSeconds={arenaState.intermissionEndsAt ? Math.max(0, Math.ceil((arenaState.intermissionEndsAt - Date.now()) / 1000)) : 0}
              onStartNextNow={startNextMatch}
            />
          )}
          <MatchActionDock
            player={playerState}
            bots={matchView.bots}
            matchId={matchView.id}
            selectedBot={selectedBot}
            onPlaceBet={handlePlaceBet}
            onSponsorDrop={handleSponsorDrop}
            onCreateBot={() => setShowCreator(true)}
          />
          {showCreator && <CustomBotCreator credits={playerState.credits} entryFee={BOT_CONTEST_ENTRY_FEE} onClose={() => setShowCreator(false)} onCreate={handleCreateCustomBot} />}
          <MatchHighlightOverlay events={matchView.matchEvents} />
          <MatchLogOverlay events={matchView.events} matchEvents={matchView.matchEvents} selectedBot={selectedBot} />
        </div>
      </section>
    </main>
  );
}

export default App;
