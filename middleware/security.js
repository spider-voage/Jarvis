// middleware/security.js
const crypto = require('crypto');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.nonce = nonce;

  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: blob: https:; " +
    "connect-src 'self' https://openrouter.ai https://api.elevenlabs.io https://api.openai.com https://api.stripe.com; " +
    "media-src 'self' blob:; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self';"
  );
  next();
}

function sanitizeInput(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    const sanitize = (str) => {
      if (typeof str !== 'string') return str;
      return str
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '\/');
    };

    const walk = (obj) => {
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'string') {
          obj[key] = sanitize(obj[key]);
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          walk(obj[key]);
        }
      }
    };
    walk(req.body);
  }
  next();
}

function auditLog(action) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      // Fire and forget audit log
      const { db } = require('../db/init');
      db.execute({
        sql: `INSERT INTO audit_logs (user_id, action, resource, ip_address, user_agent, details_json)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          req.userId || null,
          action,
          req.originalUrl,
          req.ip || req.connection?.remoteAddress,
          req.headers['user-agent']?.slice(0, 512),
          JSON.stringify({ method: req.method, statusCode: res.statusCode })
        ],
      }).catch(() => {});
      return originalJson(data);
    };
    next();
  };
}

module.exports = { securityHeaders, sanitizeInput, auditLog };
