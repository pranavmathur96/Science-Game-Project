// server/auth/authUtils.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '7d'; // how long a login stays valid before re-login is required

if (!JWT_SECRET) {
  // Fail loudly at startup rather than silently signing tokens with "undefined"
  throw new Error(
    'JWT_SECRET is not set. Add it to your .env file. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
}

const SALT_ROUNDS = 10;

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

async function verifyPassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

// The JWT payload is intentionally minimal: just enough to identify
// who's asking and what role they have. Never put sensitive data
// (passwords, full profiles) inside a JWT — it's signed, not encrypted,
// so anyone can decode and read the payload (just not forge it).
function issueToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role, displayName: user.display_name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET); // throws if invalid/expired
}

module.exports = { hashPassword, verifyPassword, issueToken, verifyToken };
