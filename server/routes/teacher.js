// server/routes/teacher.js
const express = require('express');
const db = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/auth');
const { generateGameKit } = require('../services/gameGenerator');

const router = express.Router();

// All routes here require a logged-in teacher
router.use(requireAuth, requireRole('teacher'));

function generateClassCode() {
  const words = ['FOX', 'OWL', 'BEE', 'CAT', 'ANT', 'ELK', 'JAY', 'COD', 'IBIS', 'LYNX'];
  const word = words[Math.floor(Math.random() * words.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${word}-${num}`;
}

// ============================================================
// CREATE A CLASS
// ============================================================
router.post('/classes', (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Please give the class a name.' });
    }

    // Class codes are short and could theoretically collide — retry a few times
    let code;
    let attempts = 0;
    do {
      code = generateClassCode();
      const exists = db.prepare('SELECT 1 FROM classes WHERE class_code = ?').get(code);
      if (!exists) break;
      attempts++;
    } while (attempts < 5);

    const insert = db.prepare(
      'INSERT INTO classes (name, teacher_user_id, class_code) VALUES (?, ?, ?)'
    );
    const result = insert.run(name.trim(), req.user.userId, code);

    res.status(201).json({
      id: result.lastInsertRowid,
      name: name.trim(),
      classCode: code
    });
  } catch (err) {
    console.error('Create class error:', err);
    res.status(500).json({ error: 'Something went wrong creating the class.' });
  }
});

// ============================================================
// LIST MY CLASSES (with roster counts)
// ============================================================
router.get('/classes', (req, res) => {
  try {
    const classes = db.prepare(`
      SELECT c.id, c.name, c.class_code, c.created_at,
             (SELECT COUNT(*) FROM student_profiles sp WHERE sp.class_id = c.id) AS student_count,
             (SELECT COUNT(*) FROM topics t WHERE t.class_id = c.id AND t.status = 'active') AS active_topic_count
      FROM classes c
      WHERE c.teacher_user_id = ?
      ORDER BY c.created_at DESC
    `).all(req.user.userId);

    res.json({ classes });
  } catch (err) {
    console.error('List classes error:', err);
    res.status(500).json({ error: 'Something went wrong loading your classes.' });
  }
});

// ---- helper: confirm this class belongs to the logged-in teacher ----
function getOwnedClassOrNull(classId, teacherUserId) {
  return db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_user_id = ?')
    .get(classId, teacherUserId);
}

// ============================================================
// GET ONE CLASS (roster + topics)
// ============================================================
router.get('/classes/:id', (req, res) => {
  try {
    const klass = getOwnedClassOrNull(req.params.id, req.user.userId);
    if (!klass) return res.status(404).json({ error: 'Class not found.' });

    const roster = db.prepare(`
      SELECT u.id, u.display_name, sp.username
      FROM student_profiles sp
      JOIN users u ON u.id = sp.user_id
      WHERE sp.class_id = ?
      ORDER BY u.display_name
    `).all(klass.id);

    const topics = db.prepare(`
      SELECT id, title, status, created_at
      FROM topics
      WHERE class_id = ?
      ORDER BY created_at DESC
    `).all(klass.id);

    res.json({
      class: { id: klass.id, name: klass.name, classCode: klass.class_code },
      roster,
      topics
    });
  } catch (err) {
    console.error('Get class error:', err);
    res.status(500).json({ error: 'Something went wrong loading this class.' });
  }
});

// ============================================================
// ASSIGN A TOPIC (generates the game kit via Claude, persists it)
// ============================================================
router.post('/classes/:id/topics', async (req, res) => {
  try {
    const klass = getOwnedClassOrNull(req.params.id, req.user.userId);
    if (!klass) return res.status(404).json({ error: 'Class not found.' });

    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Please enter a topic.' });
    }
    if (title.length > 100) {
      return res.status(400).json({ error: 'Topic name is too long.' });
    }

    const gameKit = await generateGameKit(title.trim());

    const insert = db.prepare(`
      INSERT INTO topics (class_id, title, status, game_kit_json)
      VALUES (?, ?, 'active', ?)
    `);
    const result = insert.run(klass.id, title.trim(), JSON.stringify(gameKit));

    res.status(201).json({
      id: result.lastInsertRowid,
      title: title.trim(),
      status: 'active',
      gameKit
    });
  } catch (err) {
    console.error('Assign topic error:', err);
    const message = err.userFacing || 'Something went wrong generating that topic\'s games. Please try again.';
    res.status(502).json({ error: message });
  }
});

// ============================================================
// ARCHIVE A TOPIC (soft-delete: keeps history/attempts intact)
// ============================================================
router.patch('/topics/:id/archive', (req, res) => {
  try {
    const topic = db.prepare(`
      SELECT t.* FROM topics t
      JOIN classes c ON c.id = t.class_id
      WHERE t.id = ? AND c.teacher_user_id = ?
    `).get(req.params.id, req.user.userId);

    if (!topic) return res.status(404).json({ error: 'Topic not found.' });

    db.prepare("UPDATE topics SET status = 'archived' WHERE id = ?").run(topic.id);
    res.json({ message: 'Topic archived.' });
  } catch (err) {
    console.error('Archive topic error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ============================================================
// CLASS METRICS (per-student, per-topic progress)
// ============================================================
router.get('/classes/:id/metrics', (req, res) => {
  try {
    const klass = getOwnedClassOrNull(req.params.id, req.user.userId);
    if (!klass) return res.status(404).json({ error: 'Class not found.' });

    // Per-student, per-topic, per-game-type: best score + total time + mastered flag
    const rows = db.prepare(`
      SELECT
        u.id AS student_id,
        u.display_name AS student_name,
        t.id AS topic_id,
        t.title AS topic_title,
        a.game_type,
        MAX(a.score * 1.0 / NULLIF(a.max_score, 0)) AS best_ratio,
        MAX(CASE WHEN a.mastered = 1 THEN 1 ELSE 0 END) AS mastered,
        SUM(a.time_spent_seconds) AS total_time_seconds,
        COUNT(*) AS attempt_count
      FROM attempts a
      JOIN users u ON u.id = a.student_user_id
      JOIN topics t ON t.id = a.topic_id
      WHERE t.class_id = ?
      GROUP BY u.id, t.id, a.game_type
      ORDER BY u.display_name, t.created_at
    `).all(klass.id);

    // Also include students with zero attempts, so the teacher sees who hasn't started
    const roster = db.prepare(`
      SELECT u.id, u.display_name
      FROM student_profiles sp JOIN users u ON u.id = sp.user_id
      WHERE sp.class_id = ?
    `).all(klass.id);

    const topics = db.prepare(`SELECT id, title FROM topics WHERE class_id = ? AND status = 'active'`).all(klass.id);

    res.json({ roster, topics, attempts: rows });
  } catch (err) {
    console.error('Class metrics error:', err);
    res.status(500).json({ error: 'Something went wrong loading metrics.' });
  }
});

module.exports = router;
