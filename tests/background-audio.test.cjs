const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('      // Let the native audio element own playback while backgrounded.');
const end = html.indexOf('      // Ultra-fast (< 3ms) single-pass Audio DNA', start);
assert(start >= 0 && end > start, 'background visibility handler must be present');
const source = html.slice(start, end);
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(track, suspend) {
  const handlers = {};
  let suspends = 0, resumes = 0, captures = 0;
  const context = {
    state: 'running',
    suspend() { suspends++; return suspend ? suspend(context) : (context.state = 'suspended', Promise.resolve()); },
    resume() { resumes++; context.state = 'running'; return Promise.resolve(); },
  };
  const doc = { hidden: false, addEventListener(name, fn) { handlers[name] = fn; } };
  vm.runInNewContext(source, {
    document: doc,
    audioContext: context,
    playlist: [track], currentIndex: 0,
    usesNativeAudio: t => !!t && (t.type === 'local' || t.playback === 'stream'),
    connectCaptureSource() { captures++; },
    Promise,
  });
  return { doc, handlers, context, counts: () => ({suspends, resumes, captures}) };
}

test('background suspends the visualizer context and restores it on return', async () => {
  const s = setup({type: 'local'});
  s.doc.hidden = true; s.handlers.visibilitychange(); await flush();
  assert.equal(s.context.state, 'suspended');
  assert.equal(s.counts().suspends, 1);
  s.doc.hidden = false; s.handlers.visibilitychange(); await flush();
  assert.equal(s.context.state, 'running');
  assert.equal(s.counts().resumes, 1);
  assert.equal(s.counts().captures, 1, 'reconnects the visualizer to the native stream');
  // The handler has no reference to the music element and cannot play or pause it.
});

test('returning before suspension settles restores the context once', async () => {
  let finish;
  const s = setup({type: 'local'}, ctx => new Promise(resolve => { finish = () => {ctx.state = 'suspended'; resolve();}; }));
  s.doc.hidden = true; s.handlers.visibilitychange();
  s.doc.hidden = false; s.handlers.visibilitychange();
  assert.equal(s.counts().resumes, 0);
  finish(); await flush();
  assert.equal(s.context.state, 'running');
  assert.equal(s.counts().resumes, 1);
});

test('YouTube audio streams are treated like local songs in the background', async () => {
  const s = setup({type: 'youtube', playback: 'stream'});
  s.doc.hidden = true; s.handlers.visibilitychange(); await flush();
  assert.equal(s.counts().suspends, 1);
  s.doc.hidden = false; s.handlers.visibilitychange(); await flush();
  assert.equal(s.counts().resumes, 1);
  assert.equal(s.counts().captures, 1);
});

test('video-mode YouTube does not touch native capture on return', async () => {
  const s = setup({type: 'youtube', playback: 'embed'});
  s.doc.hidden = true; s.handlers.visibilitychange(); await flush();
  s.doc.hidden = false; s.handlers.visibilitychange(); await flush();
  assert.equal(s.counts().captures, 0);
});

test('every song plays through the single native audio element', () => {
  assert.equal((html.match(/<audio\s+id=/g) || []).length, 1, 'no second (shadow) audio element');
  assert.match(html, /audio\.addEventListener\("error", handleNativeAudioError\)/);
  assert.match(html, /onError: \(e\) =>/, 'embedded player errors skip the song');
});
