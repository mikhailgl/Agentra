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
import { BOT_CONTEST_ENTRY_FEE, CUSTOM_BOT_CREATION_COST, getPlayerState, placeBet, savePlayerState, spendCredits, awardCredits } from "./game/player";
import { addCustomPersistentBot, loadPersistentBots, updatePersistentBotDoctrine } from "./game/persistence";
import {
  enableRemoteGameStateSync,
  loadArenaSnapshot,
  loadRemoteGameState,
  saveRemoteGameState,
  sendRemoteSponsorDrop,
  startRemoteNextMatch,
  subscribeToArenaStream,
  toggleRemoteArenaPause,
  type ArenaSnapshot,
} from "./game/remotePersistence";
import { enqueueBotForArena, loadArenaQueue } from "./game/queue";
import type { ArenaState, BasicMatchResult, BaseStats, BetType, BotAffinities, MatchState, PersistentBot, Psychology } from "./game/types";
import type { SponsorDropKind } from "./game/simulation";
import { toArenaViewModel } from "./lib/simulation/simulationTo3D";
import type { ArenaViewModel, CameraMode } from "./lib/simulation/types";

type CustomBotBuild = {
  name: string;
  baseStats: BaseStats;
  psychology: Psychology;
  traits: string[];
  affinities: BotAffinities;
  tacticalInstruction: string;
};

const ARENA_UI_SYNC_MS = 1_000;
const ROSTER_POLL_MS = 5_000;

function App() {
  const matchRef = useRef<MatchState | null>(null);
  const arenaStateRef = useRef<ArenaState | null>(null);
  const postMatchSummaryMatchRef = useRef<number | null>(null);

  const [matchView, setMatchView] = useState<MatchState | null>(null);
  const [arenaState, setArenaState] = useState<ArenaState | null>(null);
  const [visualArenaView, setVisualArenaView] = useState<ArenaViewModel | null>(null);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>("follow_action");
  const [cameraResetToken, setCameraResetToken] = useState(0);
  const [basicResults, setBasicResults] = useState<BasicMatchResult[]>([]);
  const [playerState, setPlayerState] = useState(() => getPlayerState());
  const [persistentBots, setPersistentBots] = useState<PersistentBot[]>(() => loadPersistentBots());
  const [arenaQueue, setArenaQueue] = useState<PersistentBot[]>([]);
  const [showCreator, setShowCreator] = useState(false);
  const [activeView, setActiveView] = useState<"arena" | "ludus">("arena");
  const [postMatchSummary, setPostMatchSummary] = useState<PostMatchSummary | null>(null);
  const playerStateRef = useRef(playerState);
  const [, forceClockSync] = useState(0);

  const selectedBot = useMemo(
    () => matchView?.bots.find((bot) => bot.id === selectedBotId) ?? null,
    [matchView, selectedBotId],
  );

  const arenaView = useMemo(
    () => (matchView ? toArenaViewModel(matchView, selectedBotId, [], []) : null),
    [matchView, selectedBotId],
  );

  const renderedArenaView = useMemo(() => {
    const baseArena = visualArenaView ?? arenaView;
    if (!baseArena) return null;
    return {
      ...baseArena,
      bots: baseArena.bots.map((bot) => ({
        ...bot,
        isSelected: bot.id === selectedBotId,
      })),
    };
  }, [arenaView, selectedBotId, visualArenaView]);

  const queuedBots = useMemo(() => {
    const activeBotIds = new Set(matchView?.bots.map((bot) => bot.id) ?? []);
    return arenaQueue.filter((bot) => !activeBotIds.has(bot.id));
  }, [arenaQueue, matchView]);

  const applyArenaSnapshot = useCallback((snapshot: ArenaSnapshot) => {
    matchRef.current = snapshot.match;
    arenaStateRef.current = snapshot.arenaState;
    setMatchView(snapshot.match);
    setArenaState(snapshot.arenaState);
    if (snapshot.persistentBots) {
      setPersistentBots(snapshot.persistentBots);
    }
    if (snapshot.basicResults) {
      setBasicResults(snapshot.basicResults);
    }
    if (snapshot.arenaQueueIds && snapshot.persistentBots) {
      setArenaQueue(
        snapshot.arenaQueueIds
          .map((id) => snapshot.persistentBots?.find((bot) => bot.id === id))
          .filter((bot): bot is PersistentBot => Boolean(bot)),
      );
    }

    if (snapshot.arenaState.phase === "intermission" && snapshot.match.ended) {
      if (postMatchSummaryMatchRef.current !== snapshot.arenaState.matchNumber) {
        postMatchSummaryMatchRef.current = snapshot.arenaState.matchNumber;
        setPostMatchSummary(createPostMatchSummary(snapshot.arenaState.matchNumber, snapshot.match, [], 0));
      }
      return;
    }

    postMatchSummaryMatchRef.current = null;
    setPostMatchSummary(null);
  }, []);

  const startNextMatch = useCallback(() => {
    void startRemoteNextMatch().then((snapshot) => {
      if (snapshot) applyArenaSnapshot(snapshot);
    });
  }, [applyArenaSnapshot]);

  const togglePause = useCallback(() => {
    void toggleRemoteArenaPause().then((snapshot) => {
      if (snapshot) applyArenaSnapshot(snapshot);
    });
  }, [applyArenaSnapshot]);

  const selectBot = useCallback((botId: string) => {
    setSelectedBotId(botId);
    setCameraMode("follow_bot");
  }, []);

  const resetCamera = useCallback(() => {
    setCameraMode("free");
    setCameraResetToken((token) => token + 1);
  }, []);

  const handlePlaceBet = useCallback((type: BetType, botId: string, amount: number, odds: number) => {
    if (!matchRef.current) {
      return;
    }

    const nextPlayer = placeBet(playerStateRef.current, matchRef.current, type, botId, amount, odds);
    if (!nextPlayer) {
      return;
    }
    playerStateRef.current = nextPlayer;
    savePlayerState(nextPlayer);
    setPlayerState(nextPlayer);
  }, []);

  const handleSponsorDrop = useCallback((botId: string, kind: SponsorDropKind) => {
    void sendRemoteSponsorDrop(botId, kind).then((snapshot) => {
      if (!snapshot) {
        return;
      }

      applyArenaSnapshot(snapshot);
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
    });
  }, [applyArenaSnapshot]);

  const handleCreateCustomBot = useCallback((build: CustomBotBuild, enterContest: boolean) => {
    const chargedPlayer = spendCredits(playerStateRef.current, CUSTOM_BOT_CREATION_COST);
    if (!chargedPlayer) {
      return;
    }

    const [createdBot] = addCustomPersistentBot(build);
    const nextPool = loadPersistentBots();
    setPersistentBots(nextPool);
    setShowCreator(false);
    playerStateRef.current = chargedPlayer;
    savePlayerState(chargedPlayer);
    setPlayerState(chargedPlayer);

    const activeBotIds = matchRef.current?.bots.map((bot) => bot.id) ?? [];
    if (!createdBot || !enterContest) {
      setArenaQueue(loadArenaQueue(nextPool, activeBotIds));
      return;
    }
    setArenaQueue(enqueueBotForArena(createdBot.id, nextPool, activeBotIds));
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
    setArenaQueue(enqueueBotForArena(bot.id, persistentBots, matchRef.current?.bots.map((candidate) => candidate.id) ?? []));
  }, [persistentBots]);

  const handleAddCredits = useCallback(() => {
    const nextPlayer = awardCredits(playerStateRef.current, 1000);
    playerStateRef.current = nextPlayer;
    savePlayerState(nextPlayer);
    setPlayerState(nextPlayer);
  }, []);

  const handleUpdateDoctrine = useCallback((botId: string, instruction: string) => {
    const nextPool = updatePersistentBotDoctrine(botId, instruction);
    setPersistentBots(nextPool);
    setArenaQueue(loadArenaQueue(nextPool, matchRef.current?.bots.map((bot) => bot.id) ?? []));
  }, []);

  useEffect(() => {
    if (cameraMode !== "follow_bot") return;
    if (!selectedBotId) {
      setCameraMode("follow_action");
      return;
    }
    const selected = matchView?.bots.find((bot) => bot.id === selectedBotId);
    if (selected && !selected.alive) {
      setCameraMode("follow_action");
    }
  }, [cameraMode, matchView, selectedBotId]);

  useEffect(() => {
    let cancelled = false;

    loadRemoteGameState()
      .then((remoteState) => {
        if (cancelled || !remoteState) {
          return;
        }

        const hasRemoteState = Boolean(
          remoteState.persistentBots?.length ||
            remoteState.playerState ||
            remoteState.arenaState ||
            remoteState.arenaQueueIds?.length ||
            remoteState.basicResults?.length,
        );

        if (!hasRemoteState) {
          enableRemoteGameStateSync();
          saveRemoteGameState({ playerState });
          return;
        }

        if (remoteState.playerState) {
          playerStateRef.current = remoteState.playerState;
          savePlayerState(remoteState.playerState);
          setPlayerState(remoteState.playerState);
        }

        enableRemoteGameStateSync();
      })
      .catch((error) => {
        enableRemoteGameStateSync();
        console.warn("Remote game state hydration failed", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (arenaState?.phase !== "intermission") {
      return;
    }

    const clock = window.setInterval(() => forceClockSync((value) => value + 1), 1000);
    return () => window.clearInterval(clock);
  }, [arenaState?.phase]);

  useEffect(() => {
    let cancelled = false;
    let loggedStreamError = false;
    const unsubscribe = subscribeToArenaStream({
      onFrame(frame) {
        if (!cancelled) {
          setVisualArenaView(frame.arena);
          setArenaState(frame.arenaState);
          arenaStateRef.current = frame.arenaState;
        }
      },
      onError(error) {
        if (!loggedStreamError) {
          loggedStreamError = true;
          console.warn("Arena stream interrupted; browser will reconnect", error);
        }
      },
    });

    if (unsubscribe) {
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;
    const sync = () => {
      if (requestInFlight) return;
      requestInFlight = true;
      void loadArenaSnapshot()
        .then((snapshot) => {
          if (!cancelled && snapshot) {
            applyArenaSnapshot(snapshot);
          }
        })
        .catch((error) => {
          console.warn("Arena snapshot sync failed", error);
        })
        .finally(() => {
          requestInFlight = false;
        });
    };

    sync();
    const interval = window.setInterval(sync, ARENA_UI_SYNC_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [applyArenaSnapshot]);

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;
    const syncRoster = () => {
      if (requestInFlight) {
        return;
      }

      requestInFlight = true;
      void loadArenaSnapshot({ includeRoster: true })
        .then((snapshot) => {
          if (!cancelled && snapshot) {
            applyArenaSnapshot(snapshot);
          }
        })
        .catch((error) => {
          console.warn("Arena roster snapshot sync failed", error);
        })
        .finally(() => {
          requestInFlight = false;
        });
    };

    syncRoster();
    const interval = window.setInterval(syncRoster, ROSTER_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [applyArenaSnapshot]);

  if (activeView === "ludus") {
    return (
      <LudusView
        bots={persistentBots}
        player={playerState}
        queuedBotIds={queuedBots.map((bot) => bot.id)}
        activeBotIds={matchView?.bots.map((bot) => bot.id) ?? []}
        onBackToArena={() => setActiveView("arena")}
        onCreateBot={handleCreateCustomBot}
        onEnterBot={handleEnterBot}
        onAddCredits={handleAddCredits}
        onUpdateDoctrine={handleUpdateDoctrine}
      />
    );
  }

  if (!matchView || !arenaState || !renderedArenaView) {
    return (
      <main className="app-shell">
        <section className="simulation-area">
          <div className="stage">
            <div className="arena-loading" role="status">
              Connecting to arena...
            </div>
          </div>
        </section>
      </main>
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
            arena={renderedArenaView}
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
          {showCreator && <CustomBotCreator credits={playerState.credits} creationCost={CUSTOM_BOT_CREATION_COST} onClose={() => setShowCreator(false)} onCreate={handleCreateCustomBot} />}
          <MatchHighlightOverlay events={matchView.matchEvents} />
          <MatchLogOverlay events={matchView.events} matchEvents={matchView.matchEvents} selectedBot={selectedBot} />
        </div>
      </section>
    </main>
  );
}

export default App;
