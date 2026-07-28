// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { db } = require('../db/init');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function signToken(userId) {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /api/auth/register
router.post('/register',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Invalid input', details: errors.array() });
      }

      const { email, password, name } = req.body || {};

      if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'Valid email is required' });
      }
      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      const existing = await db.execute({
        sql: 'SELECT id FROM users WHERE email = ?',
        args: [email.toLowerCase()],
      });
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'An account with that email already exists' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const result = await db.execute({
        sql: 'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
        args: [email.toLowerCase(), passwordHash, name || null],
      });

      const userId = Number(result.lastInsertRowid);
      const token = signToken(userId);

      // Create default settings
      await db.execute({
        sql: `INSERT INTO user_settings (user_id) VALUES (?)`,
        args: [userId],
      });

      res.status(201).json({
        token,
        user: { id: userId, email: email.toLowerCase(), name: name || null },
      });
    } catch (err) {
      console.error('[auth/register]', err);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

// POST /api/auth/login
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').exists(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Invalid input', details: errors.array() });
      }

      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const result = await db.execute({
        sql: 'SELECT id, email, name, password_hash FROM users WHERE email = ?',
        args: [email.toLowerCase()],
      });

      const user = result.rows[0];
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = signToken(user.id);
      res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name },
      });
    } catch (err) {
      console.error('[auth/login]', err);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

// GET /api/auth/me
router.get('/me', async (req, res) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const result = await db.execute({
      sql: 'SELECT id, email, name FROM users WHERE id = ?',
      args: [payload.userId],
    });
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
