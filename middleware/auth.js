// middleware/auth.js
const jwt = require('jsonwebtoken');
const { db } = require('../db/init');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET must be at least 32 characters');
  process.exit(1);
}

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const payload = verifyToken(token);
    if (!payload || !payload.userId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }

    // Verify user still exists and is not disabled
    const result = await db.execute({
      sql: 'SELECT id, role, is_disabled FROM users WHERE id = ?',
      args: [payload.userId],
    });

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.is_disabled) {
      return res.status(403).json({ error: 'Account has been disabled. Contact support.' });
    }

    req.userId = user.id;
    req.userRole = user.role;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please log in again.' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      const payload = verifyToken(token);
      const result = await db.execute({
        sql: 'SELECT id, role, is_disabled FROM users WHERE id = ?',
        args: [payload.userId],
      });
      const user = result.rows[0];
      if (user && !user.is_disabled) {
        req.userId = user.id;
        req.userRole = user.role;
      }
    }
    next();
  } catch {
    next();
  }
}

module.exports = { requireAuth, requireAdmin, optionalAuth, signToken, verifyToken };
