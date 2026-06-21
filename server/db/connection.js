// server/db/connection.js
// Single shared SQLite connection. node:sqlite is Node's built-in SQLite
// module (no native compilation, no extra install) — currently marked
// experimental by Node but stable enough for this project's scale.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data.sqlite');

const db = new DatabaseSync(DB_PATH);

// Enforce foreign key constraints (SQLite has them off by default per-connection)
db.exec('PRAGMA foreign_keys = ON;');

module.exports = db;
