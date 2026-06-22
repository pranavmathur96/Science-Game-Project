// server/routes/google.js
// Handles "Sign in with Google" for teachers and parents.
// Flow:
//   1. Browser visits /api/auth/google?role=teacher (or parent)
//   2. Passport redirects to Google's login page
//   3. User logs in on Google's own page (we never see their password)
//   4. Google redirects back to /api/auth/google/callback
//   5. We find or create the user in our DB, issue our own JWT
//   6. Redirect to the right dashboard with the JWT in the URL hash
//      (the frontend reads it from the URL and stores it in sessionStorage)

const express = require('express');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const db = require('../db/connection');
const { issueToken } = require('../auth/authUtils');

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ---- Warn clearly at startup if Google OAuth isn't configured ----
// (The rest of the app still works fine without it — email/password
//  login is unaffected. Google login just won't be available.)
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.warn(
    '\n⚠️  GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set.\n' +
    '   Google sign-in will be disabled until these are added to .env\n'
  );
}

// ---- Passport strategy ----
// Passport calls this after Google confirms who the user is.
// `profile` contains their Google ID, name, and email.
passport.use(new GoogleStrategy(
  {
    clientID: GOOGLE_CLIENT_ID || 'not-configured',
    clientSecret: GOOGLE_CLIENT_SECRET || 'not-configured',
    callbackURL: `${BASE_URL}/api/auth/google/callback`,
    passReqToCallback: true, // lets us read req.session.oauthRole below
  },
  async (req, accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      const displayName = profile.displayName || email;
      const googleId = profile.id;

      // Which role is this login attempt for?
      // We stored it in the session when the flow started (see /api/auth/google below)
      const role = req.session.oauthRole || 'teacher';
      if (!['teacher', 'parent'].includes(role)) {
        return done(new Error('Google sign-in is only available for teachers and parents.'));
      }

      if (!email) {
        return done(new Error('No email returned from Google. Please try again.'));
      }

      // Find existing user by email OR by google_id (in case they signed up
      // with email/password first, then switch to Google later)
      let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

      if (user) {
        // User already exists — update their google_id if we don't have it yet,
        // and confirm their role matches (a teacher can't log in via the parent tab)
        if (user.role !== role) {
          return done(new Error(
            `This email is already registered as a ${user.role}. ` +
            `Please use the ${user.role} tab to log in.`
          ));
        }
        if (!user.google_id) {
          db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(googleId, user.id);
        }
      } else {
        // New user — create them automatically (no password needed for Google users)
        const result = db.prepare(
          'INSERT INTO users (email, password_hash, role, display_name, google_id) VALUES (?, ?, ?, ?, ?)'
        ).run(email, 'GOOGLE_AUTH_NO_PASSWORD', role, displayName, googleId);

        user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      }

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// Passport requires serialize/deserialize for session support,
// even though we're using JWTs (not server-side sessions) for the actual auth.
// We only use the session briefly to pass the role through the OAuth redirect.
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  done(null, user || false);
});

// ============================================================
// STEP 1: Start the Google login flow
// Called when user clicks "Continue with Google"
// URL: /api/auth/google?role=teacher  OR  /api/auth/google?role=parent
// ============================================================
router.get('/google', (req, res, next) => {
  const role = req.query.role;
  if (!['teacher', 'parent'].includes(role)) {
    return res.status(400).send('Invalid role. Must be teacher or parent.');
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.redirect(`/?error=Google+sign-in+is+not+configured+yet`);
  }

  // Store the role in the session so the callback knows which role to create
  req.session.oauthRole = role;

  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account', // always show account picker, even if already signed in
  })(req, res, next);
});

// ============================================================
// STEP 2: Google redirects back here after the user logs in
// Google sends a code, Passport exchanges it for profile info,
// our strategy (above) finds/creates the user, then we issue a JWT
// and redirect to the right dashboard.
// ============================================================
router.get('/google/callback',
  passport.authenticate('google', { failWithError: true }),
  (req, res) => {
    // Success: issue our own JWT exactly like the email/password login does
    const token = issueToken(req.user);
    const role = req.user.role;

    const dashboardMap = {
      teacher: '/teacher/index.html',
      parent: '/parent/index.html',
    };

    // Pass the token in the URL hash (#) so the frontend JS can read it
    // and store it in sessionStorage. The hash is never sent to the server,
    // so it's not logged — reasonably safe for this short-lived handoff.
    res.redirect(`${dashboardMap[role]}#token=${token}&displayName=${encodeURIComponent(req.user.display_name)}&role=${role}`);
  },
  // Error handler (passport.authenticate with failWithError calls next(err) on failure)
  (err, req, res, next) => {
    console.error('Google OAuth error:', err.message);
    const message = encodeURIComponent(err.message || 'Google sign-in failed. Please try again.');
    res.redirect(`/?error=${message}`);
  }
);

module.exports = router;
