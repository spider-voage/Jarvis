// routes/v1/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { db } = require('../../db/init');
const { signToken } = require('../../middleware/auth');
const { auditLog } = require('../../middleware/security');
const subscriptionService = require('../../services/subscription');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/v1/auth/register
router.post('/register',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  auditLog('auth.register'),
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
        sql: 'INSERT INTO user_settings (user_id) VALUES (?)',
        args: [userId],
      });

      // Assign free plan
      const freePlan = await subscriptionService.getPlan('free');
      await db.execute({
        sql: 'UPDATE users SET current_plan_id = ? WHERE id = ?',
        args: [freePlan.id, userId],
      });

      res.status(201).json({
        token,
        user: { id: userId, email: email.toLowerCase(), name: name || null, role: 'user' },
      });
    } catch (err) {
      console.error('[auth/register]', err);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

// POST /api/v1/auth/login
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').exists(),
  auditLog('auth.login'),
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
        sql: 'SELECT id, email, name, role, password_hash, is_disabled FROM users WHERE email = ?',
        args: [email.toLowerCase()],
      });

      const user = result.rows[0];
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (user.is_disabled) {
        return res.status(403).json({ error: 'Account has been disabled. Contact support.' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = signToken(user.id);
      res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      });
    } catch (err) {
      console.error('[auth/login]', err);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

// GET /api/v1/auth/me
router.get('/me', async (req, res) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { verifyToken } = require('../../middleware/auth');
    const payload = verifyToken(token);
    const result = await db.execute({
      sql: 'SELECT id, email, name, role, is_disabled FROM users WHERE id = ?',
      args: [payload.userId],
    });
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.is_disabled) return res.status(403).json({ error: 'Account disabled' });

    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// PUT /api/v1/auth/profile
router.put('/profile',
  require('../../middleware/auth').requireAuth,
  auditLog('auth.update_profile'),
  async (req, res) => {
    try {
      const { name, email } = req.body || {};
      const updates = [];
      const args = [];

      if (name !== undefined) {
        updates.push('name = ?');
        args.push(name);
      }
      if (email !== undefined && EMAIL_RE.test(email)) {
        updates.push('email = ?');
        args.push(email.toLowerCase());
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      args.push(req.userId);
      await db.execute({
        sql: `UPDATE users SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
        args,
      });

      const result = await db.execute({
        sql: 'SELECT id, email, name, role FROM users WHERE id = ?',
        args: [req.userId],
      });

      res.json({ user: result.rows[0] });
    } catch (err) {
      console.error('[auth/profile]', err);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  }
);

// PUT /api/v1/auth/password
router.put('/password',
  require('../../middleware/auth').requireAuth,
  auditLog('auth.change_password'),
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: 'Current password and new password (min 8 chars) required' });
      }

      const result = await db.execute({
        sql: 'SELECT password_hash FROM users WHERE id = ?',
        args: [req.userId],
      });

      const user = result.rows[0];
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      const newHash = await bcrypt.hash(newPassword, 12);
      await db.execute({
        sql: 'UPDATE users SET password_hash = ? WHERE id = ?',
        args: [newHash, req.userId],
      });

      res.json({ updated: true });
    } catch (err) {
      console.error('[auth/password]', err);
      res.status(500).json({ error: 'Failed to change password' });
    }
  }
);

module.exports = router;
