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
import { CUSTOM_BOT_CREATION_COST, getPlayerState, placeBet, resolveMatchBets, savePlayerState, awardCredits } from "./game/player";
import { addCustomPersistentBot, loadPersistentBots, removeCustomPersistentBot, savePersistentBots, updatePersistentBotDoctrine } from "./game/persistence";
import {
  enableRemoteGameStateSync,
  hasArenaBackend,
  issueRemoteCreatorApiKey,
  loadArenaSnapshot,
  loadRemoteOwnedBots,
  loadRemotePlayer,
  loadRemoteGameState,
  openRemotePlayerSession,
  placeRemoteBet,
  recoverRemotePlayer,
  registerRemoteBot,
  rotateRemoteRecoveryCode,
  saveRemoteGameState,
  saveRemoteFantasyRoster,
  sendRemoteSponsorDrop,
  subscribeToArenaStream,
  updateRemoteBotDoctrine,
  updateRemotePlayerName,
  type ArenaSnapshot,
} from "./game/remotePersistence";
import { loadArenaQueue } from "./game/queue";
import type { ArenaState, BasicMatchResult, BaseStats, BetType, BotAffinities, LeagueState, MatchState, PersistentBot, Psychology } from "./game/types";
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

const ARENA_UI_SYNC_MS = 5_000;
const ROSTER_POLL_MS = 60_000;
type ActiveView = "arena" | "league" | "fantasy" | "ludus" | "videos" | "story";
const GeneratedVideosView = lazy(() =>
  import("./components/GeneratedVideosView").then((module) => ({ default: module.GeneratedVideosView })),
);
const LeagueView = lazy(() =>
  import("./components/LeagueView").then((module) => ({ default: module.LeagueView })),
);
const FantasyView = lazy(() =>
  import("./components/FantasyView").then((module) => ({ default: module.FantasyView })),
);
const MatchStoryView = lazy(() =>
  import("./components/MatchStoryView").then((module) => ({ default: module.MatchStoryView })),
);

function App() {
  const matchRef = useRef<MatchState | null>(null);
  const arenaStateRef = useRef<ArenaState | null>(null);
  const postMatchSummaryMatchRef = useRef<number | null>(null);
  const sponsorDropInFlightRef = useRef(false);
  const botMutationInFlightRef = useRef(false);

  const [matchView, setMatchView] = useState<MatchState | null>(null);
  const [arenaState, setArenaState] = useState<ArenaState | null>(null);
  const [leagueState, setLeagueState] = useState<LeagueState | null>(null);
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
  const [playerSessionReady, setPlayerSessionReady] = useState(() => !hasArenaBackend());
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);
  const [newCreatorApiKey, setNewCreatorApiKey] = useState<string | null>(null);
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
    setLeagueState(snapshot.leagueState);
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

    const applyPlayer = (nextPlayer: ReturnType<typeof getPlayerState>) => {
      playerStateRef.current = nextPlayer;
      savePlayerState(nextPlayer);
      setPlayerState(nextPlayer);
    };
    setArenaActionError(null);
    void placeRemoteBet(matchRef.current.id, type, botId, amount)
      .then((remotePlayer) => {
        if (remotePlayer) {
          applyPlayer(remotePlayer);
          return;
        }
        const localPlayer = placeBet(playerStateRef.current, matchRef.current as MatchState, type, botId, amount, odds);
        if (localPlayer) applyPlayer(localPlayer);
      })
      .catch((error) => setArenaActionError(getErrorMessage(error)));
  }, []);

  const handleSponsorDrop = useCallback((botId: string, kind: SponsorDropKind) => {
    if (sponsorDropInFlightRef.current) {
      return;
    }
    sponsorDropInFlightRef.current = true;
    setSponsorDropPending(true);
    setArenaActionError(null);
    void sendRemoteSponsorDrop(botId, kind)
      .then((result) => {
        if (!result) throw new Error("Arena backend is not configured");
        applyArenaSnapshot(result.snapshot);
        playerStateRef.current = result.state;
        savePlayerState(result.state);
        setPlayerState(result.state);
      })
      .catch((error) => setArenaActionError(getErrorMessage(error)))
      .finally(() => {
        sponsorDropInFlightRef.current = false;
        setSponsorDropPending(false);
      });
  }, [applyArenaSnapshot]);

  const handleCreateCustomBot = useCallback(async (build: CustomBotBuild, enterContest: boolean): Promise<boolean> => {
    if (botMutationInFlightRef.current) return false;
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
      const result = await registerRemoteBot(createdBot, enterContest);
      if (!result) throw new Error("Arena backend is not configured");
      playerStateRef.current = result.state;
      savePlayerState(result.state);
      setPlayerState(result.state);
      applyArenaSnapshot(result.snapshot);
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
    botMutationInFlightRef.current = true;
    setBotMutationPending(true);
    setArenaActionError(null);
    void registerRemoteBot(bot, true)
      .then((result) => {
        if (!result) throw new Error("Arena backend is not configured");
        playerStateRef.current = result.state;
        savePlayerState(result.state);
        setPlayerState(result.state);
        applyArenaSnapshot(result.snapshot);
      })
      .catch((error) => setArenaActionError(getErrorMessage(error)))
      .finally(() => {
        botMutationInFlightRef.current = false;
        setBotMutationPending(false);
      });
  }, [applyArenaSnapshot, persistentBots]);

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
      .then((result) => {
        if (result) {
          playerStateRef.current = result.state;
          savePlayerState(result.state);
          setPlayerState(result.state);
        }
        return updateRemoteBotDoctrine(botId, instruction);
      })
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

  const handleUpdateAccountName = useCallback(async (name: string): Promise<boolean> => {
    setArenaActionError(null);
    try {
      const result = await updateRemotePlayerName(name);
      if (!result) throw new Error("Arena backend is not configured");
      playerStateRef.current = result.state;
      savePlayerState(result.state);
      setPlayerState(result.state);
      applyArenaSnapshot(result.snapshot);
      return true;
    } catch (error) {
      setArenaActionError(getErrorMessage(error));
      return false;
    }
  }, [applyArenaSnapshot]);

  const handleRecoverAccount = useCallback(async (recoveryCode: string): Promise<boolean> => {
    setArenaActionError(null);
    try {
      const state = await recoverRemotePlayer(recoveryCode);
      if (!state) throw new Error("Arena backend is not configured");
      playerStateRef.current = state;
      savePlayerState(state);
      setPlayerState(state);
      setNewRecoveryCode(null);
      setNewCreatorApiKey(null);
      const ownedBots = await loadRemoteOwnedBots();
      setPersistentBots((current) => {
        const merged = mergePrivateOwnedBots(current, ownedBots);
        savePersistentBots(merged);
        return merged;
      });
      return true;
    } catch (error) {
      setArenaActionError(getErrorMessage(error));
      return false;
    }
  }, []);

  const handleRotateRecoveryCode = useCallback(async (): Promise<string | null> => {
    setArenaActionError(null);
    try {
      const result = await rotateRemoteRecoveryCode();
      if (!result) throw new Error("Arena backend is not configured");
      setNewRecoveryCode(result.recoveryCode);
      return result.recoveryCode;
    } catch (error) {
      setArenaActionError(getErrorMessage(error));
      return null;
    }
  }, []);

  const handleIssueCreatorApiKey = useCallback(async (): Promise<string | null> => {
    setArenaActionError(null);
    try {
      const apiKey = await issueRemoteCreatorApiKey();
      if (!apiKey) throw new Error("Arena backend is not configured");
      setNewCreatorApiKey(apiKey);
      return apiKey;
    } catch (error) {
      setArenaActionError(getErrorMessage(error));
      return null;
    }
  }, []);

  const handleSaveFantasyRoster = useCallback(async (botIds: string[]): Promise<boolean> => {
    setArenaActionError(null);
    try {
      const state = await saveRemoteFantasyRoster(botIds);
      if (!state) throw new Error("Arena backend is not configured");
      playerStateRef.current = state;
      savePlayerState(state);
      setPlayerState(state);
      return true;
    } catch (error) {
      setArenaActionError(getErrorMessage(error));
      return false;
    }
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
    const handleHashChange = () => setActiveView(getInitialActiveView());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const remoteStateHydration = loadRemoteGameState()
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
          saveRemoteGameState({ persistentBots: loadPersistentBots() });
          return;
        }

        if (remoteState.persistentBots?.length) {
          savePersistentBots(remoteState.persistentBots);
          setPersistentBots(remoteState.persistentBots);
        }

        enableRemoteGameStateSync();
      })
      .catch((error) => {
        enableRemoteGameStateSync();
        console.warn("Remote game state hydration failed", error);
      });

    void openRemotePlayerSession()
      .then(async (session) => {
        if (cancelled || !session) return;
        playerStateRef.current = session.state;
        savePlayerState(session.state);
        setPlayerState(session.state);
        setNewRecoveryCode(session.recoveryCode ?? null);
        await remoteStateHydration;
        const ownedBots = await loadRemoteOwnedBots();
        if (cancelled) return;
        setPersistentBots((current) => {
          const merged = mergePrivateOwnedBots(current, ownedBots);
          savePersistentBots(merged);
          return merged;
        });
      })
      .catch((error) => {
        console.warn("Player session hydration failed", error);
        setArenaActionError(getErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setPlayerSessionReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (arenaState?.phase !== "intermission" || !playerSessionReady) return;
    const timer = window.setTimeout(() => {
      void loadRemotePlayer()
        .then((remotePlayer) => {
          if (!remotePlayer) return;
          playerStateRef.current = remotePlayer;
          savePlayerState(remotePlayer);
          setPlayerState(remotePlayer);
        })
        .catch((error) => console.warn("Player settlement sync failed", error));
    }, 750);
    return () => window.clearTimeout(timer);
  }, [arenaState?.matchNumber, arenaState?.phase, playerSessionReady]);

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
    let unsubscribe: (() => void) | null = null;
    const connect = () => {
      if (cancelled || document.visibilityState !== "visible" || unsubscribe) return;
      unsubscribe = subscribeToArenaStream({
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
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        connect();
        return;
      }
      unsubscribe?.();
      unsubscribe = null;
    };

    connect();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;
    const sync = () => {
      if (requestInFlight || document.visibilityState !== "visible") return;
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
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [applyArenaSnapshot]);

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;
    const syncRoster = () => {
      if (requestInFlight || document.visibilityState !== "visible") {
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
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") syncRoster();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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
        onOpenLeague={() => navigateToView("league")}
        onOpenFantasy={() => navigateToView("fantasy")}
        onCreateBot={handleCreateCustomBot}
        onEnterBot={handleEnterBot}
        onUpdateDoctrine={handleUpdateDoctrine}
        onUpdateAccountName={handleUpdateAccountName}
        onRecoverAccount={handleRecoverAccount}
        onRotateRecoveryCode={handleRotateRecoveryCode}
        onIssueCreatorApiKey={handleIssueCreatorApiKey}
        newRecoveryCode={newRecoveryCode}
        newCreatorApiKey={newCreatorApiKey}
        mutationPending={botMutationPending || !playerSessionReady}
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
          onOpenLeague={() => navigateToView("league")}
          onOpenFantasy={() => navigateToView("fantasy")}
        />
      </Suspense>
    );
  }

  if (activeView === "story") {
    return (
      <Suspense fallback={<main className="story-shell"><div className="story-status">Loading story...</div></main>}>
        <MatchStoryView
          matchNumber={getStoryMatchNumber()}
          onBackToArena={() => navigateToView("arena")}
          onOpenVideos={() => navigateToView("videos")}
          onOpenLeague={() => navigateToView("league")}
        />
      </Suspense>
    );
  }

  if (activeView === "league" && leagueState) {
    return (
      <Suspense fallback={<main className="league-shell"><div className="arena-loading" role="status">Loading league...</div></main>}>
        <LeagueView
          league={leagueState}
          match={matchView}
          ownedBotIds={playerState.ownedBotIds}
          onBackToArena={() => navigateToView("arena")}
          onOpenBots={() => navigateToView("ludus")}
          onOpenVideos={() => navigateToView("videos")}
          onOpenFantasy={() => navigateToView("fantasy")}
        />
      </Suspense>
    );
  }

  if (activeView === "fantasy" && leagueState) {
    return (
      <Suspense fallback={<main className="fantasy-shell"><div className="arena-loading" role="status">Loading fantasy league...</div></main>}>
        <FantasyView
          league={leagueState}
          bots={persistentBots}
          player={playerState}
          onSaveRoster={handleSaveFantasyRoster}
          onBackToArena={() => navigateToView("arena")}
          onOpenLeague={() => navigateToView("league")}
          onOpenBots={() => navigateToView("ludus")}
        />
      </Suspense>
    );
  }

  if (!matchView || !arenaState || !leagueState || !renderedArenaView) {
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
            <button type="button" className="secondary-button" onClick={() => navigateToView("league")}>
              League
            </button>
            <button type="button" className="secondary-button" onClick={() => navigateToView("fantasy")}>
              Fantasy
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
            leagueState={leagueState}
            bots={matchView.bots}
            queuedBots={queuedBots}
            selectedBot={selectedBot}
            credits={playerState.credits}
            results={basicResults}
            cameraMode={cameraMode}
            onSelectBot={selectBot}
            onCameraModeChange={setCameraMode}
            onResetCamera={resetCamera}
            narrativeMoments={matchView.narrativeMoments}
            showIntermissionCard={!postMatchSummary}
          />
          {arenaState.phase === "intermission" && postMatchSummary && (
            <PostMatchResults
              summary={postMatchSummary}
              countdownSeconds={arenaState.intermissionEndsAt ? Math.max(0, Math.ceil((arenaState.intermissionEndsAt - Date.now()) / 1000)) : 0}
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
            sponsorDropPending={sponsorDropPending || !playerSessionReady}
            playerReady={playerSessionReady}
          />
          {arenaActionError && <div className="arena-action-error" role="alert">{arenaActionError}</div>}
          {showCreator && <CustomBotCreator credits={playerState.credits} creationCost={CUSTOM_BOT_CREATION_COST} pending={botMutationPending || !playerSessionReady} onClose={() => setShowCreator(false)} onCreate={handleCreateCustomBot} />}
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
  if (/^story-\d+$/.test(hash)) return "story";
  return hash === "league" || hash === "fantasy" || hash === "ludus" || hash === "videos" ? hash : "arena";
}

function getStoryMatchNumber(): number {
  if (typeof window === "undefined") return 0;
  const match = window.location.hash.match(/^#story-(\d+)$/);
  return match ? Number(match[1]) : 0;
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
  const currentById = new Map(currentRoster.map((bot) => [bot.id, bot]));
  const localOwnedBots = currentRoster.filter((bot) => bot.custom && ownedIds.has(bot.id) && !serverIds.has(bot.id));
  const hydratedServerRoster = serverRoster.map((bot) => {
    const local = ownedIds.has(bot.id) ? currentById.get(bot.id) : undefined;
    return local?.tacticalInstruction ? { ...bot, tacticalInstruction: local.tacticalInstruction } : bot;
  });
  return [...localOwnedBots, ...hydratedServerRoster];
}

function mergePrivateOwnedBots(currentRoster: PersistentBot[], ownedBots: PersistentBot[]): PersistentBot[] {
  const ownedById = new Map(ownedBots.map((bot) => [bot.id, bot]));
  const merged = currentRoster.map((bot) => ownedById.get(bot.id) ?? bot);
  const currentIds = new Set(currentRoster.map((bot) => bot.id));
  return [...ownedBots.filter((bot) => !currentIds.has(bot.id)), ...merged];
}
