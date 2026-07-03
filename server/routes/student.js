// server/routes/student.js
const express = require('express');
const db = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/auth');
const { DISPLAY_COUNTS, selectWindow, selectSortWindow, computeMode } = require('../services/contentRotation');
const { checkAndAwardBadges, getBadgeShelf } = require('../services/badges');

const router = express.Router();

router.use(requireAuth, requireRole('student'));

// ---- helper: which class is this student in? ----
function getStudentClassId(studentUserId) {
  const profile = db.prepare('SELECT class_id FROM student_profiles WHERE user_id = ?').get(studentUserId);
  return profile ? profile.class_id : null;
}

// ============================================================
// LIST MY ACTIVE TOPICS
// ============================================================
router.get('/topics', (req, res) => {
  try {
    const classId = getStudentClassId(req.user.userId);
    if (!classId) return res.status(404).json({ error: 'No class found for this account.' });

    const topics = db.prepare(`
      SELECT id, title, class_id, created_at FROM topics
      WHERE class_id = ? AND status = 'active'
      ORDER BY created_at DESC
    `).all(classId);

    // Attach this student's best-known progress per topic so the UI can
    // show "not started / in progress / mastered" without a second round trip
    const topicsWithProgress = topics.map(topic => {
      const progress = db.prepare(`
        SELECT game_type, MAX(mastered) AS mastered, COUNT(*) AS attempt_count
        FROM attempts
        WHERE student_user_id = ? AND topic_id = ?
        GROUP BY game_type
      `).all(req.user.userId, topic.id);

      return { ...topic, progress };
    });

    res.json({ topics: topicsWithProgress });
  } catch (err) {
    console.error('List student topics error:', err);
    res.status(500).json({ error: 'Something went wrong loading your topics.' });
  }
});

// ============================================================
// GET ONE TOPIC'S GAME KIT (must belong to my class)
// ============================================================
router.get('/topics/:id/kit', (req, res) => {
  try {
    const classId = getStudentClassId(req.user.userId);
    if (!classId) return res.status(404).json({ error: 'No class found for this account.' });

    const topic = db.prepare(`
      SELECT id, title, game_kit_json FROM topics
      WHERE id = ? AND class_id = ? AND status = 'active'
    `).get(req.params.id, classId);

    if (!topic) return res.status(404).json({ error: 'Topic not found.' });

    const fullKit = JSON.parse(topic.game_kit_json);

    // How many times has this student already played each game type on this
    // topic? Drives which rotating slice + presentation mode they see next —
    // computed server-side from trusted attempt history, never client input.
    const playCounts = db.prepare(`
      SELECT game_type, COUNT(*) AS c FROM attempts
      WHERE student_user_id = ? AND topic_id = ?
      GROUP BY game_type
    `).all(req.user.userId, topic.id);
    const playIndex = { quiz: 0, sort: 0, match: 0 };
    playCounts.forEach(row => { playIndex[row.game_type] = row.c; });

    const seedBase = `${req.user.userId}-${topic.id}`;

    const quizQuestions = fullKit.quiz?.questions || [];
    const sortItems = fullKit.sort?.items || [];
    const matchPairs = fullKit.match?.pairs || [];

    const gameKit = {
      topic: fullKit.topic,
      quiz: { ...fullKit.quiz, questions: selectWindow(quizQuestions, `${seedBase}-quiz`, DISPLAY_COUNTS.quiz, playIndex.quiz) },
      sort: { ...fullKit.sort, items: selectSortWindow(fullKit.sort?.categories || [], sortItems, `${seedBase}-sort`, playIndex.sort) },
      match: { ...fullKit.match, pairs: selectWindow(matchPairs, `${seedBase}-match`, DISPLAY_COUNTS.match, playIndex.match) },
    };

    const modes = {
      quiz: computeMode(playIndex.quiz, 'quiz', quizQuestions.length),
      sort: computeMode(playIndex.sort, 'sort', sortItems.length),
      match: computeMode(playIndex.match, 'match', matchPairs.length),
    };

    res.json({ id: topic.id, title: topic.title, gameKit, modes });
  } catch (err) {
    console.error('Get topic kit error:', err);
    res.status(500).json({ error: 'Something went wrong loading this topic.' });
  }
});

// ============================================================
// RECORD AN ATTEMPT (called when a student finishes a game)
// ============================================================
router.post('/attempts', (req, res) => {
  try {
    const { topicId, gameType, score, maxScore, timeSpentSeconds, completed } = req.body;

    if (!topicId || !['quiz', 'sort', 'match'].includes(gameType)) {
      return res.status(400).json({ error: 'Invalid attempt data.' });
    }
    if (typeof timeSpentSeconds !== 'number' || timeSpentSeconds < 0 || timeSpentSeconds > 7200) {
      return res.status(400).json({ error: 'Invalid time spent.' });
    }

    const classId = getStudentClassId(req.user.userId);
    const topic = db.prepare('SELECT id FROM topics WHERE id = ? AND class_id = ?').get(topicId, classId);
    if (!topic) return res.status(404).json({ error: 'Topic not found for your class.' });

    // Mastery rule: score/maxScore >= 80%. If score/maxScore are absent
    // (e.g. a sort game with no numeric score), treat "completed" as mastered.
    let mastered = 0;
    if (typeof score === 'number' && typeof maxScore === 'number' && maxScore > 0) {
      mastered = (score / maxScore) >= 0.8 ? 1 : 0;
    } else if (completed) {
      mastered = 1;
    }

    const insert = db.prepare(`
      INSERT INTO attempts
        (student_user_id, topic_id, game_type, score, max_score, time_spent_seconds, completed, mastered)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = insert.run(
      req.user.userId,
      topicId,
      gameType,
      typeof score === 'number' ? score : null,
      typeof maxScore === 'number' ? maxScore : null,
      Math.round(timeSpentSeconds),
      completed ? 1 : 0,
      mastered
    );

    // Badge-checking must never fail the attempt itself — a bug in the
    // rule engine shouldn't cost a kid their saved progress.
    let newBadges = [];
    try {
      newBadges = checkAndAwardBadges(req.user.userId);
    } catch (badgeErr) {
      console.error('Badge check error:', badgeErr);
    }

    res.status(201).json({ id: result.lastInsertRowid, mastered: !!mastered, newBadges });
  } catch (err) {
    console.error('Record attempt error:', err);
    res.status(500).json({ error: 'Something went wrong saving your progress.' });
  }
});

// ============================================================
// MY BADGES (earned + locked/aspirational, for the "My Badges" view)
// ============================================================
router.get('/badges', (req, res) => {
  try {
    const shelf = getBadgeShelf(req.user.userId);
    res.json(shelf);
  } catch (err) {
    console.error('Get badge shelf error:', err);
    res.status(500).json({ error: 'Something went wrong loading your badges.' });
  }
});

// ============================================================
// MY OWN PROGRESS (so a kid can see their own growth, optionally shown in UI)
// ============================================================
router.get('/progress', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT t.title AS topic_title, a.game_type, a.score, a.max_score,
             a.mastered, a.played_at
      FROM attempts a
      JOIN topics t ON t.id = a.topic_id
      WHERE a.student_user_id = ?
      ORDER BY a.played_at DESC
      LIMIT 50
    `).all(req.user.userId);

    res.json({ attempts: rows });
  } catch (err) {
    console.error('Student progress error:', err);
    res.status(500).json({ error: 'Something went wrong loading your progress.' });
  }
});

module.exports = router;
