# Science Game Platform

A multi-role app for 4th-grade science: teachers assign topics and get 3
auto-generated games per topic (quiz, sort, match); students play them;
parents and teachers see real progress — scores, time spent, mastery —
all from the same underlying data.

## Architecture

```
public/
  index.html, shared/        Shared login/signup page, API client, base styles
  teacher/                   Class management, topic assignment, class metrics
  student/                   Topic list + the 3 game players
  parent/                    Linked children, per-child progress dashboard

server/
  server.js                  Express app entry point
  db/
    schema.sql, connection.js, init.js     SQLite (node:sqlite, built into Node 22+)
  auth/authUtils.js          Password hashing (bcrypt), JWT issue/verify
  middleware/auth.js         requireAuth + requireRole() route guards
  services/gameGenerator.js  Calls Claude API, builds + validates a game kit
  routes/
    auth.js                  signup (x3 roles), login, link-child
    teacher.js                classes, topics, roster, metrics
    student.js                 topics, game kit, record attempts, own progress
    parent.js                   linked children, child progress
```

One database, one set of API endpoints, three frontends that query the
same `attempts` table differently depending on who's logged in. See
`server/db/schema.sql` for the full data model — the short version:

```
classes ← topics ← attempts → users (student)
   ↑                              ↑
 teacher                  parent_student_links → parent
```

## Setup

```bash
node --version   # needs 22.5.0+  (uses node:sqlite, Node's built-in SQLite)

npm install
cp .env.example .env
```

Fill in `.env`:
- `JWT_SECRET` — generate with:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `ANTHROPIC_API_KEY` — see "Getting an API key" below

```bash
npm run init-db
npm start
```

Open **http://localhost:3000** — this is the shared login/signup page for
all three roles.

## Trying it out (full walkthrough)

1. Open `http://localhost:3000`, switch to the **Teacher** tab, **Sign up**.
2. On the teacher dashboard, click **+ New class**, give it a name. You'll
   get a **class code** (e.g. `FOX-1234`) — this is what students use to
   join.
3. Click into the class, go to the **Topics** tab, type a topic (e.g.
   "Photosynthesis"), click **Generate & assign**. This calls Claude to
   build the quiz/sort/match content — takes a few seconds.
4. Open a new browser tab (or incognito window) → `http://localhost:3000`
   → **Student** tab → **Sign up** → enter the class code from step 2.
5. The student sees the topic, clicks in, plays Quiz/Sort/Match. Each
   completed game is recorded as an "attempt."
6. Open another tab → **Parent** tab → **Sign up** → on the parent
   dashboard, click **+ Link a child** → enter the student's username.
7. Click into the linked child to see their progress: best scores, time
   spent, mastery, recent activity — all driven by what was played in
   step 5.
8. Back in the teacher tab, go to the **Metrics** sub-tab of the class to
   see the same data from a class-wide view.

## Getting an Anthropic API key

1. `console.anthropic.com` → sign up (separate from any claude.ai login)
   → add a small amount of credit (e.g. $5).
2. **API Keys** → **Create Key** → copy immediately.
3. Cost reference: Claude Sonnet 4.6 is $3 / million input tokens, $15 /
   million output tokens. Each topic generation is roughly $0.02. New
   accounts also get a small free credit to start with.

## Design decisions worth knowing about

**`node:sqlite` instead of `better-sqlite3`.** Node's built-in SQLite
module needs no native compilation (unlike `better-sqlite3`, which can
fail to install in restricted/offline environments). Marked
"experimental" by Node, but solid at this project's scale. One API
difference: there's no `db.transaction()` helper — multi-step
transactions use manual `db.exec('BEGIN' / 'COMMIT' / 'ROLLBACK')` (see
student signup in `routes/auth.js`).

**Sessions live in `sessionStorage`, not `localStorage`.** A login on a
shared classroom computer doesn't persist after the tab/browser closes —
a safer default given some users are children on shared devices.

**404, not 403, for access-control failures on personal data.** When a
parent requests a child they're not linked to, the API returns 404
("not found") rather than 403 ("forbidden"). A 403 would confirm the
student ID exists, which leaks information to anyone probing for valid
IDs — tested directly in development.

**The game kit's JSON shape is validated, not just parsed.** Valid JSON
can still have the wrong shape (e.g. a sort item referencing a category
ID that doesn't exist). `gameGenerator.js` checks structural integrity
right after generation, so a malformed result fails loudly there instead
of silently breaking the student's game player later.

**Mastery rule**: score/maxScore ≥ 80% counts as mastered for quiz and
match. For sort (no natural partial-credit score in the current
mechanic), finishing the game (every card correctly placed) counts as
mastered. This is a simple v1 rule — see "Extending it" below for how to
make it more nuanced.

## What's tested

Every route in every phase was exercised directly against a running
server (not just reasoned about) during development, including the
security-relevant edge cases:
- A teacher cannot view another teacher's class (404)
- A student cannot fetch a topic outside their own class (404)
- A parent cannot view a child they haven't linked, even with a valid
  token for a real child elsewhere (404)
- A student's valid, logged-in token is rejected on a parent-only route
  (403) — confirms role checks are enforced server-side, not just hidden
  in the UI
- Passwords are confirmed hashed (bcrypt) in the actual database file,
  never stored in plain text
- Mastery threshold computed correctly at both the 80%+ and below-80%
  boundary
- The full play → record → view pipeline: a student playing all 3 games
  immediately and correctly surfaces in both the parent's dashboard and
  the teacher's class metrics

What's **not** covered by automated tests: actual calls to the live
Claude API (the sandbox this was built in can't reach
`api.anthropic.com`), and the visual/interactive frontend in a real
browser (no headless browser available in the build environment). Test
the real generation flow and the UI yourself once you have an API key —
see the walkthrough above.

## Extending it

- **Smarter sort scoring**: track `wrongMoves` (already counted in
  `student.js`, just unused) and report partial credit instead of
  always-100%-on-completion.
- **Archived topics for students**: currently students only ever see
  `status = 'active'` topics. You could add a "past topics" view so they
  can replay/review previously taught material.
- **Teacher editing of generated content**: right now whatever Claude
  generates is final. A review/edit step before publishing to students
  would catch the rare bad generation before kids see it.
- **Email notifications**: notify a parent when their child completes a
  topic, using a transactional email service — a good next "real API
  integration" exercise once this is deployed.
- **Caching generations by topic name**: if multiple teachers assign
  "Photosynthesis," you're currently re-generating from scratch every
  time. A simple cache keyed by normalized topic title would cut costs
  and latency.

## Deploying (Render — free tier)

Same approach as the single-generator prototype:
1. Push to GitHub (`.gitignore` already excludes `.env`, `data.sqlite`,
   `node_modules` — verify with `git status` before your first commit).
2. `render.com` → **New** → **Web Service** → connect the repo.
3. Build command: `npm install && npm run init-db`
   Start command: `npm start`
4. Add environment variables: `ANTHROPIC_API_KEY`, `JWT_SECRET`.
5. Note: Render's free tier persists disk only within a single running
   instance — if the service restarts/redeploys, **`data.sqlite` is
   wiped** unless you attach a persistent disk (Render's paid "Disks"
   feature) or migrate to a hosted database later. Fine for testing;
   worth fixing before any real classroom relies on it long-term.
