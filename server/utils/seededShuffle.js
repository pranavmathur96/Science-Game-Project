// server/utils/seededShuffle.js
// Deterministic shuffling: the same seed string always produces the same
// order. Used to rotate which slice of a topic's content bank a given
// student sees, without storing anything extra — the shuffle order is
// re-derivable any time from (studentId, topicId, gameType).

// djb2 string hash -> 32-bit int, used to seed the PRNG below.
function hashStringToInt(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

// mulberry32: small, fast, seeded PRNG. Returns a function producing
// floats in [0, 1), same sequence every time for the same seed.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates shuffle using a PRNG seeded from seedString — pure function
// of (array contents, seedString), no Date.now()/Math.random() involved.
function seededShuffle(array, seedString) {
  const rng = mulberry32(hashStringToInt(seedString));
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

module.exports = { hashStringToInt, mulberry32, seededShuffle };
