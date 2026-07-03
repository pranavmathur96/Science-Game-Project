// server/services/contentRotation.js
// A topic's game_kit_json now holds a large content bank (see gameGenerator.js).
// These functions pick a rotating slice of that bank + a presentation mode for
// a given play, so replays feel fresh without any extra Claude API calls.
// Everything here is a pure function of (content, seed, playIndex) — nothing
// is stored; the same inputs always produce the same output.

const { seededShuffle } = require('../utils/seededShuffle');

const DISPLAY_COUNTS = { quiz: 5, sort: 8, match: 6 };
const MODE_COUNTS = { quiz: 3, sort: 2, match: 2 };

// Pick `displayCount` items from `pool`, seed-shuffled then windowed by
// playIndex so consecutive plays advance through the bank without repeating
// until it wraps around. Small/legacy pools just return everything.
function selectWindow(pool, seed, displayCount, playIndex) {
  if (pool.length <= displayCount) {
    return seededShuffle(pool, seed);
  }
  const shuffled = seededShuffle(pool, seed);
  const start = (playIndex * displayCount) % shuffled.length;
  let slice = shuffled.slice(start, start + displayCount);
  if (slice.length < displayCount) {
    slice = slice.concat(shuffled.slice(0, displayCount - slice.length));
  }
  return slice;
}

// Sort items need category-aware windowing: a flat shuffle-window over the
// whole item pool could easily leave a category with zero items in a given
// slice. Instead, allocate the display quota per category (proportional to
// how many items that category has) and window within each category
// independently, then combine.
function selectSortWindow(categories, items, seed, playIndex, totalDisplayCount = DISPLAY_COUNTS.sort) {
  const byCategory = new Map();
  categories.forEach(c => byCategory.set(c.id, []));
  items.forEach(item => {
    if (!byCategory.has(item.categoryId)) byCategory.set(item.categoryId, []);
    byCategory.get(item.categoryId).push(item);
  });

  const categoryIds = Array.from(byCategory.keys()).filter(id => byCategory.get(id).length > 0);
  if (categoryIds.length === 0) return [];

  const totalItems = items.length;
  const quotas = {};
  let allocated = 0;
  categoryIds.forEach(id => {
    const poolSize = byCategory.get(id).length;
    const raw = (poolSize / totalItems) * totalDisplayCount;
    const quota = Math.max(1, Math.min(poolSize, Math.round(raw)));
    quotas[id] = quota;
    allocated += quota;
  });

  // Nudge quotas so they sum as close to totalDisplayCount as possible,
  // without exceeding any category's pool or dropping below 1.
  let diff = totalDisplayCount - allocated;
  const idsBySize = [...categoryIds].sort((a, b) => byCategory.get(b).length - byCategory.get(a).length);
  let guard = 0;
  while (diff !== 0 && guard < idsBySize.length * totalDisplayCount + 10) {
    const id = idsBySize[guard % idsBySize.length];
    const poolSize = byCategory.get(id).length;
    if (diff > 0 && quotas[id] < poolSize) { quotas[id] += 1; diff -= 1; }
    else if (diff < 0 && quotas[id] > 1) { quotas[id] -= 1; diff += 1; }
    guard += 1;
  }

  let result = [];
  categoryIds.forEach(id => {
    const pool = byCategory.get(id);
    const quota = Math.min(quotas[id], pool.length);
    if (quota <= 0) return;
    result = result.concat(selectWindow(pool, `${seed}-cat-${id}`, quota, playIndex));
  });
  return result;
}

// Which presentation mode (0 = classic) to use for this play. Forced to
// classic on small/legacy pools where a timed/lives variant wouldn't have
// enough spare content to make sense.
function computeMode(playIndex, gameType, poolSize) {
  const numModes = MODE_COUNTS[gameType] || 1;
  const displayCount = DISPLAY_COUNTS[gameType] || poolSize;
  if (poolSize <= displayCount) return 0;
  return playIndex % numModes;
}

module.exports = { DISPLAY_COUNTS, MODE_COUNTS, selectWindow, selectSortWindow, computeMode };
