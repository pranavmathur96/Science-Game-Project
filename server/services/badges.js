// server/services/badges.js
// Micro-credentials: a small catalog of rule-based achievements, evaluated
// against a student's attempt history after every recorded attempt.

const db = require('../db/connection');

function getFullyMasteredTopicIds(attempts) {
  const byTopic = new Map();
  attempts.forEach(a => {
    if (!byTopic.has(a.topic_id)) byTopic.set(a.topic_id, new Set());
    if (a.mastered) byTopic.get(a.topic_id).add(a.game_type);
  });
  const mastered = [];
  byTopic.forEach((gameTypes, topicId) => {
    if (gameTypes.has('quiz') && gameTypes.has('sort') && gameTypes.has('match')) {
      mastered.push(topicId);
    }
  });
  return mastered;
}

function countMasteredByGameType(attempts, gameType) {
  const masteredTopics = new Set();
  attempts.filter(a => a.game_type === gameType && a.mastered).forEach(a => masteredTopics.add(a.topic_id));
  return masteredTopics.size;
}

// Longest run of consecutive calendar days with at least one attempt.
// Note: played_at is stored in UTC (SQLite CURRENT_TIMESTAMP), so a streak
// spanning local midnight could be off by a day depending on the student's
// timezone. Acceptable simplification for v1.
function longestDayStreak(attempts) {
  const days = Array.from(new Set(attempts.map(a => a.played_at.slice(0, 10)))).sort();
  if (days.length === 0) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1] + 'T00:00:00Z');
    const curr = new Date(days[i] + 'T00:00:00Z');
    const diffDays = Math.round((curr - prev) / 86400000);
    if (diffDays === 1) { current += 1; longest = Math.max(longest, current); }
    else if (diffDays > 1) { current = 1; }
  }
  return longest;
}

// Static (non-topic-specific) badges. Per-topic mastery badges are generated
// dynamically below since their key/label depend on which topic.
const STATIC_BADGE_CATALOG = [
  {
    key: 'first-topic', label: 'First Steps', emoji: '🌟',
    description: 'Master every game in your first topic.',
    check: attempts => getFullyMasteredTopicIds(attempts).length >= 1,
  },
  {
    key: 'three-topics', label: 'On a Roll', emoji: '🔥',
    description: 'Fully master 3 topics.',
    check: attempts => getFullyMasteredTopicIds(attempts).length >= 3,
  },
  {
    key: 'five-topics', label: 'Topic Champion', emoji: '🏆',
    description: 'Fully master 5 topics.',
    check: attempts => getFullyMasteredTopicIds(attempts).length >= 5,
  },
  {
    key: 'quiz-whiz', label: 'Quiz Whiz', emoji: '⚡',
    description: 'Master 10 quiz games.',
    check: attempts => countMasteredByGameType(attempts, 'quiz') >= 10,
  },
  {
    key: 'sort-master', label: 'Sort Master', emoji: '🧩',
    description: 'Master 10 sorting games.',
    check: attempts => countMasteredByGameType(attempts, 'sort') >= 10,
  },
  {
    key: 'match-master', label: 'Match Master', emoji: '🔗',
    description: 'Master 10 matching games.',
    check: attempts => countMasteredByGameType(attempts, 'match') >= 10,
  },
  {
    key: 'three-day-streak', label: '3-Day Streak', emoji: '📅',
    description: 'Play on 3 days in a row.',
    check: attempts => longestDayStreak(attempts) >= 3,
  },
];

function topicMasteryBadge(topicId, topicTitle) {
  return {
    key: `topic-mastery-${topicId}`,
    label: `${topicTitle} Master`,
    emoji: '🏅',
    description: `Master every game (quiz, sort, match) in "${topicTitle}".`,
    topicId,
  };
}

function titlesForTopicIds(topicIds) {
  if (topicIds.length === 0) return new Map();
  const rows = db.prepare(
    `SELECT id, title FROM topics WHERE id IN (${topicIds.map(() => '?').join(',')})`
  ).all(...topicIds);
  return new Map(rows.map(r => [r.id, r.title]));
}

// Runs after every attempt. Returns newly-earned badges (with full display
// metadata) so the caller can show a celebration moment.
function checkAndAwardBadges(studentUserId) {
  const attempts = db.prepare(
    'SELECT topic_id, game_type, mastered, played_at FROM attempts WHERE student_user_id = ?'
  ).all(studentUserId);

  const alreadyEarned = new Set(
    db.prepare('SELECT badge_key FROM earned_badges WHERE student_user_id = ?')
      .all(studentUserId)
      .map(r => r.badge_key)
  );

  const insert = db.prepare(
    'INSERT OR IGNORE INTO earned_badges (student_user_id, badge_key, topic_id) VALUES (?, ?, ?)'
  );

  const newlyEarned = [];

  STATIC_BADGE_CATALOG.forEach(badge => {
    if (alreadyEarned.has(badge.key) || !badge.check(attempts)) return;
    insert.run(studentUserId, badge.key, null);
    newlyEarned.push({ key: badge.key, label: badge.label, emoji: badge.emoji, description: badge.description });
  });

  const masteredTopicIds = getFullyMasteredTopicIds(attempts);
  if (masteredTopicIds.length > 0) {
    const titleById = titlesForTopicIds(masteredTopicIds);
    masteredTopicIds.forEach(topicId => {
      const badge = topicMasteryBadge(topicId, titleById.get(topicId) || 'Topic');
      if (alreadyEarned.has(badge.key)) return;
      insert.run(studentUserId, badge.key, topicId);
      newlyEarned.push({ key: badge.key, label: badge.label, emoji: badge.emoji, description: badge.description });
    });
  }

  return newlyEarned;
}

// Full catalog for the "My Badges" view: earned (with timestamp) + locked
// (aspirational, shown greyed-out with the description as a hint).
function getBadgeShelf(studentUserId) {
  const attempts = db.prepare(
    'SELECT topic_id, game_type, mastered FROM attempts WHERE student_user_id = ?'
  ).all(studentUserId);

  const earnedRows = db.prepare(
    `SELECT eb.badge_key, eb.earned_at, eb.topic_id, t.title AS topic_title
     FROM earned_badges eb LEFT JOIN topics t ON t.id = eb.topic_id
     WHERE eb.student_user_id = ?`
  ).all(studentUserId);
  const earnedByKey = new Map(earnedRows.map(r => [r.badge_key, r]));

  const earned = [];
  const locked = [];

  STATIC_BADGE_CATALOG.forEach(badge => {
    const row = earnedByKey.get(badge.key);
    const meta = { key: badge.key, label: badge.label, emoji: badge.emoji, description: badge.description };
    if (row) earned.push({ ...meta, earnedAt: row.earned_at });
    else locked.push(meta);
  });

  // One per-topic mastery badge per topic the student has touched at all.
  const topicIds = Array.from(new Set(attempts.map(a => a.topic_id)));
  const titleById = titlesForTopicIds(topicIds);
  topicIds.forEach(topicId => {
    const badge = topicMasteryBadge(topicId, titleById.get(topicId) || 'Topic');
    const row = earnedByKey.get(badge.key);
    const meta = { key: badge.key, label: badge.label, emoji: badge.emoji, description: badge.description, topicId };
    if (row) earned.push({ ...meta, earnedAt: row.earned_at });
    else locked.push(meta);
  });

  return { earned, locked };
}

module.exports = { checkAndAwardBadges, getBadgeShelf };
