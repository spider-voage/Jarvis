// middleware/rateLimit.js
const rateLimit = require('express-rate-limit');

const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => {
    // Pro users get higher limits
    if (req.userRole === 'admin') return 200;
    return 60;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
  keyGenerator: (req) => req.userId ? `user:${req.userId}` : req.ip,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again later.' },
  keyGenerator: (req) => req.ip,
});

const voiceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => {
    if (req.userRole === 'admin') return 100;
    return 30;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Voice rate limit exceeded.' },
  keyGenerator: (req) => req.userId ? `voice:${req.userId}` : req.ip,
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => {
    if (req.userRole === 'admin') return 200;
    return 60;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Chat rate limit exceeded. Please wait.' },
  keyGenerator: (req) => req.userId ? `chat:${req.userId}` : req.ip,
});

module.exports = { strictLimiter, authLimiter, voiceLimiter, chatLimiter };
