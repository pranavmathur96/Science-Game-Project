// server/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ---- Auth routes (signup x3, login, link-child, me) ----
const { router: authRouter } = require('./routes/auth');
app.use('/api/auth', authRouter);

// ---- Role-specific routes ----
app.use('/api/teacher', require('./routes/teacher'));
app.use('/api/student', require('./routes/student'));
app.use('/api/parent', require('./routes/parent'));

// ---- Frontend ----
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback error handler — turns unexpected crashes into clean JSON
// instead of leaking stack traces to the client
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
