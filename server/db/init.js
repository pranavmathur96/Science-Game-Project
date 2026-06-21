// server/db/init.js
// Run with: npm run init-db
// Creates data.sqlite (if it doesn't exist) and applies schema.sql.
// Safe to re-run — all CREATE statements use IF NOT EXISTS.

const fs = require('fs');
const path = require('path');
const db = require('./connection');

const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

console.log('Applying schema...');
db.exec(schema);
console.log('✅ Database ready at', process.env.DB_PATH || path.join(__dirname, '..', '..', 'data.sqlite'));

db.close();
