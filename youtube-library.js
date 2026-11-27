// Save only YouTube identifiers and display metadata, never media or blob URLs.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.YouTubeLibrary = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const KEY = "ipod-classic-youtube-library-v1";
  const validId = (id) => typeof id === "string" && /^[\w-]{11}$/.test(id);
  const clean = (track) => ({
    ytId: track.ytId,
    title: typeof track.title === "string" ? track.title.slice(0, 500) : "",
    artist: typeof track.artist === "string" ? track.artist.slice(0, 500) : "",
  });

  function read(storage) {
    const raw = storage.getItem(KEY);
    if (raw === null) return [];
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Array.isArray(data.tracks)) {
      throw new Error("Invalid saved YouTube library");
    }
    return data.tracks.filter((track) => track && validId(track.ytId)).map(clean);
  }

  function write(storage, playlist) {
    const tracks = playlist.filter((track) => track && track.type === "youtube" && validId(track.ytId)).map(clean);
    storage.setItem(KEY, JSON.stringify({ version: 1, tracks }));
  }

  return { KEY, read, write };
});
