// server/routes/parent.js
const express = require('express');
const db = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('parent'));

// ---- helper: is this student actually linked to this parent? ----
function isLinked(parentUserId, studentUserId) {
  return !!db.prepare(
    'SELECT 1 FROM parent_student_links WHERE parent_user_id = ? AND student_user_id = ?'
  ).get(parentUserId, studentUserId);
}

// ============================================================
// LIST MY LINKED CHILDREN
// ============================================================
router.get('/children', (req, res) => {
  try {
    const children = db.prepare(`
      SELECT u.id, u.display_name, sp.username, c.name AS class_name
      FROM parent_student_links psl
      JOIN users u ON u.id = psl.student_user_id
      JOIN student_profiles sp ON sp.user_id = u.id
      JOIN classes c ON c.id = sp.class_id
      WHERE psl.parent_user_id = ?
      ORDER BY u.display_name
    `).all(req.user.userId);

    res.json({ children });
  } catch (err) {
    console.error('List children error:', err);
    res.status(500).json({ error: 'Something went wrong loading your children.' });
  }
});

// ============================================================
// ONE CHILD'S PROGRESS (must be linked to me)
// ============================================================
router.get('/children/:studentId/progress', (req, res) => {
  try {
    const studentId = req.params.studentId;

    if (!isLinked(req.user.userId, studentId)) {
      // 404, not 403 — don't reveal whether the student id even exists
      // to a parent who isn't linked to them
      return res.status(404).json({ error: 'Child not found.' });
    }

    const student = db.prepare('SELECT display_name FROM users WHERE id = ?').get(studentId);

    // Per-topic, per-game-type summary (same shape as the teacher metrics
    // endpoint, but scoped to a single student)
    const summary = db.prepare(`
      SELECT
        t.id AS topic_id,
        t.title AS topic_title,
        a.game_type,
        MAX(a.score * 1.0 / NULLIF(a.max_score, 0)) AS best_ratio,
        MAX(CASE WHEN a.mastered = 1 THEN 1 ELSE 0 END) AS mastered,
        SUM(a.time_spent_seconds) AS total_time_seconds,
        COUNT(*) AS attempt_count,
        MAX(a.played_at) AS last_played_at
      FROM attempts a
      JOIN topics t ON t.id = a.topic_id
      WHERE a.student_user_id = ?
      GROUP BY t.id, a.game_type
      ORDER BY last_played_at DESC
    `).all(studentId);

    // Recent activity feed (most recent individual attempts)
    const recent = db.prepare(`
      SELECT t.title AS topic_title, a.game_type, a.score, a.max_score,
             a.mastered, a.time_spent_seconds, a.played_at
      FROM attempts a
      JOIN topics t ON t.id = a.topic_id
      WHERE a.student_user_id = ?
      ORDER BY a.played_at DESC
      LIMIT 20
    `).all(studentId);

    res.json({
      student: { id: Number(studentId), name: student.display_name },
      summary,
      recent
    });
  } catch (err) {
    console.error('Child progress error:', err);
    res.status(500).json({ error: 'Something went wrong loading progress.' });
  }
});

module.exports = router;
