const test = require('node:test');
const assert = require('node:assert/strict');
const web = require('../web-music.js');

const ok = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
const fail = (status = 502) => Promise.resolve({ ok: false, status, json: async () => ({}) });
function router(routes) {
  const calls = [];
  const fetch = (url) => {
    calls.push(url);
    for (const [pattern, handler] of routes) if (pattern.test(url)) return handler(url);
    return fail(404);
  };
  return { fetch, calls };
}

// Shapes copied from live API responses (trimmed).
const audiusStreamable = {
  id: 'M2l69g9', title: 'Jack Got Jacked (Raar Edit)', is_streamable: true, access: { stream: true },
  user: { name: 'Raar', handle: 'pimpmyraar' },
  artwork: { '150x150': 'https://cn.example/150x150.jpg', '480x480': 'https://cn.example/480x480.jpg' },
  stream: { url: 'https://cn.example/tracks/cidstream/x?signature=expiring' },
};
const audiusDeactivated = { id: '95wro', title: 'Stars In The Sky', is_streamable: false, user: { name: 'Lofi Beats' }, artwork: {} };

test('Audius search keeps streamable tracks and uses the stable stream endpoint', async () => {
  const { fetch, calls } = router([[/api\.audius\.co\/v1\/tracks\/search/, () => ok({ data: [audiusDeactivated, audiusStreamable] })]]);
  const tracks = await web.audius.search(fetch, 'lofi beats');
  assert.equal(tracks.length, 1);
  assert.deepEqual(tracks[0], {
    url: 'https://api.audius.co/v1/tracks/M2l69g9/stream?app_name=ipod-classic',
    title: 'Jack Got Jacked (Raar Edit)', artist: 'Raar', cover: 'https://cn.example/480x480.jpg', source: 'Audius',
  });
  assert.match(calls[0], /query=lofi%20beats&app_name=ipod-classic/);
});

test('Audius falls back to the next discovery host', async () => {
  const { fetch } = router([
    [/api\.audius\.co/, () => fail(503)],
    [/discoveryprovider\.audius\.co\/v1\/tracks\/trending/, () => ok({ data: [audiusStreamable] })],
  ]);
  const [track] = await web.audius.trending(fetch);
  assert.equal(track.url, 'https://discoveryprovider.audius.co/v1/tracks/M2l69g9/stream?app_name=ipod-classic');
});

test('Audius resolves track and playlist page links', async () => {
  const { fetch } = router([
    [/\/v1\/resolve\?url=https%3A%2F%2Faudius\.co%2Fraar%2Fsong/, () => ok({ data: audiusStreamable })],
    [/\/v1\/resolve\?url=https%3A%2F%2Faudius\.co%2Fraar%2Fplaylist/, () => ok({ data: [{ id: 'PL1', playlist_name: 'Mix' }] })],
    [/\/v1\/playlists\/PL1\/tracks/, () => ok({ data: [audiusStreamable, audiusDeactivated] })],
  ]);
  assert.equal((await web.audius.resolve(fetch, 'https://audius.co/raar/song')).length, 1);
  assert.equal((await web.audius.resolve(fetch, 'https://audius.co/raar/playlist/mix')).length, 1);
});

test('Internet Archive search returns albums; album lists one MP3 per track in order', async () => {
  const { fetch, calls } = router([
    [/advancedsearch\.php/, () => ok({ response: { docs: [{ identifier: 'ChillPills', title: 'Chill Pills', creator: ['Alaeddin Hallak'] }, { title: 'no id' }] } })],
    [/archive\.org\/metadata\/ChillPills$/, () => ok({
      metadata: { creator: 'Uplifting Pills' },
      files: [
        { name: 'cover.png', format: 'PNG' },
        { name: 'B side.flac', format: 'Flac', source: 'original', track: '2' },
        { name: 'B side.mp3', format: 'VBR MP3', source: 'derivative', original: 'B side.flac', title: 'B Side', track: '2' },
        { name: 'B side_64kb.mp3', format: '64Kbps MP3', source: 'derivative', original: 'B side.flac' },
        { name: 'Disc 1/01 Opening Song.mp3', format: 'VBR MP3', source: 'original', track: '1', artist: 'Guest' },
      ],
    })],
  ]);
  const [album] = await web.archive.search(fetch, 'chill');
  assert.equal(album.kind, 'album');
  assert.equal(album.artist, 'Alaeddin Hallak');
  assert.match(decodeURIComponent(calls[0]), /\(chill\) AND mediatype:\(audio\) AND format:\("VBR MP3"\)/);
  const tracks = await web.archive.album(fetch, 'ChillPills');
  assert.deepEqual(tracks.map(t => t.title), ['01 Opening Song', 'B Side']);
  assert.equal(tracks[0].url, 'https://archive.org/download/ChillPills/Disc%201/01%20Opening%20Song.mp3');
  assert.equal(tracks[0].artist, 'Guest');
  assert.equal(tracks[1].artist, 'Uplifting Pills');
  assert.equal(tracks[1].url, 'https://archive.org/download/ChillPills/B%20side.mp3');
});

test('Radio search merges name + tag matches, keeps only https streams', async () => {
  const station = (name, url, extra = {}) => ({ name, url_resolved: url, country: 'Germany', tags: 'lounge,chill', favicon: 'http://x/icon.png', ...extra });
  const { fetch } = router([
    [/de1\.api\.radio-browser\.info\/json\/stations\/search\?name=/, () => ok([station('Jazz FM', 'https://a.example/jazz'), station('Insecure', 'http://b.example/x')])],
    [/de1\.api\.radio-browser\.info\/json\/stations\/search\?tag=/, () => ok([station('Jazz FM', 'https://a.example/jazz'), station('Smooth', 'https://c.example/s', { favicon: 'https://c.example/i.png' })])],
  ]);
  const stations = await web.radio.search(fetch, 'Jazz');
  assert.deepEqual(stations.map(s => s.title), ['Jazz FM', 'Smooth']);
  assert.equal(stations[0].live, true);
  assert.equal(stations[0].noCors, true);
  assert.equal(stations[0].cover, '', 'http favicons are dropped');
  assert.equal(stations[0].artist, 'Germany • lounge');
});

test('parses pasted direct links, archive.org pages and audius.co pages', () => {
  const r = web.parseLinks('http://example.com/music/My_Song%202.mp3, https://archive.org/details/ChillPills\nhttps://audius.co/raar/song not-a-url https://example.com/music/My_Song%202.mp3');
  assert.deepEqual(r.archive, ['ChillPills']);
  assert.deepEqual(r.audius, ['https://audius.co/raar/song']);
  assert.equal(r.direct.length, 1, 'duplicates (after https upgrade) removed');
  assert.deepEqual(r.direct[0], { url: 'https://example.com/music/My_Song%202.mp3', title: 'My Song 2', artist: 'example.com', cover: '', source: 'Link', noCors: true });
});

test('saves web songs with their position and restores the mixed order', () => {
  const data = new Map();
  const storage = { getItem: k => data.has(k) ? data.get(k) : null, setItem: (k, v) => data.set(k, v) };
  const playlist = [
    { type: 'web', url: 'https://a/1.mp3', title: 'W1', artist: 'A', cover: 'data:image/png;base64,xx', coverUrl: '', source: 'Link' },
    { type: 'youtube', ytId: 'abcDEF12_-3', title: 'Y1' },
    { type: 'local', url: 'blob:x', title: 'L' },
    { type: 'web', url: 'https://a/2.mp3', title: 'W2', artist: 'B', cover: 'https://a/c.jpg', source: 'Radio', live: true, noCors: true },
    { type: 'youtube', ytId: 'abcDEF12_-4', title: 'Y2' },
  ];
  web.write(storage, playlist);
  const stored = data.get(web.LIBRARY_KEY);
  assert(!stored.includes('data:image'), 'generated placeholder covers are not saved');
  const entries = web.read(storage);
  assert.deepEqual(entries.map(e => e.position), [0, 2]);
  const merged = web.merge([{ title: 'Y1' }, { title: 'Y2' }], entries, t => ({ title: t.title, live: t.live }));
  assert.deepEqual(merged.map(t => t.title), ['W1', 'Y1', 'W2', 'Y2']);
  assert.equal(merged[2].live, true);
  storage.setItem(web.LIBRARY_KEY, '{bad');
  assert.throws(() => web.read(storage));
});

// ---- Deezer / Jamendo (JSONP) -------------------------------------------
function jsonpRouter(routes) {
  const calls = [];
  const jsonp = async (url) => {
    calls.push(url);
    for (const [pattern, data] of routes) if (pattern.test(url)) return typeof data === 'function' ? data(url) : data;
    throw new Error('Network error');
  };
  return { jsonp, calls };
}
const EXP = 1795866880;
const dzTrack = (id, title, extra = {}) => ({
  id, readable: true, title, duration: 226,
  preview: `https://cdnt-preview.dzcdn.net/api/1/1/0/4/9/0/049e.mp3?hdnea=exp=${EXP}~acl=/api/1/1/0/4/9/0/049e.mp3*~data=user_id=0,application_id=42~hmac=03a6`,
  artist: { id: 12246, name: 'Taylor Swift' },
  album: { id: 829966251, title: 'The Life of a Showgirl', cover_medium: 'https://cdn-images.dzcdn.net/images/cover/d0/250x250.jpg', cover_big: 'https://cdn-images.dzcdn.net/images/cover/d0/500x500.jpg' },
  type: 'track', ...extra,
});

test('Deezer search maps previews, keeps the id and expiry, skips songs without a preview', async () => {
  const { jsonp, calls } = jsonpRouter([[/api\.deezer\.com\/search\?q=taylor%20swift&limit=50&output=jsonp$/, {
    data: [dzTrack(3579685431, 'The Fate of Ophelia'), dzTrack(1, 'No preview', { preview: '' }), dzTrack(2, 'Blocked', { readable: false })],
  }]]);
  const tracks = await web.deezer.search(jsonp, 'taylor swift');
  assert.equal(calls.length, 1);
  assert.equal(tracks.length, 1);
  assert.deepEqual({ ...tracks[0], url: undefined }, {
    url: undefined, title: 'The Fate of Ophelia', artist: 'Taylor Swift', cover: 'https://cdn-images.dzcdn.net/images/cover/d0/500x500.jpg',
    source: 'Deezer', deezerId: '3579685431', expires: EXP * 1000,
  });
  assert.equal(web.deezer.isFresh(tracks[0], EXP * 1000 - 120000), true);
  assert.equal(web.deezer.isFresh(tracks[0], EXP * 1000 - 30000), false, 'less than a minute left');
});

test('Deezer artists, artist top songs, genres and charts', async () => {
  const { jsonp, calls } = jsonpRouter([
    [/\/search\/artist\?q=shakira/, { data: [{ id: 160, name: 'Shakira', nb_fan: 12345678, picture_big: 'https://cdn-images.dzcdn.net/a/500.jpg' }] }],
    [/\/artist\/160\/top\?limit=50/, { data: [dzTrack(4015341011, 'Dai Dai')] }],
    [/\/genre\?output=jsonp/, { data: [{ id: 0, name: 'All' }, { id: 132, name: 'Pop', picture_big: 'https://cdn-images.dzcdn.net/g/500.jpg' }] }],
    [/\/chart\/132\/tracks\?limit=50/, { data: [dzTrack(5, 'Pop Hit')] }],
  ]);
  const [artist] = await web.deezer.artists(jsonp, 'shakira');
  assert.deepEqual(artist, { kind: 'artist', id: '160', title: 'Shakira', artist: '12,345,678 fans', cover: 'https://cdn-images.dzcdn.net/a/500.jpg', source: 'Deezer' });
  assert.equal((await web.deezer.artistTop(jsonp, artist.id))[0].title, 'Dai Dai');
  const genres = await web.deezer.genres(jsonp);
  assert.deepEqual(genres.map((g) => g.title), ['Pop'], '"All" is left out');
  assert.equal((await web.deezer.chart(jsonp, genres[0].id))[0].title, 'Pop Hit');
  assert(calls.every((u) => u.includes('output=jsonp')));
});

test('Deezer errors (e.g. removed songs) reject', async () => {
  const { jsonp } = jsonpRouter([[/\/track\/999/, { error: { type: 'DataException', message: 'no data', code: 800 } }]]);
  await assert.rejects(web.deezer.track(jsonp, '999'), /no data/);
});

test('Jamendo search uses the key, returns full songs, and explains a bad key', async () => {
  const { jsonp, calls } = jsonpRouter([
    [/client_id=good/, { headers: { status: 'success', code: 0 }, results: [
      { id: '1848357', name: 'mañana será tarde', artist_name: 'fankel', image: 'https://usercontent.jamendo.com?type=album&id=368084&width=300', audio: 'https://prod-1.storage.jamendo.com/?trackid=1848357&format=mp32&from=app-good' },
      { id: '2', name: 'no audio', artist_name: 'x', audio: '' },
    ] }],
    [/client_id=bad/, { headers: { status: 'failed', code: 5, error_message: 'Jamendo Api Invalid Client Id Error: Your credential is not authorized.' }, results: [] }],
  ]);
  const tracks = await web.jamendo.search(jsonp, ' good ', 'acoustic rock');
  assert.deepEqual(tracks, [{ url: 'https://prod-1.storage.jamendo.com/?trackid=1848357&format=mp32&from=app-good', title: 'mañana será tarde', artist: 'fankel', cover: 'https://usercontent.jamendo.com?type=album&id=368084&width=300', source: 'Jamendo' }]);
  assert.match(calls[0], /^https:\/\/api\.jamendo\.com\/v3\.0\/tracks\/\?client_id=good&format=json&.*&search=acoustic%20rock$/);
  await web.jamendo.genre(jsonp, 'good', 'rock');
  assert.match(calls[1], /tags=rock&featured=1&groupby=artist_id/);
  await assert.rejects(web.jamendo.popular(jsonp, 'bad'), /Jamendo key not accepted/);
  await assert.rejects(web.jamendo.popular(jsonp, ''), /Jamendo key needed/);
  assert.equal(web.jamendo.genres().length, 12);
});

test('saved Deezer songs keep their id so a fresh preview can be fetched later', () => {
  const data = new Map();
  const storage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v) };
  web.write(storage, [{ type: 'web', url: 'https://cdnt-preview.dzcdn.net/x.mp3?hdnea=exp=1', title: 'Song', source: 'Deezer', deezerId: '3579685431', coverUrl: '' }]);
  assert.equal(web.read(storage)[0].track.deezerId, '3579685431');
});
