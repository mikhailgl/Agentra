import { useEffect, useMemo, useRef, useState } from "react";
import { formatTime } from "../format";
import { loadMatchLogs } from "../game/remotePersistence";
import type { ArenaState, MatchLog, MatchState } from "../game/types";

type GeneratedVideo = {
  id: string;
  matchNumber: number;
  title: string;
  format: "Short" | "Recap" | "Bot story";
  durationLabel: string;
  status: "Ready" | "Draft";
  winnerName: string;
  hook: string;
  beats: string[];
  tags: string[];
};

type RenderedVideo = {
  id: string;
  sourceVideoId: string;
  title: string;
  url: string;
  sizeBytes: number;
  createdAt: number;
  fileName: string;
  mimeType: string;
};

export function GeneratedVideosView({
  currentMatch,
  arenaState,
  onBackToArena,
  onOpenBots,
}: {
  currentMatch: MatchState | null;
  arenaState: ArenaState | null;
  onBackToArena: () => void;
  onOpenBots: () => void;
}) {
  const [logs, setLogs] = useState<MatchLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderingVideoId, setRenderingVideoId] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderedVideos, setRenderedVideos] = useState<RenderedVideo[]>([]);
  const renderedUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadMatchLogs(30)
      .then((nextLogs) => {
        if (!cancelled) {
          setLogs(nextLogs);
          setError(null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load generated videos.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [arenaState?.matchNumber, arenaState?.phase]);

  useEffect(() => {
    return () => {
      for (const url of renderedUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    const activeUrls = new Set(renderedVideos.map((video) => video.url));
    for (const url of renderedUrlsRef.current) {
      if (!activeUrls.has(url)) URL.revokeObjectURL(url);
    }
    renderedUrlsRef.current = renderedUrlsRef.current.filter((url) => activeUrls.has(url));
  }, [renderedVideos]);

  const videos = useMemo(() => {
    const generated = logs.flatMap(createVideosFromLog).slice(0, 36);
    if (generated.length > 0) {
      return generated;
    }
    return currentMatch ? createLiveDraftVideos(currentMatch, arenaState) : [createDemoVideo()];
  }, [arenaState, currentMatch, logs]);

  const featuredVideo = videos[0] ?? null;

  const handleCreateVideo = async (video: GeneratedVideo) => {
    setRenderingVideoId(video.id);
    setRenderError(null);
    try {
      const rendered = await renderGeneratedVideo(video);
      renderedUrlsRef.current.push(rendered.url);
      setRenderedVideos((existing) => [rendered, ...existing].slice(0, 6));
    } catch (createError) {
      setRenderError(createError instanceof Error ? createError.message : "Video generation failed.");
    } finally {
      setRenderingVideoId(null);
    }
  };

  return (
    <main className="videos-shell">
      <header className="videos-header">
        <div>
          <span>Generated Videos</span>
          <h1>Match cuts</h1>
        </div>
        <nav className="videos-nav" aria-label="Primary views">
          <button type="button" className="secondary-button" onClick={onBackToArena}>
            Arena
          </button>
          <button type="button" className="secondary-button" onClick={onOpenBots}>
            Bots
          </button>
          <button type="button" className="active">
            Videos
          </button>
        </nav>
      </header>

      {featuredVideo && (
        <section className="featured-video">
          <div className="video-frame">
            <div className="video-frame-grid" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="video-frame-copy">
              <span>{featuredVideo.format}</span>
              <strong>{featuredVideo.title}</strong>
              <small>{featuredVideo.hook}</small>
            </div>
          </div>
          <div className="featured-video-copy">
            <span>{featuredVideo.status} / Match #{featuredVideo.matchNumber}</span>
            <h2>{featuredVideo.winnerName}</h2>
            <p>{featuredVideo.hook}</p>
            <div className="video-tag-row">
              {featuredVideo.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            <button type="button" disabled={renderingVideoId !== null} onClick={() => void handleCreateVideo(featuredVideo)}>
              {renderingVideoId === featuredVideo.id ? "Creating..." : "Create video"}
            </button>
          </div>
        </section>
      )}

      <section className="videos-toolbar">
        <div>
          <span>Library</span>
          <strong>{videos.length}</strong>
        </div>
        <div>
          <span>Completed matches</span>
          <strong>{logs.length}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>{loading ? "Loading" : error ? "Offline" : "Ready"}</strong>
        </div>
      </section>

      {error && <p className="video-status-note" role="alert">{error}</p>}
      {renderError && <p className="video-status-note" role="alert">{renderError}</p>}

      {renderedVideos.length > 0 && (
        <section className="rendered-video-library" aria-label="Created videos">
          <div className="rendered-video-heading">
            <span>Session exports</span>
            <strong>{renderedVideos.length}</strong>
          </div>
          <div className="rendered-video-grid">
            {renderedVideos.map((video) => (
              <article key={video.id} className="rendered-video-card">
                <video src={video.url} controls playsInline preload="metadata" aria-label={`Generated video: ${video.title}`} />
                <div>
                  <strong>{video.title}</strong>
                  <span>{Math.max(1, Math.round(video.sizeBytes / 1024)).toLocaleString()} KB {video.mimeType.includes("mp4") ? "MP4" : "WebM"}</span>
                  <a className="secondary-button" href={video.url} download={video.fileName}>Download</a>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {videos.length === 0 && !loading ? (
        <section className="empty-video-library">
          <h2>No videos yet</h2>
          <p>Waiting for completed matches.</p>
        </section>
      ) : (
        <section className="video-grid">
          {videos.map((video) => (
            <article key={video.id} className="video-card">
              <div className="video-thumb">
                <span>{video.format}</span>
                <strong>{video.durationLabel}</strong>
              </div>
              <div className="video-card-body">
                <div className="video-card-title">
                  <div>
                    <span>Match #{video.matchNumber}</span>
                    <h2>{video.title}</h2>
                  </div>
                  <strong>{video.status}</strong>
                </div>
                <p>{video.hook}</p>
                <ol>
                  {video.beats.slice(0, 4).map((beat) => (
                    <li key={beat}>{beat}</li>
                  ))}
                </ol>
                <div className="video-tag-row">
                  {video.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <button type="button" className="secondary-button" disabled={renderingVideoId !== null} onClick={() => void handleCreateVideo(video)}>
                  {renderingVideoId === video.id ? "Creating..." : "Create video"}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function createDemoVideo(): GeneratedVideo {
  return {
    id: "demo-hunter-games-cut",
    matchNumber: 0,
    title: "Hunter Games proof cut",
    format: "Short",
    durationLabel: "0:07",
    status: "Draft",
    winnerName: "Arena demo",
    hook: "A first generated edit built from match beats, title cards, and highlight captions.",
    beats: [
      "Bots enter the arena with 25 credits on the line.",
      "A sponsor drop changes the fight.",
      "The camera cuts to the final chase.",
      "Last bot standing claims the prize pool.",
    ],
    tags: ["demo", "webm", "highlight"],
  };
}

function createVideosFromLog(log: MatchLog): GeneratedVideo[] {
  const winnerName = log.winnerName ?? "No survivor";
  const topHighlights = log.highlights
    .filter((event) => event.importance >= 70)
    .sort((a, b) => b.importance - a.importance || a.timestamp - b.timestamp);
  const fallbackEvents = log.events.filter((event) => event.kind === "kill" || event.kind === "winner" || event.kind === "sponsor" || event.kind === "loot");
  const primaryBeats = [...topHighlights.map((event) => event.message), ...fallbackEvents.map((event) => event.message)].filter(Boolean);
  const winner = log.botResults.find((bot) => bot.botId === log.winnerBotId) ?? log.botResults[0];
  const strongest = [...log.botResults].sort((a, b) => b.kills - a.kills || b.damageDealt - a.damageDealt)[0];

  return [
    {
      id: `${log.id}-short`,
      matchNumber: log.matchNumber,
      title: `${winnerName}'s final stand`,
      format: "Short",
      durationLabel: "0:45",
      status: "Ready",
      winnerName,
      hook: primaryBeats[0] ?? `${winnerName} outlasted the field in ${formatTime(log.durationMs)}.`,
      beats: primaryBeats,
      tags: createTags(log, ["vertical", "highlight"]),
    },
    {
      id: `${log.id}-recap`,
      matchNumber: log.matchNumber,
      title: `Match ${log.matchNumber} arena recap`,
      format: "Recap",
      durationLabel: "3:20",
      status: "Ready",
      winnerName,
      hook: `${log.entrants.length} bots entered. ${winnerName} left with ${winner?.carriedCredits ?? 0} credits.`,
      beats: createRecapBeats(log),
      tags: createTags(log, ["recap", "commentary"]),
    },
    {
      id: `${log.id}-bot-story`,
      matchNumber: log.matchNumber,
      title: `${strongest?.name ?? winnerName}: damage report`,
      format: "Bot story",
      durationLabel: "1:30",
      status: "Ready",
      winnerName: strongest?.name ?? winnerName,
      hook: strongest ? `${strongest.name} finished with ${strongest.kills} kills and ${strongest.damageDealt} damage.` : `${winnerName} became the story of the match.`,
      beats: createBotStoryBeats(log, strongest),
      tags: createTags(log, ["bot arc", "analysis"]),
    },
  ];
}

function createLiveDraftVideos(match: MatchState, arenaState: ArenaState | null): GeneratedVideo[] {
  const leader = [...match.bots].sort((a, b) => b.kills - a.kills || b.damageDealt - a.damageDealt || b.survivalTimeMs - a.survivalTimeMs)[0];
  const beats = [...match.matchEvents.map((event) => event.message), ...match.events.map((event) => event.message)].filter(Boolean);
  return [
    {
      id: `${match.id}-live-draft`,
      matchNumber: arenaState?.matchNumber ?? 0,
      title: `${leader?.name ?? "Arena"} live cut`,
      format: "Short",
      durationLabel: "Draft",
      status: "Draft",
      winnerName: leader?.name ?? "Live match",
      hook: beats[0] ?? "The current match is building a highlight reel.",
      beats,
      tags: ["live", "draft", `${match.bots.filter((bot) => bot.alive).length} alive`],
    },
  ];
}

function createRecapBeats(log: MatchLog): string[] {
  const firstKill = log.highlights.find((event) => event.type === "first_blood" || event.type === "kill")?.message;
  const topKiller = [...log.botResults].sort((a, b) => b.kills - a.kills || b.damageDealt - a.damageDealt)[0];
  return [
    `${log.entrants.length} entrants loaded into the arena.`,
    firstKill,
    topKiller ? `${topKiller.name} led the damage table with ${topKiller.kills} kills.` : null,
    log.winnerName ? `${log.winnerName} survived for ${formatTime(log.durationMs)}.` : "The match ended with no survivor.",
  ].filter((beat): beat is string => Boolean(beat));
}

function createBotStoryBeats(log: MatchLog, bot: MatchLog["botResults"][number] | undefined): string[] {
  if (!bot) {
    return createRecapBeats(log);
  }

  const botHighlights = log.highlights.filter((event) => event.botId === bot.botId || event.targetBotId === bot.botId).map((event) => event.message);
  return [
    `${bot.name} survived ${formatTime(bot.survivalTimeMs)}.`,
    `${bot.kills} kills / ${bot.damageDealt} damage / ${Math.round(bot.finalHealth)} final health.`,
    ...botHighlights,
  ];
}

function createTags(log: MatchLog, tags: string[]): string[] {
  const killCount = log.botResults.reduce((sum, bot) => sum + bot.kills, 0);
  return [`${killCount} kills`, formatTime(log.durationMs), ...tags].slice(0, 5);
}

async function renderGeneratedVideo(video: GeneratedVideo): Promise<RenderedVideo> {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    throw new Error("This browser cannot create videos with MediaRecorder.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas rendering is unavailable.");
  }

  const stream = canvas.captureStream(30);
  const mimeType = getSupportedVideoMimeType();
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const durationMs = 7_000;

  const complete = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = () => reject(new Error("Video recording failed."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "video/webm" }));
  });

  recorder.start();
  const startedAt = performance.now();

  await new Promise<void>((resolve) => {
    const draw = (now: number) => {
      const elapsedMs = now - startedAt;
      const progress = Math.min(1, elapsedMs / durationMs);
      drawVideoFrame(context, video, progress, elapsedMs);
      if (progress < 1) {
        window.requestAnimationFrame(draw);
        return;
      }
      resolve();
    };
    window.requestAnimationFrame(draw);
  });

  recorder.stop();
  for (const track of stream.getTracks()) {
    track.stop();
  }

  const blob = await complete;
  if (blob.size === 0) {
    throw new Error("The browser produced an empty video. Please try again.");
  }
  const outputMimeType = recorder.mimeType || mimeType || blob.type || "video/webm";
  const extension = outputMimeType.includes("mp4") ? "mp4" : "webm";
  return {
    id: `rendered-${video.id}-${Date.now()}`,
    sourceVideoId: video.id,
    title: video.title,
    url: URL.createObjectURL(blob),
    sizeBytes: blob.size,
    createdAt: Date.now(),
    fileName: `${slugify(video.title)}.${extension}`,
    mimeType: outputMimeType,
  };
}

function getSupportedVideoMimeType(): string {
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4;codecs=avc1.42E01E", "video/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "botarena-video";
}

function drawVideoFrame(context: CanvasRenderingContext2D, video: GeneratedVideo, progress: number, elapsedMs: number): void {
  const width = context.canvas.width;
  const height = context.canvas.height;
  const beatIndex = Math.min(video.beats.length - 1, Math.floor(progress * Math.max(1, video.beats.length)));
  const beat = video.beats[Math.max(0, beatIndex)] ?? video.hook;
  const pulse = 0.5 + Math.sin(elapsedMs / 280) * 0.5;

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#09100d");
  background.addColorStop(0.48, "#16231a");
  background.addColorStop(1, "#101827");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  drawArenaPanels(context, progress, pulse);

  context.fillStyle = "rgba(5, 9, 7, 0.58)";
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#f2c453";
  context.font = "800 28px Inter, system-ui, sans-serif";
  context.fillText(video.format.toUpperCase(), 72, 82);

  context.fillStyle = "#edf4ee";
  context.font = "900 78px Inter, system-ui, sans-serif";
  drawWrappedText(context, video.title, 72, 172, 790, 84, 2);

  context.fillStyle = "#dbe5df";
  context.font = "500 32px Inter, system-ui, sans-serif";
  drawWrappedText(context, beat, 72, 378, 760, 42, 3);

  context.fillStyle = "rgba(242, 196, 83, 0.16)";
  context.fillRect(72, 616, 880, 12);
  context.fillStyle = "#f2c453";
  context.fillRect(72, 616, 880 * progress, 12);

  context.fillStyle = "#9ea9a1";
  context.font = "800 24px Inter, system-ui, sans-serif";
  context.fillText(`MATCH #${video.matchNumber || "DEMO"}`, 72, 672);

  context.fillStyle = "#ffffff";
  context.font = "900 34px Inter, system-ui, sans-serif";
  context.fillText(video.winnerName, 950, 672);
}

function drawArenaPanels(context: CanvasRenderingContext2D, progress: number, pulse: number): void {
  const panels = [
    { x: 860, y: 72, w: 300, h: 180, color: "#263a29" },
    { x: 960, y: 230, w: 230, h: 210, color: "#173449" },
    { x: 820, y: 404, w: 330, h: 140, color: "#4a3516" },
  ];

  panels.forEach((panel, index) => {
    context.save();
    context.translate(panel.x + Math.sin(progress * Math.PI * 2 + index) * 18, panel.y + Math.cos(progress * Math.PI * 2 + index) * 12);
    context.fillStyle = panel.color;
    context.globalAlpha = 0.78;
    context.fillRect(0, 0, panel.w, panel.h);
    context.strokeStyle = `rgba(242, 196, 83, ${0.22 + pulse * 0.24})`;
    context.lineWidth = 4;
    context.strokeRect(0, 0, panel.w, panel.h);
    context.restore();
  });

  for (let index = 0; index < 10; index += 1) {
    const angle = progress * Math.PI * 2 + index * 0.72;
    const x = 990 + Math.cos(angle) * (120 + (index % 3) * 28);
    const y = 320 + Math.sin(angle * 1.2) * (82 + (index % 2) * 24);
    context.fillStyle = index % 3 === 0 ? "#f2c453" : index % 3 === 1 ? "#38bdf8" : "#ef4444";
    context.beginPath();
    context.arc(x, y, 10 + (index % 2) * 5, 0, Math.PI * 2);
    context.fill();
  }
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): void {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (context.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) {
        break;
      }
    } else {
      line = testLine;
    }
  }

  if (line && lines.length < maxLines) {
    lines.push(line);
  }

  lines.slice(0, maxLines).forEach((entry, index) => {
    context.fillText(entry, x, y + index * lineHeight);
  });
}
