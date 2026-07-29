import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThreeArena } from "./components/arena/ThreeArena";
import { CustomBotCreator } from "./components/CustomBotCreator";
import { LudusView } from "./components/LudusView";
import { PostMatchResults, createPostMatchSummary } from "./components/PostMatchResults";
import type { PostMatchSummary } from "./components/PostMatchResults";
import { MatchActionDock } from "./components/ui/MatchActionDock";
import { MatchHighlightOverlay } from "./components/ui/MatchHighlightOverlay";
import { MatchLogOverlay } from "./components/ui/MatchLogOverlay";
import { SpectatorOverlay } from "./components/ui/SpectatorOverlay";
import { BOT_CONTEST_ENTRY_FEE, CUSTOM_BOT_CREATION_COST, getPlayerState, getSponsorDropCost, placeBet, resolveMatchBets, savePlayerState, spendCredits, awardCredits } from "./game/player";
import { addCustomPersistentBot, loadPersistentBots, removeCustomPersistentBot, savePersistentBots, updatePersistentBotDoctrine } from "./game/persistence";
import {
  enableRemoteGameStateSync,
  hasArenaBackend,
  loadArenaSnapshot,
  loadRemoteGameState,
  registerRemoteBot,
  saveRemoteGameState,
  sendRemoteSponsorDrop,
  startRemoteNextMatch,
  subscribeToArenaStream,
  toggleRemoteArenaPause,
  updateRemoteBotDoctrine,
  type ArenaSnapshot,
} from "./game/remotePersistence";
import { loadArenaQueue } from "./game/queue";
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
type ActiveView = "arena" | "ludus" | "videos";
const GeneratedVideosView = lazy(() =>
  import("./components/GeneratedVideosView").then((module) => ({ default: module.GeneratedVideosView })),
);

function App() {
  const matchRef = useRef<MatchState | null>(null);
  const arenaStateRef = useRef<ArenaState | null>(null);
  const postMatchSummaryMatchRef = useRef<number | null>(null);
  const sponsorDropInFlightRef = useRef(false);
  const botMutationInFlightRef = useRef(false);

  const [matchView, setMatchView] = useState<MatchState | null>(null);
  const [arenaState, setArenaState] = useState<ArenaState | null>(null);
  const [visualArenaView, setVisualArenaView] = useState<ArenaViewModel | null>(null);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>("follow_action");
  const [cameraResetToken, setCameraResetToken] = useState(0);
  const [basicResults, setBasicResults] = useState<BasicMatchResult[]>([]);
  const [playerState, setPlayerState] = useState(getInitialPlayerState);
  const [persistentBots, setPersistentBots] = useState<PersistentBot[]>(() => loadPersistentBots());
  const [arenaQueue, setArenaQueue] = useState<PersistentBot[]>([]);
  const [showCreator, setShowCreator] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>(() => getInitialActiveView());
  const [postMatchSummary, setPostMatchSummary] = useState<PostMatchSummary | null>(null);
  const [arenaActionError, setArenaActionError] = useState<string | null>(null);
  const [arenaConnectionError, setArenaConnectionError] = useState<string | null>(() =>
    hasArenaBackend() ? null : "Arena backend is not configured.",
  );
  const [sponsorDropPending, setSponsorDropPending] = useState(false);
  const [botMutationPending, setBotMutationPending] = useState(false);
  const playerStateRef = useRef(playerState);
  const [, forceClockSync] = useState(0);

  const navigateToView = useCallback((view: ActiveView) => {
    setActiveView(view);
    if (typeof window === "undefined") {
      return;
    }
    const nextUrl = view === "arena" ? `${window.location.pathname}${window.location.search}` : `#${view}`;
    window.history.replaceState(null, "", nextUrl);
  }, []);

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
    setArenaConnectionError(null);
    matchRef.current = snapshot.match;
    arenaStateRef.current = snapshot.arenaState;
    setMatchView(snapshot.match);
    setArenaState(snapshot.arenaState);
    if (snapshot.persistentBots) {
      setPersistentBots((current) => mergeArenaRoster(snapshot.persistentBots ?? [], current, playerStateRef.current.ownedBotIds));
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
        const betResolution = resolveMatchBets(playerStateRef.current, snapshot.match);
        const winningBot = snapshot.match.winnerId ? snapshot.match.bots.find((bot) => bot.id === snapshot.match.winnerId) : null;
        const awardedCredits = winningBot?.custom && playerStateRef.current.ownedBotIds.includes(winningBot.id) ? winningBot.carriedCredits : 0;
        const nextPlayer = awardedCredits > 0 ? awardCredits(betResolution.state, awardedCredits) : betResolution.state;
        playerStateRef.current = nextPlayer;
        savePlayerState(nextPlayer);
        setPlayerState(nextPlayer);
        setPostMatchSummary(createPostMatchSummary(snapshot.arenaState.matchNumber, snapshot.match, betResolution.results, awardedCredits));
      }
      return;
    }

    postMatchSummaryMatchRef.current = null;
    setPostMatchSummary(null);
  }, []);

  const startNextMatch = useCallback(() => {
    setArenaActionError(null);
    void startRemoteNextMatch()
      .then((snapshot) => {
        if (snapshot) applyArenaSnapshot(snapshot);
      })
      .catch((error) => setArenaActionError(getErrorMessage(error)));
  }, [applyArenaSnapshot]);

  const togglePause = useCallback(() => {
    setArenaActionError(null);
    void toggleRemoteArenaPause()
      .then((snapshot) => {
        if (snapshot) applyArenaSnapshot(snapshot);
      })
      .catch((error) => setArenaActionError(getErrorMessage(error)));
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
    if (sponsorDropInFlightRef.current) {
      return;
    }
    const chargedPlayer = spendCredits(playerStateRef.current, getSponsorDropCost(kind));
    if (!chargedPlayer) {
      return;
    }

    sponsorDropInFlightRef.current = true;
    setSponsorDropPending(true);
    setArenaActionError(null);
    void sendRemoteSponsorDrop(botId, kind)
      .then((snapshot) => {
        if (!snapshot) throw new Error("Arena backend is not configured");
        applyArenaSnapshot(snapshot);
        const nextPlayer = {
          ...chargedPlayer,
          stats: {
            ...chargedPlayer.stats,
            totalSponsorshipsSent: chargedPlayer.stats.totalSponsorshipsSent + 1,
          },
        };
        playerStateRef.current = nextPlayer;
        savePlayerState(nextPlayer);
        setPlayerState(nextPlayer);
      })
      .catch((error) => setArenaActionError(getErrorMessage(error)))
      .finally(() => {
        sponsorDropInFlightRef.current = false;
        setSponsorDropPending(false);
      });
  }, [applyArenaSnapshot]);

  const handleCreateCustomBot = useCallback(async (build: CustomBotBuild, enterContest: boolean): Promise<boolean> => {
    if (botMutationInFlightRef.current) return false;
    const chargedPlayer = spendCredits(playerStateRef.current, CUSTOM_BOT_CREATION_COST);
    if (!chargedPlayer) {
      return false;
    }

    const [createdBot] = addCustomPersistentBot(build);
    const nextPool = loadPersistentBots();
    setPersistentBots(nextPool);
    if (!createdBot) {
      return false;
    }

    botMutationInFlightRef.current = true;
    setBotMutationPending(true);
    setArenaActionError(null);
    try {
      const snapshot = await registerRemoteBot(createdBot, enterContest);
      if (!snapshot) throw new Error("Arena backend is not configured");
      const nextPlayer = {
        ...chargedPlayer,
        ownedBotIds: [...new Set([...chargedPlayer.ownedBotIds, createdBot.id])],
      };
      playerStateRef.current = nextPlayer;
      savePlayerState(nextPlayer);
      setPlayerState(nextPlayer);
      applyArenaSnapshot(snapshot);
      setShowCreator(false);
      return true;
    } catch (error) {
      setPersistentBots(removeCustomPersistentBot(createdBot.id));
      setArenaActionError(getErrorMessage(error));
      return false;
    } finally {
      botMutationInFlightRef.current = false;
      setBotMutationPending(false);
    }
  }, [applyArenaSnapshot]);

  const handleEnterBot = useCallback((botId: string) => {
    if (botMutationInFlightRef.current) return;
    const bot = persistentBots.find((candidate) => candidate.id === botId && candidate.custom);
    if (!bot) {
      return;
    }
    const chargedPlayer = spendCredits(playerStateRef.current, BOT_CONTEST_ENTRY_FEE);
    if (!chargedPlayer) {
      return;
    }
    botMutationInFlightRef.current = true;
    setBotMutationPending(true);
    setArenaActionError(null);
    void registerRemoteBot(bot, true)
      .then((snapshot) => {
        if (!snapshot) throw new Error("Arena backend is not configured");
        playerStateRef.current = chargedPlayer;
        savePlayerState(chargedPlayer);
        setPlayerState(chargedPlayer);
        applyArenaSnapshot(snapshot);
      })
      .catch((error) => setArenaActionError(getErrorMessage(error)))
      .finally(() => {
        botMutationInFlightRef.current = false;
        setBotMutationPending(false);
      });
  }, [applyArenaSnapshot, persistentBots]);

  const handleAddCredits = useCallback(() => {
    const nextPlayer = awardCredits(playerStateRef.current, 1000);
    playerStateRef.current = nextPlayer;
    savePlayerState(nextPlayer);
    setPlayerState(nextPlayer);
  }, []);

  const handleUpdateDoctrine = useCallback((botId: string, instruction: string) => {
    if (botMutationInFlightRef.current) return;
    const nextPool = updatePersistentBotDoctrine(botId, instruction);
    setPersistentBots(nextPool);
    setArenaQueue(loadArenaQueue(nextPool, matchRef.current?.bots.map((bot) => bot.id) ?? []));
    const updatedBot = nextPool.find((bot) => bot.id === botId && bot.custom);
    if (!updatedBot) return;
    botMutationInFlightRef.current = true;
    setBotMutationPending(true);
    setArenaActionError(null);
    void registerRemoteBot(updatedBot, false)
      .then(() => updateRemoteBotDoctrine(botId, instruction))
      .then((snapshot) => {
        if (!snapshot) throw new Error("Arena backend is not configured");
        applyArenaSnapshot(snapshot);
      })
      .catch((error) => setArenaActionError(getErrorMessage(error)))
      .finally(() => {
        botMutationInFlightRef.current = false;
        setBotMutationPending(false);
      });
  }, [applyArenaSnapshot]);

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
    const handleHashChange = () => setActiveView(getInitialActiveView());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

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
          saveRemoteGameState({ playerState, persistentBots: loadPersistentBots() });
          return;
        }

        if (remoteState.persistentBots?.length) {
          savePersistentBots(remoteState.persistentBots);
          setPersistentBots(remoteState.persistentBots);
        }

        if (remoteState.playerState) {
          savePlayerState(remoteState.playerState);
          const hydratedPlayer = getPlayerState();
          playerStateRef.current = hydratedPlayer;
          setPlayerState(hydratedPlayer);
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
          setArenaConnectionError(getErrorMessage(error));
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
        onBackToArena={() => navigateToView("arena")}
        onOpenVideos={() => navigateToView("videos")}
        onCreateBot={handleCreateCustomBot}
        onEnterBot={handleEnterBot}
        onAddCredits={handleAddCredits}
        onUpdateDoctrine={handleUpdateDoctrine}
        mutationPending={botMutationPending}
        actionError={arenaActionError}
      />
    );
  }

  if (activeView === "videos") {
    return (
      <Suspense fallback={<main className="videos-shell"><div className="arena-loading" role="status">Loading video studio...</div></main>}>
        <GeneratedVideosView
          currentMatch={matchView}
          arenaState={arenaState}
          onBackToArena={() => navigateToView("arena")}
          onOpenBots={() => navigateToView("ludus")}
        />
      </Suspense>
    );
  }

  if (!matchView || !arenaState || !renderedArenaView) {
    return (
      <main className="app-shell">
        <section className="simulation-area">
          <div className="stage">
            <div className="arena-loading" role="status">
              <strong>{arenaConnectionError ? "Arena engine unavailable" : "Connecting to arena..."}</strong>
              {arenaConnectionError && (
                <span className="arena-loading-detail" role="alert">
                  {arenaConnectionError} Retrying automatically.
                </span>
              )}
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
            <button type="button" className="secondary-button" onClick={() => navigateToView("ludus")}>
              Bots
            </button>
            <button type="button" className="secondary-button" onClick={() => navigateToView("videos")}>
              Videos
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
            sponsorDropPending={sponsorDropPending}
          />
          {arenaActionError && <div className="arena-action-error" role="alert">{arenaActionError}</div>}
          {showCreator && <CustomBotCreator credits={playerState.credits} creationCost={CUSTOM_BOT_CREATION_COST} pending={botMutationPending} onClose={() => setShowCreator(false)} onCreate={handleCreateCustomBot} />}
          <MatchHighlightOverlay events={matchView.matchEvents} />
          <MatchLogOverlay events={matchView.events} matchEvents={matchView.matchEvents} selectedBot={selectedBot} />
        </div>
      </section>
    </main>
  );
}

export default App;

function getInitialActiveView(): ActiveView {
  if (typeof window === "undefined") {
    return "arena";
  }

  const hash = window.location.hash.replace(/^#/, "");
  return hash === "ludus" || hash === "videos" ? hash : "arena";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Arena action failed";
}

function getInitialPlayerState() {
  const player = getPlayerState();
  const legacyOwnedBotIds = loadPersistentBots().filter((bot) => bot.custom).map((bot) => bot.id);
  if (legacyOwnedBotIds.every((id) => player.ownedBotIds.includes(id))) {
    return player;
  }
  const migratedPlayer = { ...player, ownedBotIds: [...new Set([...player.ownedBotIds, ...legacyOwnedBotIds])] };
  savePlayerState(migratedPlayer);
  return migratedPlayer;
}

function mergeArenaRoster(serverRoster: PersistentBot[], currentRoster: PersistentBot[], ownedBotIds: string[]): PersistentBot[] {
  const serverIds = new Set(serverRoster.map((bot) => bot.id));
  const ownedIds = new Set(ownedBotIds);
  const localOwnedBots = currentRoster.filter((bot) => bot.custom && ownedIds.has(bot.id) && !serverIds.has(bot.id));
  return [...localOwnedBots, ...serverRoster];
}
