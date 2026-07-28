// routes/memory.js
const express = require('express');
const { db } = require('../db/init');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/memory
router.get('/', async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'SELECT id, key, value, updated_at FROM memories WHERE user_id = ? ORDER BY updated_at DESC',
      args: [req.userId],
    });
    res.json({ memories: result.rows });
  } catch (err) {
    console.error('[memory/list]', err);
    res.status(500).json({ error: 'Failed to load memories' });
  }
});

// PUT /api/memory/:key
router.put('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body || {};
    if (value === undefined || value === null) {
      return res.status(400).json({ error: 'value is required' });
    }

    await db.execute({
      sql: `INSERT INTO memories (user_id, key, value, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(user_id, key)
            DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      args: [req.userId, key, value],
    });

    res.json({ key, value });
  } catch (err) {
    console.error('[memory/put]', err);
    res.status(500).json({ error: 'Failed to save memory' });
  }
});

// DELETE /api/memory/:key
router.delete('/:key', async (req, res) => {
  try {
    await db.execute({
      sql: 'DELETE FROM memories WHERE user_id = ? AND key = ?',
      args: [req.userId, req.params.key],
    });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[memory/delete]', err);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

module.exports = router;
