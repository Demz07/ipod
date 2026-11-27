const test = require('node:test');
const assert = require('node:assert/strict');
const library = require('../youtube-library.js');

function storage() {
  const data = new Map();
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, value) };
}

test('saves and restores only YouTube metadata, including duplicate tracks in order', () => {
  const store = storage();
  const playlist = [
    { type: 'youtube', ytId: 'abcDEF12_-3', title: 'Song', artist: 'Artist', spectralFrames: [[1]], cover: 'blob:art' },
    { type: 'local', url: 'blob:audio', title: 'Local' },
    { type: 'youtube', ytId: 'abcDEF12_-3', title: 'Other', artist: 'Other artist' },
  ];
  library.write(store, playlist);
  assert.deepEqual(library.read(store), [
    { ytId: 'abcDEF12_-3', title: 'Song', artist: 'Artist' },
    { ytId: 'abcDEF12_-3', title: 'Other', artist: 'Other artist' },
  ]);
  assert(!store.getItem(library.KEY).includes('blob:'));
  library.write(store, playlist.slice(1, 2));
  assert.deepEqual(library.read(store), []);
});

test('handles missing and invalid records without treating malformed data as an empty library', () => {
  const store = storage();
  assert.deepEqual(library.read(store), []);
  store.setItem(library.KEY, JSON.stringify({version: 1, tracks: [null, {ytId: 'bad'}, {ytId:'abcDEF12_-3', title:4}]}));
  assert.deepEqual(library.read(store), [{ytId:'abcDEF12_-3', title:'', artist:''}]);
  store.setItem(library.KEY, '{invalid');
  assert.throws(() => library.read(store));
  store.setItem(library.KEY, JSON.stringify({version: 2, tracks: []}));
  assert.throws(() => library.read(store));
});

test('propagates blocked or full storage errors so the app can warn the user', () => {
  const denied = { getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); } };
  assert.throws(() => library.read(denied), /blocked/);
  assert.throws(() => library.write(denied, []), /full/);
});
