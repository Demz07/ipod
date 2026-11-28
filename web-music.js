// Music from other sites that plays as plain audio files/streams, so it keeps
// playing in the background like local songs:
//   - Audius (audius.co): free streaming music, open API, no key needed
//   - Internet Archive (archive.org): free/public-domain albums and live sets
//   - Radio Browser (radio-browser.info): thousands of live internet radio stations
//   - Direct audio links (.mp3/.m4a/.ogg/... URLs, archive.org and audius.co pages)
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WebMusic = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const APP_NAME = "ipod-classic";
  const AUDIUS_HOSTS = ["https://api.audius.co", "https://discoveryprovider.audius.co"];
  const RADIO_HOSTS = [
    "https://de1.api.radio-browser.info",
    "https://fi1.api.radio-browser.info",
    "https://de2.api.radio-browser.info",
  ];
  const LIBRARY_KEY = "ipod-classic-web-library-v1";
  const MAX_RESULTS = 40;
  const enc = encodeURIComponent;

  const text = (value, fallback = "") => {
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" && first.trim() ? first.trim().slice(0, 300) : fallback;
  };
  const httpsOnly = (url) => (typeof url === "string" && /^https:\/\//i.test(url) ? url : "");

  async function getJson(fetchImpl, url, timeoutMs = 9000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Try mirror hosts in order until one answers.
  async function fromHosts(fetchImpl, hosts, path) {
    let lastError = null;
    for (const host of hosts) {
      try {
        return { host, data: await getJson(fetchImpl, host + path) };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("No server available");
  }

  // ---- Audius -------------------------------------------------------------
  function audiusTrack(t, host) {
    if (!t || !t.id || t.is_streamable === false || (t.access && t.access.stream === false)) return null;
    const art = t.artwork || {};
    return {
      // The /stream endpoint redirects to a freshly signed file URL, so the
      // saved link keeps working (the signed URLs in search results expire).
      url: `${host}/v1/tracks/${enc(t.id)}/stream?app_name=${APP_NAME}`,
      title: text(t.title, "Untitled"),
      artist: text(t.user && (t.user.name || t.user.handle), "Audius"),
      cover: httpsOnly(art["480x480"] || art["150x150"] || ""),
      source: "Audius",
    };
  }

  async function audiusList(fetchImpl, path) {
    const { host, data } = await fromHosts(fetchImpl, AUDIUS_HOSTS, path);
    const list = Array.isArray(data && data.data) ? data.data : [];
    return list.map((t) => audiusTrack(t, host)).filter(Boolean).slice(0, MAX_RESULTS);
  }

  const audius = {
    search: (fetchImpl, query) =>
      audiusList(fetchImpl, `/v1/tracks/search?query=${enc(query)}&app_name=${APP_NAME}&limit=60`),
    trending: (fetchImpl) => audiusList(fetchImpl, `/v1/tracks/trending?app_name=${APP_NAME}&limit=60`),
    // Resolve an audius.co track or playlist page URL.
    async resolve(fetchImpl, pageUrl) {
      const { host, data } = await fromHosts(fetchImpl, AUDIUS_HOSTS, `/v1/resolve?url=${enc(pageUrl)}&app_name=${APP_NAME}`);
      const item = data && data.data;
      const items = Array.isArray(item) ? item : [item];
      const tracks = [];
      for (const entry of items) {
        if (!entry) continue;
        if (Array.isArray(entry.tracks)) tracks.push(...entry.tracks.map((t) => audiusTrack(t, host)));
        else if (entry.playlist_name && entry.id) {
          const list = await getJson(fetchImpl, `${host}/v1/playlists/${enc(entry.id)}/tracks?app_name=${APP_NAME}`);
          tracks.push(...(Array.isArray(list && list.data) ? list.data : []).map((t) => audiusTrack(t, host)));
        } else tracks.push(audiusTrack(entry, host));
      }
      return tracks.filter(Boolean);
    },
  };

  // ---- Internet Archive ---------------------------------------------------
  const ARCHIVE_FORMAT_RANK = { "VBR MP3": 4, MP3: 3, "128Kbps MP3": 3, "Ogg Vorbis": 2, "64Kbps MP3": 1 };

  const archive = {
    // Results are albums/items; open one to list its tracks.
    async search(fetchImpl, query) {
      const q = `(${query}) AND mediatype:(audio) AND format:("VBR MP3")`;
      const url =
        `https://archive.org/advancedsearch.php?q=${enc(q)}` +
        `&fl[]=identifier&fl[]=title&fl[]=creator&sort[]=${enc("downloads desc")}&rows=${MAX_RESULTS}&output=json`;
      const data = await getJson(fetchImpl, url);
      const docs = (data && data.response && Array.isArray(data.response.docs)) ? data.response.docs : [];
      return docs
        .filter((d) => d && typeof d.identifier === "string")
        .map((d) => ({
          kind: "album",
          id: d.identifier,
          title: text(d.title, d.identifier),
          artist: text(d.creator, "Internet Archive"),
          cover: `https://archive.org/services/img/${enc(d.identifier)}`,
          source: "Internet Archive",
        }));
    },

    async album(fetchImpl, identifier) {
      const data = await getJson(fetchImpl, `https://archive.org/metadata/${enc(identifier)}`);
      const meta = (data && data.metadata) || {};
      const files = Array.isArray(data && data.files) ? data.files : [];
      // Originals (e.g. FLAC) and their MP3 derivatives describe the same
      // track: keep one playable file per original, preferring VBR MP3.
      const best = new Map();
      for (const f of files) {
        if (!f || typeof f.name !== "string") continue;
        const rank = ARCHIVE_FORMAT_RANK[f.format] || (/\.mp3$/i.test(f.name) ? 2 : 0);
        if (!rank) continue;
        const key = f.source === "derivative" && f.original ? f.original : f.name;
        const current = best.get(key);
        if (!current || rank > current.rank) best.set(key, { file: f, rank });
      }
      const cover = `https://archive.org/services/img/${enc(identifier)}`;
      const albumArtist = text(meta.creator, "Internet Archive");
      return [...best.values()]
        .map(({ file }) => file)
        .sort((a, b) => (parseInt(a.track, 10) || 1e6) - (parseInt(b.track, 10) || 1e6) || a.name.localeCompare(b.name))
        .slice(0, 300)
        .map((f) => ({
          url: `https://archive.org/download/${enc(identifier)}/${f.name.split("/").map(enc).join("/")}`,
          title: text(f.title, f.name.split("/").pop().replace(/\.[^.]+$/, "").replace(/_/g, " ")),
          artist: text(f.artist || f.creator, albumArtist),
          cover,
          source: "Internet Archive",
        }));
    },
  };

  // ---- Radio Browser ------------------------------------------------------
  function radioStation(s) {
    const url = httpsOnly(s && s.url_resolved); // http streams are blocked on https pages
    if (!url) return null;
    const tag = text(String(s.tags || "").split(",")[0]);
    return {
      url,
      title: text(s.name, "Radio Station"),
      artist: [text(s.country), tag].filter(Boolean).join(" • ") || "Internet Radio",
      cover: httpsOnly(s.favicon),
      source: "Radio",
      live: true,
      noCors: true, // Most stations send no CORS headers.
    };
  }

  const radio = {
    async search(fetchImpl, query) {
      const q = String(query || "").trim();
      const opts = "limit=80&hidebroken=true&order=clickcount&reverse=true";
      const paths = q
        ? [`/json/stations/search?name=${enc(q)}&${opts}`, `/json/stations/search?tag=${enc(q.toLowerCase())}&${opts}`]
        : [`/json/stations/topclick/80`];
      const lists = await Promise.all(paths.map((p) => fromHosts(fetchImpl, RADIO_HOSTS, p).then((r) => r.data, () => [])));
      const seen = new Set();
      const stations = [];
      for (const s of lists.flat()) {
        const station = radioStation(s);
        if (!station || seen.has(station.url)) continue;
        seen.add(station.url);
        stations.push(station);
      }
      return stations.slice(0, MAX_RESULTS);
    },
  };

  // ---- Pasted links -------------------------------------------------------
  function parseLinks(input) {
    const result = { direct: [], archive: [], audius: [] };
    const seen = new Set();
    for (const token of String(input || "").split(/[\s,]+/)) {
      let url;
      try { url = new URL(token); } catch (error) { continue; }
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      url.protocol = "https:"; // http media is blocked on the https app
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      const host = url.hostname.replace(/^www\./, "");
      const details = host === "archive.org" && url.pathname.match(/^\/details\/([^/]+)/);
      if (details) result.archive.push(decodeURIComponent(details[1]));
      else if (host === "audius.co") result.audius.push(url.href);
      else {
        const file = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
        result.direct.push({
          url: url.href,
          title: file.replace(/\.[^.]+$/, "").replace(/[_+]/g, " ").trim() || host,
          artist: host,
          cover: "",
          source: "Link",
          noCors: true,
        });
      }
    }
    return result;
  }

  // ---- Saved library ------------------------------------------------------
  // Web songs are saved next to the YouTube library. Each entry stores its
  // position among saved songs so the mixed order is restored exactly.
  function clean(track) {
    return {
      url: track.url.slice(0, 2000),
      title: text(track.title, "Untitled"),
      artist: text(track.artist, ""),
      cover: httpsOnly(track.coverUrl !== undefined ? track.coverUrl : track.cover).slice(0, 2000),
      source: text(track.source, "Web"),
      live: track.live === true,
      noCors: track.noCors === true,
    };
  }
  const validUrl = (url) => typeof url === "string" && /^https:\/\//i.test(url);

  function read(storage) {
    const raw = storage.getItem(LIBRARY_KEY);
    if (raw === null) return [];
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Array.isArray(data.tracks)) throw new Error("Invalid saved web library");
    return data.tracks
      .filter((t) => t && validUrl(t.url))
      .map((t) => ({ position: Number.isInteger(t.position) && t.position >= 0 ? t.position : 1e9, track: clean(t) }))
      .sort((a, b) => a.position - b.position);
  }

  function write(storage, playlist) {
    const saved = playlist.filter((t) => t && (t.type === "youtube" || (t.type === "web" && validUrl(t.url))));
    const tracks = [];
    saved.forEach((t, position) => {
      if (t.type === "web") tracks.push({ ...clean(t), position });
    });
    storage.setItem(LIBRARY_KEY, JSON.stringify({ version: 1, tracks }));
  }

  // Insert web entries into the restored YouTube list at their saved positions.
  function merge(youtubeTracks, webEntries, makeWebTrack) {
    const result = youtubeTracks.slice();
    for (const entry of webEntries) {
      result.splice(Math.min(entry.position, result.length), 0, makeWebTrack(entry.track));
    }
    return result;
  }

  return { APP_NAME, LIBRARY_KEY, audius, archive, radio, parseLinks, read, write, merge };
});
