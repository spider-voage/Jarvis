// routes/v1/admin/index.js
const express = require('express');
const { requireAdmin } = require('../../../middleware/auth');
const { auditLog } = require('../../../middleware/security');
const { db } = require('../../../db/init');
const subscriptionService = require('../../../services/subscription');

const router = express.Router();
router.use(requireAdmin);

// GET /api/v1/admin/users
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let sql = `SELECT u.id, u.email, u.name, u.role, u.is_disabled, u.created_at,
               p.name as plan_name, s.status as subscription_status
               FROM users u
               LEFT JOIN subscriptions s ON s.user_id = u.id
               LEFT JOIN subscription_plans p ON COALESCE(s.plan_id, u.current_plan_id) = p.id`;
    const args = [];

    if (search) {
      sql += ' WHERE u.email LIKE ? OR u.name LIKE ?';
      args.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    const result = await db.execute({ sql, args });

    const countResult = await db.execute({
      sql: 'SELECT COUNT(*) as total FROM users',
    });

    res.json({
      users: result.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0].total,
        pages: Math.ceil(countResult.rows[0].total / limit),
      },
    });
  } catch (err) {
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// GET /api/v1/admin/users/:id
router.get('/users/:id', async (req, res) => {
  try {
    const [userResult, subResult, usageResult] = await Promise.all([
      db.execute({ sql: 'SELECT id, email, name, role, is_disabled, created_at FROM users WHERE id = ?', args: [req.params.id] }),
      subscriptionService.getUserSubscription(req.params.id),
      db.execute({ sql: 'SELECT * FROM usage_stats WHERE user_id = ? ORDER BY date DESC LIMIT 30', args: [req.params.id] }),
    ]);

    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ user, subscription: subResult, usage: usageResult.rows });
  } catch (err) {
    console.error('[admin/user]', err);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// POST /api/v1/admin/users/:id/disable
router.post('/users/:id/disable', auditLog('admin.disable_user'), async (req, res) => {
  try {
    const { reason } = req.body || {};
    await db.execute({
      sql: "UPDATE users SET is_disabled = 1, disabled_reason = ?, disabled_at = datetime('now') WHERE id = ?",
      args: [reason || 'Admin action', req.params.id],
    });
    res.json({ disabled: true });
  } catch (err) {
    console.error('[admin/disable-user]', err);
    res.status(500).json({ error: 'Failed to disable user' });
  }
});

// POST /api/v1/admin/users/:id/enable
router.post('/users/:id/enable', auditLog('admin.enable_user'), async (req, res) => {
  try {
    await db.execute({
      sql: "UPDATE users SET is_disabled = 0, disabled_reason = NULL, disabled_at = NULL WHERE id = ?",
      args: [req.params.id],
    });
    res.json({ enabled: true });
  } catch (err) {
    console.error('[admin/enable-user]', err);
    res.status(500).json({ error: 'Failed to enable user' });
  }
});

// GET /api/v1/admin/subscriptions
router.get('/subscriptions', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT s.*, u.email, u.name, p.name as plan_name, p.price_cents
            FROM subscriptions s
            JOIN users u ON s.user_id = u.id
            JOIN subscription_plans p ON s.plan_id = p.id
            ORDER BY s.created_at DESC`,
    });
    res.json({ subscriptions: result.rows });
  } catch (err) {
    console.error('[admin/subscriptions]', err);
    res.status(500).json({ error: 'Failed to load subscriptions' });
  }
});

// GET /api/v1/admin/revenue
router.get('/revenue', async (req, res) => {
  try {
    const [totalResult, monthlyResult, byProvider] = await Promise.all([
      db.execute({ sql: "SELECT SUM(amount_cents) as total, COUNT(*) as count FROM payments WHERE status = 'succeeded'" }),
      db.execute({
        sql: `SELECT strftime('%Y-%m', created_at) as month, SUM(amount_cents) as revenue, COUNT(*) as count
              FROM payments WHERE status = 'succeeded' GROUP BY month ORDER BY month DESC LIMIT 12`,
      }),
      db.execute({
        sql: `SELECT provider, SUM(amount_cents) as revenue, COUNT(*) as count
              FROM payments WHERE status = 'succeeded' GROUP BY provider`,
      }),
    ]);

    res.json({
      total: { revenue_cents: totalResult.rows[0]?.total || 0, payments: totalResult.rows[0]?.count || 0 },
      monthly: monthlyResult.rows,
      byProvider: byProvider.rows,
    });
  } catch (err) {
    console.error('[admin/revenue]', err);
    res.status(500).json({ error: 'Failed to load revenue' });
  }
});

// GET /api/v1/admin/usage
router.get('/usage', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const result = await db.execute({
      sql: `SELECT date, SUM(messages_sent) as messages_sent, SUM(messages_received) as messages_received,
            SUM(tokens_input) as tokens_input, SUM(tokens_output) as tokens_output,
            SUM(voice_minutes_used) as voice_minutes, SUM(api_calls) as api_calls
            FROM usage_stats WHERE date >= date('now', '-${days} days') GROUP BY date ORDER BY date DESC`,
    });
    res.json({ usage: result.rows });
  } catch (err) {
    console.error('[admin/usage]', err);
    res.status(500).json({ error: 'Failed to load usage' });
  }
});

// GET /api/v1/admin/logs
router.get('/logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const offset = (page - 1) * limit;

    const result = await db.execute({
      sql: `SELECT l.*, u.email FROM audit_logs l LEFT JOIN users u ON l.user_id = u.id
            ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      args: [limit, offset],
    });

    res.json({ logs: result.rows });
  } catch (err) {
    console.error('[admin/logs]', err);
    res.status(500).json({ error: 'Failed to load logs' });
  }
});

// GET /api/v1/admin/announcements
router.get('/announcements', async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'SELECT * FROM announcements ORDER BY created_at DESC',
    });
    res.json({ announcements: result.rows });
  } catch (err) {
    console.error('[admin/announcements]', err);
    res.status(500).json({ error: 'Failed to load announcements' });
  }
});

// POST /api/v1/admin/announcements
router.post('/announcements', auditLog('admin.create_announcement'), async (req, res) => {
  try {
    const { title, content, type, starts_at, ends_at } = req.body || {};
    if (!title || !content) return res.status(400).json({ error: 'title and content required' });

    const result = await db.execute({
      sql: 'INSERT INTO announcements (title, content, type, starts_at, ends_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      args: [title, content, type || 'info', starts_at || null, ends_at || null, req.userId],
    });

    res.status(201).json({ id: Number(result.lastInsertRowid), title, content });
  } catch (err) {
    console.error('[admin/create-announcement]', err);
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

// DELETE /api/v1/admin/announcements/:id
router.delete('/announcements/:id', auditLog('admin.delete_announcement'), async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM announcements WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[admin/delete-announcement]', err);
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

module.exports = router;
