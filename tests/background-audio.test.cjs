const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('      // Let the native local-audio element own playback while backgrounded.');
const end = html.indexOf('      async function attachDirectYoutubeAudioStream(track)', start);
assert(start >= 0 && end > start, 'background visibility handler must be present');
const source = html.slice(start, end);
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(type, suspend) {
  const handlers = {};
  let suspends = 0, resumes = 0, shadowPauses = 0, shadowSyncs = 0;
  const context = {
    state: 'running',
    suspend() { suspends++; return suspend ? suspend(context) : (context.state = 'suspended', Promise.resolve()); },
    resume() { resumes++; context.state = 'running'; return Promise.resolve(); },
  };
  const doc = { hidden: false, addEventListener(name, fn) { handlers[name] = fn; } };
  vm.runInNewContext(source, {
    document: doc,
    audioContext: context,
    playlist: [{type}], currentIndex: 0,
    shadowAudio: { pause() { shadowPauses++; } },
    syncShadowAudioToYt() { shadowSyncs++; },
    Promise,
  });
  return { doc, handlers, context, counts: () => ({suspends, resumes, shadowPauses, shadowSyncs}) };
}

test('local background suspends the visualizer and restores it on return', async () => {
  const s = setup('local');
  s.doc.hidden = true; s.handlers.visibilitychange(); await flush();
  assert.equal(s.context.state, 'suspended');
  assert.equal(s.counts().suspends, 1);
  s.doc.hidden = false; s.handlers.visibilitychange(); await flush();
  assert.equal(s.context.state, 'running');
  assert.equal(s.counts().resumes, 1);
  // The handler has no reference to the music element and cannot play or pause it.
});

test('returning before suspension settles restores the context once', async () => {
  let finish;
  const s = setup('local', ctx => new Promise(resolve => { finish = () => {ctx.state = 'suspended'; resolve();}; }));
  s.doc.hidden = true; s.handlers.visibilitychange();
  s.doc.hidden = false; s.handlers.visibilitychange();
  assert.equal(s.counts().resumes, 0);
  finish(); await flush();
  assert.equal(s.context.state, 'running');
  assert.equal(s.counts().resumes, 1);
});

test('YouTube does not suspend the local visualizer context or force playback', async () => {
  const s = setup('youtube');
  s.doc.hidden = true; s.handlers.visibilitychange(); await flush();
  assert.equal(s.counts().suspends, 0);
  assert.equal(s.counts().shadowPauses, 1);
  s.doc.hidden = false; s.handlers.visibilitychange();
  assert.equal(s.counts().shadowSyncs, 1);
});
