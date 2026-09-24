/** First-party events only; no persistent visitor ID or third-party requests. */
export function initAnalytics() {
  if (!["gaasd.com", "127.0.0.1", "localhost"].includes(location.hostname))
    return;
  const video = document.querySelector("#media-video");
  if (!(video instanceof HTMLVideoElement)) return;
  const enabled = () => {
    if (navigator.webdriver || navigator.doNotTrack === "1") return false;
    try {
      return window.localStorage.getItem("gaasd-analytics-disabled") !== "1";
    } catch {
      return true;
    }
  };
  if (!enabled()) return;
  const visitId = crypto.randomUUID();
  let sessionId = crypto.randomUUID();
  try {
    const previous = JSON.parse(
      window.sessionStorage.getItem("gaasd-session") || "null",
    );
    if (
      previous &&
      typeof previous.id === "string" &&
      Date.now() - previous.last < 1800000
    )
      sessionId = previous.id;
    window.sessionStorage.setItem(
      "gaasd-session",
      JSON.stringify({ id: sessionId, last: Date.now() }),
    );
  } catch {
    /* Storage may be disabled; a transient ID still works. */
  }
  const base = {
    visit_id: visitId,
    session_id: sessionId,
    path: location.pathname,
    referrer: document.referrer,
  };
  /** @param {Record<string, unknown>} fields */
  const send = (fields) => {
    if (!enabled()) return;
    const body = JSON.stringify({ ...base, ...fields });
    try {
      window.sessionStorage.setItem(
        "gaasd-session",
        JSON.stringify({ id: sessionId, last: Date.now() }),
      );
    } catch {
      /* Optional session continuity. */
    }
    try {
      if (
        navigator.sendBeacon(
          "/api/analytics/events",
          new Blob([body], { type: "application/json" }),
        )
      )
        return;
    } catch {
      /* Fall back without affecting playback. */
    }
    void fetch("/api/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  };
  send({ kind: "page_view" });
  /** @type {{ id: string, videoId: string, started: boolean, watched: number, position: number, lastPosition: number, lastClock: number, lastSent: number } | null} */
  let active = null;
  const sample = () => {
    if (!active) return;
    const clock = performance.now();
    const elapsed = (clock - active.lastClock) / 1000;
    const advance = video.currentTime - active.lastPosition;
    if (
      active.started &&
      enabled() &&
      document.visibilityState === "visible" &&
      !video.paused &&
      !video.seeking &&
      elapsed > 0 &&
      elapsed < 3 &&
      advance > 0 &&
      advance <= elapsed * video.playbackRate + 0.4
    )
      active.watched += Math.min(elapsed, advance / video.playbackRate) * 1000;
    active.lastClock = clock;
    active.lastPosition = video.currentTime;
    active.position = Math.max(active.position, video.currentTime || 0);
  };
  /** @param {string} phase */
  const flush = (phase) => {
    sample();
    if (!active?.started) return;
    let played = 0;
    for (let index = 0; index < video.played.length; index += 1)
      played += video.played.end(index) - video.played.start(index);
    const coverage =
      Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(1, played / video.duration)
        : 0;
    send({
      kind: "video",
      phase,
      play_id: active.id,
      video_id: active.videoId,
      watched_ms: Math.round(active.watched),
      position: active.position,
      coverage,
    });
    active.lastSent = performance.now();
  };
  document.addEventListener("gaasd:video-selected", (event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== "string")
      return;
    flush("close");
    active = {
      id: crypto.randomUUID(),
      videoId: event.detail,
      started: false,
      watched: 0,
      position: 0,
      lastPosition: 0,
      lastClock: performance.now(),
      lastSent: 0,
    };
  });
  document.addEventListener("gaasd:video-closed", () => {
    flush("close");
    active = null;
  });
  video.addEventListener("playing", () => {
    if (!active) return;
    active.lastClock = performance.now();
    active.lastPosition = video.currentTime;
    if (!active.started) {
      active.started = true;
      flush("start");
    }
  });
  video.addEventListener("timeupdate", sample);
  video.addEventListener("seeking", sample);
  video.addEventListener("pause", () => flush("pause"));
  video.addEventListener("ended", () => flush("ended"));
  document.addEventListener("visibilitychange", () => flush("progress"));
  window.addEventListener("pagehide", () => flush("pause"));
  window.setInterval(() => {
    sample();
    if (
      active?.started &&
      !video.paused &&
      performance.now() - active.lastSent >= 10000
    )
      flush("progress");
  }, 1000);
}
