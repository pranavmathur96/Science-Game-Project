// server/middleware/auth.js
const { verifyToken } = require('../auth/authUtils');

// Reads "Authorization: Bearer <token>", verifies it, attaches req.user.
// Use on any route that requires someone to be logged in.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload; // { userId, role, displayName }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

// Use AFTER requireAuth on routes restricted to specific roles.
// Example: router.get('/metrics', requireAuth, requireRole('teacher'), handler)
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
