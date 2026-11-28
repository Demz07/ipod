const test = require('node:test');
const assert = require('node:assert/strict');
const { createResolver, pickBestStream, endpointFor } = require('../youtube-stream.js');

const ID = 'abcDEF12_-3';
const json = (data, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => data });

test('prefers playable AAC/MP4 audio over higher-bitrate WebM', () => {
  const streams = [
    { url: 'https://p/webm', mimeType: 'audio/webm', bitrate: 160000 },
    { url: 'https://p/m4a-low', mimeType: 'audio/mp4', bitrate: 48000 },
    { url: 'https://p/m4a', mimeType: 'audio/mp4', bitrate: 128000 },
    { url: 'https://p/video', mimeType: 'video/mp4', bitrate: 900000 },
  ];
  assert.equal(pickBestStream(streams, () => 'maybe').url, 'https://p/m4a');
  // A browser that cannot play MP4 audio gets the best format it supports.
  assert.equal(pickBestStream(streams, m => m === 'audio/webm' ? 'probably' : '').url, 'https://p/webm');
  assert.equal(pickBestStream([{ mimeType: 'audio/mp4' }], () => 'maybe'), null);
});

test('builds Piped and Invidious (proxied) endpoints', () => {
  assert.equal(endpointFor({ type: 'piped', base: 'https://api.example/' }, ID), `https://api.example/streams/${ID}`);
  assert.match(endpointFor({ type: 'invidious', base: 'https://inv.example' }, ID), /\/api\/v1\/videos\/abcDEF12_-3\?local=true/);
});

test('resolves from the first working source, caches it, and dedupes in-flight requests', async () => {
  const calls = [];
  const fetch = (url) => {
    calls.push(url);
    if (url.startsWith('https://down')) return json({}, false, 502);
    return json({ audioStreams: [{ url: 'https://proxy/audio.m4a', mimeType: 'audio/mp4', bitrate: 128000 }] });
  };
  const r = createResolver({ fetch, sources: [{ type: 'piped', base: 'https://down' }, { type: 'piped', base: 'https://up' }] });
  assert.equal(r.peek(ID), null);
  const [a, b] = await Promise.all([r.resolve(ID), r.resolve(ID)]);
  assert.equal(a.url, 'https://proxy/audio.m4a');
  assert.equal(a, b);
  assert.equal(calls.length, 2, 'one request per source, shared by both callers');
  assert.equal(r.peek(ID).url, 'https://proxy/audio.m4a', 'available synchronously for gapless switching');
  await r.resolve(ID);
  assert.equal(calls.length, 2, 'served from cache');
  await r.resolve(ID, { force: true });
  assert.equal(calls.length, 4, 'force bypasses the cache');
});

test('parses Invidious adaptive formats and resolves relative proxy URLs', async () => {
  const fetch = () => json({ adaptiveFormats: [
    { url: '/videoplayback?id=1&itag=251', type: 'audio/webm; codecs="opus"', bitrate: '140000' },
    { url: '/videoplayback?id=1&itag=140', type: 'audio/mp4; codecs="mp4a.40.2"', bitrate: '130000' },
  ] });
  const r = createResolver({ fetch, sources: [{ type: 'invidious', base: 'https://inv.example' }] });
  const entry = await r.resolve(ID);
  assert.equal(entry.url, 'https://inv.example/videoplayback?id=1&itag=140');
});

test('cache entries expire before the signed URL does', async () => {
  let now = 1_000_000;
  const expire = Math.floor(now / 1000) + 600; // URL valid for 10 minutes
  const fetch = () => json({ audioStreams: [{ url: `https://proxy/a.m4a?expire=${expire}`, mimeType: 'audio/mp4' }] });
  const r = createResolver({ fetch, sources: [{ type: 'piped', base: 'https://up' }], now: () => now });
  await r.resolve(ID);
  now += 4 * 60 * 1000;
  assert.ok(r.peek(ID), 'still fresh');
  now += 2 * 60 * 1000; // within the 5-minute safety margin
  assert.equal(r.peek(ID), null);
});

test('rejects when every source fails, times out, or the ID is invalid', async () => {
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const r = createResolver({ fetch: hang, timeoutMs: 20, sources: [{ type: 'piped', base: 'https://slow' }] });
  await assert.rejects(r.resolve(ID), /No audio stream available/);
  await assert.rejects(r.resolve('bad'), /Invalid YouTube ID/);
  const empty = createResolver({ fetch: () => json({ audioStreams: [] }), sources: [{ type: 'piped', base: 'https://x' }] });
  await assert.rejects(empty.resolve(ID), /No audio stream available/);
  // Failures are not cached: a later attempt can succeed.
  assert.equal(empty.peek(ID), null);
});
