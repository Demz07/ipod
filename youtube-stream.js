// Resolve a YouTube video ID to an audio-only stream URL that a native <audio>
// element can play. Native audio (unlike the embedded YouTube video player)
// keeps playing when the app is backgrounded or the screen is locked.
//
// Streams come from public Piped / Invidious instances. These are third-party
// services: they can be slow, rate limited, or offline, so several are tried
// in parallel and the app falls back to the embedded player if all fail.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.YouTubeStream = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULT_SOURCES = [
    { type: "piped", base: "https://pipedapi.kavin.rocks" },
    { type: "piped", base: "https://api.piped.private.coffee" },
    { type: "invidious", base: "https://inv.tux.pizza" },
  ];
  const DEFAULT_TTL_MS = 60 * 60 * 1000;
  const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

  const validId = (id) => typeof id === "string" && /^[\w-]{11}$/.test(id);

  // AAC in MP4 is the most widely supported format for background playback
  // (notably on iOS), so prefer it over WebM/Opus when both are available.
  function rankStream(stream, canPlayType) {
    const mime = String(stream.mimeType || "").toLowerCase();
    if (!stream.url || !mime.startsWith("audio/")) return -1;
    const support = canPlayType ? canPlayType(mime) : "maybe";
    if (!support) return -1;
    const containerScore = mime.startsWith("audio/mp4") ? 2 : 1;
    return containerScore * 1e7 + Math.min(Number(stream.bitrate) || 0, 9e6);
  }

  function pickBestStream(streams, canPlayType) {
    let best = null;
    let bestRank = -1;
    for (const stream of Array.isArray(streams) ? streams : []) {
      if (!stream) continue;
      const rank = rankStream(stream, canPlayType);
      if (rank > bestRank) {
        best = stream;
        bestRank = rank;
      }
    }
    return best;
  }

  function parsePiped(data) {
    return (data && Array.isArray(data.audioStreams) ? data.audioStreams : []).map((s) => ({
      url: s && s.url,
      mimeType: s && (s.mimeType || ""),
      bitrate: s && s.bitrate,
    }));
  }

  function parseInvidious(data, base) {
    return (data && Array.isArray(data.adaptiveFormats) ? data.adaptiveFormats : []).map((f) => {
      let url = f && f.url;
      // With ?local=true Invidious may return instance-relative proxy URLs.
      try { if (url) url = new URL(url, base).href; } catch (error) { url = null; }
      return {
        url,
        mimeType: f && String(f.type || "").split(";")[0].trim(),
        bitrate: f && Number(f.bitrate),
      };
    });
  }

  function endpointFor(source, ytId) {
    const base = source.base.replace(/\/+$/, "");
    if (source.type === "invidious") {
      // local=true proxies media through the instance; direct googlevideo
      // URLs are locked to the instance's IP and would not play here.
      return `${base}/api/v1/videos/${ytId}?local=true&fields=adaptiveFormats`;
    }
    return `${base}/streams/${ytId}`;
  }

  // Signed stream URLs carry an `expire` timestamp (seconds).
  function expiryFor(url, now, ttlMs) {
    let expires = now + ttlMs;
    try {
      const expireParam = Number(new URL(url).searchParams.get("expire"));
      if (Number.isFinite(expireParam) && expireParam > 0) {
        expires = Math.min(expires, expireParam * 1000 - EXPIRY_MARGIN_MS);
      }
    } catch (error) {}
    return expires;
  }

  function createResolver(options = {}) {
    const fetchImpl = options.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const sources = options.sources || DEFAULT_SOURCES;
    const timeoutMs = options.timeoutMs || 4500;
    const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    const now = options.now || (() => Date.now());
    const canPlayType = options.canPlayType || null;
    const cache = new Map();
    const inflight = new Map();

    async function trySource(source, ytId, signal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal) {
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }
      const timer = setTimeout(abort, timeoutMs);
      try {
        const res = await fetchImpl(endpointFor(source, ytId), { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const streams = source.type === "invidious" ? parseInvidious(data, source.base) : parsePiped(data);
        const best = pickBestStream(streams, canPlayType);
        if (!best) throw new Error("No playable audio stream");
        return { url: best.url, mimeType: best.mimeType, source: source.base };
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", abort);
      }
    }

    function peek(ytId) {
      const entry = cache.get(ytId);
      if (!entry) return null;
      if (entry.expires <= now()) {
        cache.delete(ytId);
        return null;
      }
      return entry;
    }

    function resolve(ytId, { force = false } = {}) {
      if (!validId(ytId)) return Promise.reject(new Error("Invalid YouTube ID"));
      if (!fetchImpl) return Promise.reject(new Error("fetch is unavailable"));
      if (force) cache.delete(ytId);
      const cached = peek(ytId);
      if (cached) return Promise.resolve(cached);
      if (inflight.has(ytId)) return inflight.get(ytId);

      const winner = new AbortController();
      const attempt = Promise.any(sources.map((source) => trySource(source, ytId, winner.signal)))
        .then((result) => {
          winner.abort(); // Cancel slower instances once one succeeds.
          const entry = { ...result, expires: expiryFor(result.url, now(), ttlMs) };
          cache.set(ytId, entry);
          return entry;
        })
        .catch((error) => {
          throw new Error(
            "No audio stream available" + (error && error.errors ? ` (${error.errors.length} sources failed)` : ""),
          );
        })
        .finally(() => inflight.delete(ytId));
      inflight.set(ytId, attempt);
      return attempt;
    }

    function invalidate(ytId) {
      cache.delete(ytId);
    }

    return { resolve, peek, invalidate };
  }

  return { DEFAULT_SOURCES, createResolver, pickBestStream, endpointFor };
});
