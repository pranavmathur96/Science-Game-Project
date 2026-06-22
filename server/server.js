// server/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const passport = require('passport');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Session middleware — only used briefly during the Google OAuth redirect flow.
// Not used for anything else (regular auth uses JWTs, not server-side sessions).
app.use(session({
  secret: process.env.JWT_SECRET || 'fallback-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 5 * 60 * 1000 } // 5 min — just long enough for the OAuth round trip
}));

app.use(passport.initialize());
app.use(passport.session());

// ---- Auth routes (signup x3, login, link-child, me) ----
const { router: authRouter } = require('./routes/auth');
app.use('/api/auth', authRouter);

// ---- Google OAuth routes ----
app.use('/api/auth', require('./routes/google'));

// ---- Role-specific routes ----
app.use('/api/teacher', require('./routes/teacher'));
app.use('/api/student', require('./routes/student'));
app.use('/api/parent', require('./routes/parent'));

// ---- Frontend ----
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
