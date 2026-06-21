-- schema.sql
-- Run via `npm run init-db`. Safe to re-run: uses CREATE TABLE IF NOT EXISTS.

-- ============ USERS (base identity for all 3 roles) ============
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,                  -- used by teacher/parent; NULL allowed for students
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('teacher', 'parent', 'student')),
  display_name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ============ STUDENT-SPECIFIC PROFILE ============
-- Students log in with a username (easier for a kid to type than an email)
CREATE TABLE IF NOT EXISTS student_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  username TEXT UNIQUE NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id)
);

-- ============ PARENT <-> STUDENT LINKS ============
-- Many-to-many: one parent can have multiple kids; one kid could have multiple linked parents
CREATE TABLE IF NOT EXISTS parent_student_links (
  parent_user_id INTEGER NOT NULL REFERENCES users(id),
  student_user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (parent_user_id, student_user_id)
);

-- ============ CLASSES ============
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  teacher_user_id INTEGER NOT NULL REFERENCES users(id),
  class_code TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ============ TOPICS (assigned by teacher, contains the generated game kit) ============
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  game_kit_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ============ ATTEMPTS (the core progress record) ============
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_user_id INTEGER NOT NULL REFERENCES users(id),
  topic_id INTEGER NOT NULL REFERENCES topics(id),
  game_type TEXT NOT NULL CHECK(game_type IN ('quiz','sort','match')),
  score INTEGER,
  max_score INTEGER,
  time_spent_seconds INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  mastered INTEGER NOT NULL DEFAULT 0,
  played_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_topic ON attempts(topic_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_class ON student_profiles(class_id);
