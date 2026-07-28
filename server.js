// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');

const { initDb } = require('./db/init');
const { securityHeaders } = require('./middleware/security');
const { strictLimiter, authLimiter } = require('./middleware/rateLimit');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const memoryRoutes = require('./routes/memory');
const settingsRoutes = require('./routes/settings');
const voiceRoutes = require('./routes/voice');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

let dbReady = null;
function ensureDb() {
  if (!dbReady) dbReady = initDb();
  return dbReady;
}

// Security headers
app.use(securityHeaders);

// CORS
const corsOrigin = process.env.CORS_ORIGIN || (NODE_ENV === 'development' ? true : false);
app.use(cors({ origin: corsOrigin, credentials: true }));

// Body parsing
app.use(express.json({ limit: process.env.BODY_LIMIT || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.BODY_LIMIT || '10mb' }));

// DB initialization middleware
app.use((req, res, next) => {
  ensureDb().then(() => next()).catch(next);
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API rate limiting
app.use('/api', strictLimiter);
app.use('/api/auth', authLimiter);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/voice', voiceRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', env: NODE_ENV }));

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(err.status || 500).json({
    error: NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

if (require.main === module) {
  ensureDb()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Spider AI running on http://localhost:${PORT} [${NODE_ENV}]`);
      });
    })
    .catch(err => {
      console.error('Failed to initialize database', err);
      process.exit(1);
    });
}

module.exports = app;
