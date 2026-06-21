// server/routes/auth.js
const express = require('express');
const db = require('../db/connection');
const { hashPassword, verifyPassword, issueToken } = require('../auth/authUtils');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ---------- helpers ----------
function generateClassCode() {
  // Short, human-typeable code like "FOX-7392"
  const words = ['FOX', 'OWL', 'BEE', 'CAT', 'ANT', 'ELK', 'JAY', 'COD'];
  const word = words[Math.floor(Math.random() * words.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${word}-${num}`;
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8;
}

// ============================================================
// TEACHER SIGNUP
// ============================================================
router.post('/signup/teacher', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
    if (!isValidPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Please enter your name.' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });

    const passwordHash = await hashPassword(password);
    const insert = db.prepare(
      'INSERT INTO users (email, password_hash, role, display_name) VALUES (?, ?, ?, ?)'
    );
    const result = insert.run(email.toLowerCase(), passwordHash, 'teacher', name.trim());

    const user = { id: result.lastInsertRowid, role: 'teacher', display_name: name.trim() };
    const token = issueToken(user);

    res.status(201).json({ token, user: { id: user.id, role: 'teacher', displayName: name.trim() } });
  } catch (err) {
    console.error('Teacher signup error:', err);
    res.status(500).json({ error: 'Something went wrong creating your account.' });
  }
});

// ============================================================
// PARENT SIGNUP
// ============================================================
router.post('/signup/parent', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
    if (!isValidPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Please enter your name.' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });

    const passwordHash = await hashPassword(password);
    const insert = db.prepare(
      'INSERT INTO users (email, password_hash, role, display_name) VALUES (?, ?, ?, ?)'
    );
    const result = insert.run(email.toLowerCase(), passwordHash, 'parent', name.trim());

    const user = { id: result.lastInsertRowid, role: 'parent', display_name: name.trim() };
    const token = issueToken(user);

    res.status(201).json({ token, user: { id: user.id, role: 'parent', displayName: name.trim() } });
  } catch (err) {
    console.error('Parent signup error:', err);
    res.status(500).json({ error: 'Something went wrong creating your account.' });
  }
});

// ============================================================
// STUDENT SIGNUP  (username + password + class code, no email required)
// ============================================================
router.post('/signup/student', async (req, res) => {
  try {
    const { username, password, name, classCode } = req.body;

    if (!username || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }
    if (!isValidPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Please enter your name.' });
    if (!classCode || !classCode.trim()) return res.status(400).json({ error: 'Please enter your class code.' });

    const cleanUsername = username.trim().toLowerCase();

    const classRow = db.prepare('SELECT id FROM classes WHERE class_code = ?').get(classCode.trim().toUpperCase());
    if (!classRow) return res.status(404).json({ error: 'That class code was not found. Check with your teacher.' });

    const existingUsername = db.prepare('SELECT user_id FROM student_profiles WHERE username = ?').get(cleanUsername);
    if (existingUsername) return res.status(409).json({ error: 'That username is taken. Try another.' });

    const passwordHash = await hashPassword(password);

    // Two inserts need to succeed together (user + profile).
    // node:sqlite has no db.transaction() helper (unlike better-sqlite3),
    // so we manage the transaction manually with explicit SQL.
    let studentId;
    db.exec('BEGIN');
    try {
      const userInsert = db.prepare(
        'INSERT INTO users (email, password_hash, role, display_name) VALUES (NULL, ?, ?, ?)'
      );
      const userResult = userInsert.run(passwordHash, 'student', name.trim());
      studentId = userResult.lastInsertRowid;

      const profileInsert = db.prepare(
        'INSERT INTO student_profiles (user_id, username, class_id) VALUES (?, ?, ?)'
      );
      profileInsert.run(studentId, cleanUsername, classRow.id);

      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    const user = { id: studentId, role: 'student', display_name: name.trim() };
    const token = issueToken(user);

    res.status(201).json({ token, user: { id: user.id, role: 'student', displayName: name.trim() } });
  } catch (err) {
    console.error('Student signup error:', err);
    res.status(500).json({ error: 'Something went wrong creating the account.' });
  }
});

// ============================================================
// LOGIN  (shared across all 3 roles)
// identifier = email for teacher/parent, username for student
// ============================================================
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Please enter your login and password.' });
    }

    const clean = identifier.trim().toLowerCase();

    // Try email first (teacher/parent), then username (student)
    let userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(clean);

    if (!userRow) {
      const profile = db.prepare('SELECT * FROM student_profiles WHERE username = ?').get(clean);
      if (profile) {
        userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(profile.user_id);
      }
    }

    if (!userRow) {
      return res.status(401).json({ error: 'Incorrect login or password.' });
    }

    const passwordOk = await verifyPassword(password, userRow.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Incorrect login or password.' });
    }

    const token = issueToken(userRow);
    res.json({
      token,
      user: { id: userRow.id, role: userRow.role, displayName: userRow.display_name }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Something went wrong logging in.' });
  }
});

// ============================================================
// PARENT: link a child by their username
// ============================================================
router.post('/link-child', requireAuth, requireRole('parent'), (req, res) => {
  try {
    const { studentUsername } = req.body;
    if (!studentUsername || !studentUsername.trim()) {
      return res.status(400).json({ error: 'Please enter your child\'s username.' });
    }

    const profile = db.prepare('SELECT * FROM student_profiles WHERE username = ?')
      .get(studentUsername.trim().toLowerCase());

    if (!profile) {
      return res.status(404).json({ error: 'No student found with that username.' });
    }

    const alreadyLinked = db.prepare(
      'SELECT 1 FROM parent_student_links WHERE parent_user_id = ? AND student_user_id = ?'
    ).get(req.user.userId, profile.user_id);

    if (alreadyLinked) {
      return res.status(409).json({ error: 'This child is already linked to your account.' });
    }

    db.prepare(
      'INSERT INTO parent_student_links (parent_user_id, student_user_id) VALUES (?, ?)'
    ).run(req.user.userId, profile.user_id);

    const studentUser = db.prepare('SELECT display_name FROM users WHERE id = ?').get(profile.user_id);

    res.status(201).json({ message: `Linked to ${studentUser.display_name}.` });
  } catch (err) {
    console.error('Link child error:', err);
    res.status(500).json({ error: 'Something went wrong linking this child.' });
  }
});

// ============================================================
// GET CURRENT USER (used by frontend to verify token / restore session)
// ============================================================
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = { router, generateClassCode };
