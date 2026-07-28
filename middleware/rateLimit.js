// middleware/rateLimit.js
const rateLimit = require('express-rate-limit');

const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
  keyGenerator: (req) => req.ip,
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
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Voice rate limit exceeded.' },
  keyGenerator: (req) => req.ip,
});

module.exports = { strictLimiter, authLimiter, voiceLimiter };
