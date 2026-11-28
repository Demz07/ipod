// Music from other sites that plays as plain audio files/streams, so it keeps
// playing in the background like local songs:
//   - Audius (audius.co): free streaming music, open API, no key needed
//   - Internet Archive (archive.org): free/public-domain albums and live sets
//   - Radio Browser (radio-browser.info): thousands of live internet radio stations
//   - Deezer (deezer.com): famous artists, 30-second previews, no key needed
//   - Jamendo (jamendo.com): full songs by independent artists (free key)
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

  // ---- JSONP --------------------------------------------------------------
  // Deezer sends no CORS headers, so browsers can only read it with JSONP
  // (a <script> tag calling a named function). Jamendo supports it as well.
  let jsonpCounter = 0;
  function jsonp(url, { timeoutMs = 9000, param = "callback" } = {}) {
    return new Promise((resolve, reject) => {
      const doc = globalThis.document;
      const name = `__ipodJsonp${Date.now().toString(36)}${jsonpCounter++}`;
      const script = doc.createElement("script");
      let done = false;
      const finish = (error, data) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // Leave a no-op behind briefly so a late response doesn't throw.
        globalThis[name] = () => {};
        setTimeout(() => { delete globalThis[name]; }, 60000);
        script.remove();
        if (error) reject(error);
        else resolve(data);
      };
      const timer = setTimeout(() => finish(new Error("Timed out")), timeoutMs);
      globalThis[name] = (data) => finish(null, data);
      script.onerror = () => finish(new Error("Network error"));
      script.src = `${url}${url.includes("?") ? "&" : "?"}${param}=${name}`;
      doc.head.appendChild(script);
    });
  }

  // ---- Deezer -------------------------------------------------------------
  // Preview links are signed and expire about 15 minutes after they are
  // issued, so tracks keep their Deezer id and get a fresh link before playing.
  const DEEZER_API = "https://api.deezer.com";

  function previewExpiry(url) {
    const match = /exp=(\d{9,})/.exec(String(url || ""));
    return match ? Number(match[1]) * 1000 : 0;
  }

  function deezerTrack(t) {
    const url = httpsOnly(t && t.preview);
    if (!url || !t.id || t.readable === false) return null;
    const album = t.album || {};
    return {
      url,
      title: text(t.title, "Untitled"),
      artist: text(t.artist && t.artist.name, "Deezer"),
      cover: httpsOnly(album.cover_big || album.cover_medium || ""),
      source: "Deezer",
      deezerId: String(t.id),
      expires: previewExpiry(url),
    };
  }

  async function deezerGet(jsonpImpl, path) {
    const data = await jsonpImpl(`${DEEZER_API}${path}${path.includes("?") ? "&" : "?"}output=jsonp`);
    if (!data || data.error) throw new Error((data && data.error && data.error.message) || "Deezer error");
    return data;
  }

  async function deezerTracks(jsonpImpl, path) {
    const data = await deezerGet(jsonpImpl, path);
    const list = Array.isArray(data.data) ? data.data : [];
    return list.map(deezerTrack).filter(Boolean).slice(0, MAX_RESULTS);
  }

  const deezer = {
    search: (jsonpImpl, query) => deezerTracks(jsonpImpl, `/search?q=${enc(query)}&limit=50`),
    async artists(jsonpImpl, query) {
      const data = await deezerGet(jsonpImpl, `/search/artist?q=${enc(query)}&limit=25`);
      return (Array.isArray(data.data) ? data.data : [])
        .filter((a) => a && a.id)
        .map((a) => ({
          kind: "artist",
          id: String(a.id),
          title: text(a.name, "Artist"),
          artist: Number.isFinite(a.nb_fan) ? `${a.nb_fan.toLocaleString("en-US")} fans` : "Artist",
          cover: httpsOnly(a.picture_big || a.picture_medium || ""),
          source: "Deezer",
        }));
    },
    artistTop: (jsonpImpl, id) => deezerTracks(jsonpImpl, `/artist/${enc(id)}/top?limit=50`),
    chart: (jsonpImpl, genreId = 0) => deezerTracks(jsonpImpl, `/chart/${enc(genreId)}/tracks?limit=50`),
    async genres(jsonpImpl) {
      const data = await deezerGet(jsonpImpl, "/genre");
      return (Array.isArray(data.data) ? data.data : [])
        .filter((g) => g && g.id) // id 0 is "All" (= Top Charts)
        .map((g) => ({
          kind: "genre",
          id: String(g.id),
          title: text(g.name, "Genre"),
          artist: "Top Songs",
          cover: httpsOnly(g.picture_big || g.picture_medium || ""),
          source: "Deezer",
        }));
    },
    // A fresh preview link for a saved track.
    async track(jsonpImpl, id) {
      const track = deezerTrack(await deezerGet(jsonpImpl, `/track/${enc(id)}`));
      if (!track) throw new Error("No preview for this song");
      return track;
    },
    // True when the preview link is valid for at least another minute.
    isFresh: (track, now = Date.now()) => previewExpiry(track && track.url) > now + 60000,
  };

  // ---- Jamendo ------------------------------------------------------------
  // Needs a free client id from devportal.jamendo.com (entered in the app).
  const JAMENDO_API = "https://api.jamendo.com/v3.0/tracks/";
  const JAMENDO_GENRES = [
    ["pop", "Pop"], ["rock", "Rock"], ["hiphop", "Hip-Hop"], ["electronic", "Electronic"],
    ["jazz", "Jazz"], ["lounge", "Lounge"], ["relaxation", "Relaxation"], ["classical", "Classical"],
    ["songwriter", "Singer-Songwriter"], ["world", "World"], ["metal", "Metal"], ["soundtrack", "Soundtrack"],
  ];

  function jamendoTrack(t) {
    const url = httpsOnly(t && t.audio);
    if (!url) return null;
    return {
      url,
      title: text(t.name, "Untitled"),
      artist: text(t.artist_name, "Jamendo"),
      cover: httpsOnly(t.image || t.album_image || ""),
      source: "Jamendo",
    };
  }

  async function jamendoTracks(jsonpImpl, clientId, params) {
    const key = String(clientId || "").trim();
    if (!key) throw new Error("Jamendo key needed");
    const url =
      `${JAMENDO_API}?client_id=${enc(key)}&format=json&limit=${MAX_RESULTS}` +
      `&type=${enc("single albumtrack")}&audioformat=mp32&imagesize=300&${params}`;
    const data = await jsonpImpl(url);
    const headers = (data && data.headers) || {};
    if (headers.status !== "success") {
      throw new Error(headers.code === 5 ? "Jamendo key not accepted" : text(headers.error_message, "Jamendo error"));
    }
    return (Array.isArray(data.results) ? data.results : []).map(jamendoTrack).filter(Boolean);
  }

  const jamendo = {
    // Free text: matches song, album and artist names, genres and instruments.
    search: (jsonpImpl, clientId, query) => jamendoTracks(jsonpImpl, clientId, `search=${enc(query)}`),
    popular: (jsonpImpl, clientId) => jamendoTracks(jsonpImpl, clientId, "order=popularity_week"),
    // Jamendo's recommended genre charts: featured tracks, one per artist.
    genre: (jsonpImpl, clientId, tag) =>
      jamendoTracks(jsonpImpl, clientId, `tags=${enc(tag)}&featured=1&groupby=artist_id&boost=popularity_month`),
    genres: () => JAMENDO_GENRES.map(([id, title]) => ({ kind: "genre", id, title, artist: "Featured Songs", cover: "", source: "Jamendo" })),
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
      ...(/^\d{1,20}$/.test(String(track.deezerId || "")) ? { deezerId: String(track.deezerId) } : {}),
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

  return { APP_NAME, LIBRARY_KEY, jsonp, audius, archive, radio, deezer, jamendo, parseLinks, read, write, merge };
});
