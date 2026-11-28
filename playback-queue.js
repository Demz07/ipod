// Pure queue-order rules shared by track-end, next, and prefetch logic.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PlaybackQueue = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // Pick a random index that differs from `current` (uniformly, in one draw).
  function randomOtherIndex(length, current, random = Math.random) {
    if (length <= 1) return 0;
    if (current < 0 || current >= length) return Math.floor(random() * length);
    const r = Math.floor(random() * (length - 1));
    return r >= current ? r + 1 : r;
  }

  // Returns the index to play after `current`, or -1 to stop.
  // `auto` is true when a track finished on its own (repeat-one and
  // end-of-queue stop apply); false for a user/lock-screen "next".
  // `upcoming` is a shuffle pick chosen in advance so it can be prefetched.
  function nextIndex({ length, current, order, repeat, auto, upcoming, random }) {
    if (!length) return -1;
    if (auto && repeat === "one" && current >= 0 && current < length) return current;
    if (order === "shuffle") {
      if (length === 1) return auto && repeat === "off" ? -1 : 0;
      if (Number.isInteger(upcoming) && upcoming >= 0 && upcoming < length && upcoming !== current) {
        return upcoming;
      }
      return randomOtherIndex(length, current, random);
    }
    if (current < length - 1) return current + 1;
    return !auto || repeat === "all" ? 0 : -1;
  }

  function previousIndex({ length, current }) {
    if (!length) return -1;
    return (current - 1 + length) % length;
  }

  return { nextIndex, previousIndex, randomOtherIndex };
});
