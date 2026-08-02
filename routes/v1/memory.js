// routes/v1/memory.js
const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const memoryManager = require('../../services/ai/memoryManager');

const router = express.Router();
router.use(requireAuth);

// GET /api/v1/memory
router.get('/', async (req, res) => {
  try {
    const memories = await memoryManager.getMemories(req.userId);
    res.json({ memories });
  } catch (err) {
    console.error('[memory/list]', err);
    res.status(500).json({ error: 'Failed to load memories' });
  }
});

// PUT /api/v1/memory/:key
router.put('/:key', async (req, res) => {
  try {
    const { value } = req.body || {};
    if (value === undefined || value === null) {
      return res.status(400).json({ error: 'value is required' });
    }
    const result = await memoryManager.setMemory(req.userId, req.params.key, value);
    res.json(result);
  } catch (err) {
    console.error('[memory/put]', err);
    res.status(500).json({ error: 'Failed to save memory' });
  }
});

// DELETE /api/v1/memory/:key
router.delete('/:key', async (req, res) => {
  try {
    await memoryManager.deleteMemory(req.userId, req.params.key);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[memory/delete]', err);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

module.exports = router;
