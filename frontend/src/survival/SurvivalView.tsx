import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  isDaylight,
  sheltered,
  type SurvivalSnapshot,
} from "../game/survival/types";
import "./survival.css";

const SurvivalScene = lazy(() => import("./SurvivalScene"));
const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;

class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="survival-scene-error">
        The 3D view could not start. Enable WebGL and reload. Survivor status
        and the event journal remain available.
      </p>
    ) : (
      this.props.children
    );
  }
}

export default function SurvivalView() {
  const [snapshot, setSnapshot] = useState<SurvivalSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("moss");
  const [reset, setReset] = useState(0);
  const [controlling, setControlling] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [journal, setJournal] = useState<"all" | "speech">("all");
  useEffect(() => {
    document.title = "The Island · BotArena";
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`${apiBase}/api/survival`, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8000),
          ]),
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = (await response.json()) as SurvivalSnapshot;
        if (!next.world?.bots || !next.runtime)
          throw new Error("Invalid survival response");
        if (!controller.signal.aborted) {
          setSnapshot(next);
          setError(null);
        }
      } catch {
        if (!controller.signal.aborted)
          setError("Connection lost. Reconnecting to the island…");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 750);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  async function control(paused: boolean, speed: number) {
    setControlling(true);
    setControlError(null);
    try {
      const response = await fetch(`${apiBase}/api/survival/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused, speed }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      setSnapshot(await response.json());
    } catch {
      setControlError("Could not change time. Please try again.");
    } finally {
      setControlling(false);
    }
  }

  const world = snapshot?.world;
  const runtime = snapshot?.runtime;
  const bot = world?.bots.find((b) => b.id === selected);
  const events =
    world?.events
      .filter((e) => journal === "all" || e.kind === "speech")
      .slice(-40)
      .reverse() ?? [];
  const running = runtime?.status === "running" && !error;

  return (
    <main className="survival-app">
      <header className="survival-header">
        <a className="survival-brand" href="/">
          B<span>∧</span>
          <span className="survival-brand-text">
            BOTARENA<span>SURVIVAL WORLDS</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="/">Arena</a>
          <a href="/survival" aria-current="page">
            The island
          </a>
        </nav>
        <div className={`survival-status ${running ? "live" : ""}`}>
          <i />
          {error
            ? "Reconnecting"
            : running
              ? "Live simulation"
              : runtime?.status === "unconfigured"
                ? "Awaiting models"
                : (runtime?.status ?? "Connecting")}
        </div>
      </header>
      <div className="survival-layout">
        <section className="survival-main" aria-label="Island spectator view">
          <div className="survival-title">
            <div>
              <p className="survival-eyebrow">
                EXPERIMENT 001 / AUTONOMOUS SURVIVAL
              </p>
              <h1>
                A world of their own<span>.</span>
              </h1>
              <p>Four minds. No script. See what they make of it.</p>
            </div>
            <div className="survival-day">
              <span>{world && !isDaylight(world.time) ? "☾" : "☀"}</span>
              <strong>
                Day {world ? Math.floor(world.time / 900) + 1 : 1}
              </strong>
              <small>
                {world ? formatTime(world.time % 900) : "00:00"} ·{" "}
                {world && !isDaylight(world.time) ? "Night" : "Daylight"}
              </small>
            </div>
          </div>
          <div
            className="survival-time-controls"
            role="group"
            aria-label="Simulation time"
          >
            <button
              disabled={
                controlling ||
                !runtime ||
                !["running", "paused"].includes(runtime.status)
              }
              onClick={() =>
                void control(runtime?.status !== "paused", runtime?.speed ?? 1)
              }
            >
              {runtime?.status === "paused" ? "▶ Play" : "Ⅱ Pause"}
            </button>
            <label>
              Speed{" "}
              <select
                aria-label="Simulation speed"
                value={runtime?.speed ?? 1}
                disabled={
                  controlling ||
                  !runtime ||
                  !["running", "paused"].includes(runtime.status)
                }
                onChange={(e) =>
                  void control(
                    runtime?.status === "paused",
                    Number(e.target.value),
                  )
                }
              >
                {[0.25, 0.5, 1, 2, 4, 8].map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}×
                  </option>
                ))}
              </select>
            </label>
            <small>Shared time · Model responses take real time</small>
          </div>
          {controlError && <p role="alert">{controlError}</p>}
          <div className="survival-supplies" aria-label="Island resources">
            {(
              [
                ["tree", "Wood"],
                ["rock", "Stone"],
                ["bush", "Berries"],
              ] as const
            ).map(([kind, label]) => (
              <span key={kind}>
                <strong>
                  {world?.resources
                    .filter((r) => r.kind === kind)
                    .reduce((sum, r) => sum + r.remaining, 0) ?? 0}
                </strong>{" "}
                {label} available
              </span>
            ))}
            <small>
              Berries regrow in 1 day · Trees in 2 · Stone is finite
            </small>
          </div>
          <div className="survival-viewport">
            {world ? (
              <SceneBoundary>
                <Suspense
                  fallback={
                    <div className="survival-loading">
                      Preparing the island…
                    </div>
                  }
                >
                  <SurvivalScene
                    world={world}
                    selected={selected}
                    thinking={runtime?.thinking ?? []}
                    onSelect={setSelected}
                    reset={reset}
                  />
                </Suspense>
              </SceneBoundary>
            ) : (
              <div className="survival-loading">
                {error ?? "Connecting to the island…"}
              </div>
            )}
            <div className="survival-map-label">
              <i /> THE CLEARING <span>24 × 24</span>
            </div>
            <div className="survival-camera">
              <span>Drag to orbit · Scroll to explore</span>
              <button type="button" onClick={() => setReset((v) => v + 1)}>
                Reset view ↗
              </button>
            </div>
          </div>
          {(error || runtime?.status !== "running") && (
            <div className="survival-notice" role="status">
              <span>◇</span>
              <div>
                {error ?? runtime?.message ?? "Connecting…"}
                {runtime?.status === "unconfigured" && (
                  <small>
                    Add the provider API keys to backend/.env and restart. Actor
                    models are configured in backend/survival.models.json.
                  </small>
                )}
              </div>
            </div>
          )}
          <div className="survival-facts">
            <div>
              <strong>
                {world?.bots.filter((b) => b.health > 0).length ?? 4}
                <span>/ {world?.bots.length ?? 4}</span>
              </strong>
              <small>Survivors</small>
            </div>
            <div>
              <strong>
                {world?.structures.filter((s) => s.kind === "shelter").length ??
                  0}
              </strong>
              <small>Shelters built</small>
            </div>
            <div>
              <strong>{runtime?.decisions ?? 0}</strong>
              <small>Decisions made</small>
            </div>
            <div>
              <strong>
                {world?.events.filter((e) => e.kind === "speech").length ?? 0}
              </strong>
              <small>Recent conversations</small>
            </div>
          </div>
          <section className="survival-journal">
            <div className="survival-section-title">
              <h2>Life on the island</h2>
              <div role="group" aria-label="Journal filter">
                <button
                  aria-pressed={journal === "all"}
                  onClick={() => setJournal("all")}
                >
                  All events
                </button>
                <button
                  aria-pressed={journal === "speech"}
                  onClick={() => setJournal("speech")}
                >
                  Conversations
                </button>
              </div>
            </div>
            <div className="survival-event-list">
              {events.length ? (
                events.map((event) => {
                  const speaker = world?.bots.find((b) => b.id === event.botId);
                  return (
                    <article key={event.id}>
                      <time>{formatTime(event.time)}</time>
                      <i style={{ background: speaker?.color }} />
                      <div>
                        <strong>{speaker?.name}</strong>
                        <small className="survival-event-model">
                          {event.model}
                        </small>
                        <p>
                          {event.kind === "speech"
                            ? `“${event.text}”`
                            : event.text}
                        </p>
                      </div>
                      <span>{event.kind === "speech" ? "SPOKE" : "ACTED"}</span>
                    </article>
                  );
                })
              ) : (
                <div className="survival-empty">
                  <span>↳</span>
                  <p>
                    {journal === "speech"
                      ? "Their first conversation is still ahead."
                      : "Every action leaves a mark. Their story starts here."}
                  </p>
                </div>
              )}
            </div>
          </section>
        </section>
        <aside className="survival-sidebar">
          <div className="survival-section-title">
            <h2>The inhabitants</h2>
            <span>{world?.bots.length ?? 4}</span>
          </div>
          <p className="survival-sidebar-intro">
            Each survivor sees, remembers, and decides independently.
          </p>
          <div className="survival-inhabitants">
            {world?.bots.map((b) => (
              <button
                className={`survival-person ${selected === b.id ? "selected" : ""}`}
                key={b.id}
                onClick={() => setSelected(b.id)}
                aria-pressed={selected === b.id}
              >
                <span
                  className="survival-portrait"
                  style={{ background: b.color }}
                >
                  {b.name[0]}
                </span>
                <span>
                  <strong>{b.name}</strong>
                  <small>
                    {b.health <= 0
                      ? "Deceased"
                      : runtime?.thinking.includes(b.id)
                        ? "Considering the next move…"
                        : b.task
                          ? b.task.action.type
                          : running
                            ? "Observing"
                            : "Waiting"}
                  </small>
                </span>
                <span className="survival-person-arrow">↗</span>
              </button>
            ))}
          </div>
          {bot && (
            <section className="survival-inspector">
              <p className="survival-eyebrow">
                {bot.name.toUpperCase()} / CURRENT STATE
              </p>
              <div className="survival-meter">
                <label htmlFor="survival-health">
                  Health <span>{Math.ceil(bot.health)}%</span>
                </label>
                <meter
                  id="survival-health"
                  min={0}
                  max={100}
                  value={bot.health}
                />
              </div>
              <div className="survival-meter hunger">
                <label htmlFor="survival-hunger">
                  Hunger <span>{Math.ceil(bot.hunger)}%</span>
                </label>
                <meter
                  id="survival-hunger"
                  min={0}
                  max={100}
                  value={bot.hunger}
                />
              </div>
              <div className="survival-location">
                <span>
                  ⌖ {bot.x.toFixed(1)}, {bot.z.toFixed(1)}
                </span>
                <span>
                  {world && sheltered(world, bot)
                    ? "Under shelter"
                    : "Outdoors"}
                </span>
              </div>
              <div className="survival-actor-model">
                <span>CONTROLLING MODEL</span>
                <strong>{bot.model}</strong>
                <small>Change this actor in survival.models.json</small>
              </div>
              <h3>Current intention</h3>
              <p className="survival-plan">“{bot.plan}”</p>
              <h3>Carrying</h3>
              <div className="survival-inventory">
                {Object.entries(bot.inventory).map(([item, count]) => (
                  <div key={item} className={count ? "has-item" : ""}>
                    <span>
                      {
                        {
                          wood: "▥",
                          stone: "◆",
                          berries: "●",
                          axe: "⚒",
                          shelter: "⌂",
                        }[item]
                      }
                    </span>
                    <strong>{count}</strong>
                    <small>{item}</small>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="survival-rules">
            <p className="survival-eyebrow">THE RULES ARE SIMPLE</p>
            <h3>Survive. The rest is up to them.</h3>
            <p>
              Gather food and materials. Craft tools. Build shelter before
              nightfall. Work together—or find another way.
            </p>
            <div>
              <span>Stone axe</span>
              <small>2 wood + 2 stone</small>
            </div>
            <div>
              <span>Shelter kit</span>
              <small>6 wood + 2 stone</small>
            </div>
            <div>
              <span>Wood wall</span>
              <small>2 wood</small>
            </div>
          </section>
          <footer className="survival-runtime">
            <span>Independent actor models</span>
            <p>
              {runtime?.decisions ?? 0} decisions ·{" "}
              {(
                (runtime?.inputTokens ?? 0) + (runtime?.outputTokens ?? 0)
              ).toLocaleString()}{" "}
              tokens
            </p>
            <small>
              {runtime?.savedAt
                ? "World checkpoint saved"
                : "Waiting for first checkpoint"}
              {runtime?.lastLatencyMs != null
                ? ` · Last decision ${(runtime.lastLatencyMs / 1000).toFixed(1)}s`
                : ""}
            </small>
          </footer>
        </aside>
      </div>
    </main>
  );
}
