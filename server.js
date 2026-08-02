// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const { initDb } = require('./db/init');
const { securityHeaders } = require('./middleware/security');
const { strictLimiter, authLimiter } = require('./middleware/rateLimit');

// v1 Routes
const authRoutes = require('./routes/v1/auth');
const chatRoutes = require('./routes/v1/chat');
const memoryRoutes = require('./routes/v1/memory');
const voiceRoutes = require('./routes/v1/voice');
const subscriptionRoutes = require('./routes/v1/subscriptions');
const paymentRoutes = require('./routes/v1/payments');
const profileRoutes = require('./routes/v1/profile');
const adminRoutes = require('./routes/v1/admin');

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

// Helmet for additional security
app.use(helmet({
  contentSecurityPolicy: false, // We set CSP manually in securityHeaders
  crossOriginEmbedderPolicy: false,
}));

// Compression
app.use(compression());

// Logging
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

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
app.use('/api/v1/auth', authLimiter);

// Legacy API routes (backward compatibility)
const legacyAuth = require('./routes/auth');
const legacyChat = require('./routes/chat');
const legacyMemory = require('./routes/memory');
const legacySettings = require('./routes/settings');
const legacyVoice = require('./routes/voice');

app.use('/api/auth', legacyAuth);
app.use('/api/chat', legacyChat);
app.use('/api/memory', legacyMemory);
app.use('/api/settings', legacySettings);
app.use('/api/voice', legacyVoice);

// v1 API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/memory', memoryRoutes);
app.use('/api/v1/voice', voiceRoutes);
app.use('/api/v1/subscriptions', subscriptionRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', env: NODE_ENV, version: '2.0.0' }));

// SPA fallback
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
        console.log(`Spider AI v2.0 running on http://localhost:${PORT} [${NODE_ENV}]`);
      });
    })
    .catch(err => {
      console.error('Failed to initialize database', err);
      process.exit(1);
    });
}

module.exports = app;
