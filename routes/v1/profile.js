// routes/v1/profile.js
const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { auditLog } = require('../../middleware/security');
const { db } = require('../../db/init');
const subscriptionService = require('../../services/subscription');
const tokenTracker = require('../../services/ai/tokenTracker');

const router = express.Router();
router.use(requireAuth);

// GET /api/v1/profile
router.get('/', async (req, res) => {
  try {
    const [userResult, settingsResult, subResult] = await Promise.all([
      db.execute({ sql: 'SELECT id, email, name, role, created_at FROM users WHERE id = ?', args: [req.userId] }),
      db.execute({ sql: 'SELECT * FROM user_settings WHERE user_id = ?', args: [req.userId] }),
      subscriptionService.getUserSubscription(req.userId),
    ]);

    const user = userResult.rows[0];
    const settings = settingsResult.rows[0] || {};

    res.json({
      user,
      settings,
      subscription: subResult,
    });
  } catch (err) {
    console.error('[profile/get]', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// GET /api/v1/profile/usage
router.get('/usage', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const [todayUsage, history] = await Promise.all([
      tokenTracker.getDailyUsage(req.userId),
      tokenTracker.getUsageHistory(req.userId, days),
    ]);

    res.json({
      today: todayUsage,
      history,
    });
  } catch (err) {
    console.error('[profile/usage]', err);
    res.status(500).json({ error: 'Failed to load usage' });
  }
});

// PUT /api/v1/profile/settings
router.put('/settings', auditLog('profile.update_settings'), async (req, res) => {
  try {
    const allowed = [
      'theme', 'accent_color', 'voice_tts_provider', 'voice_tts_voice_id',
      'voice_speed', 'voice_volume', 'mic_sensitivity', 'language',
      'notifications_enabled', 'settings_json'
    ];
    const updates = [];
    const args = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = ?`);
        args.push(req.body[key]);
      }
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid settings provided' });
    }
    args.push(req.userId);
    await db.execute({
      sql: `UPDATE user_settings SET ${updates.join(', ')}, updated_at = datetime('now') WHERE user_id = ?`,
      args,
    });
    res.json({ saved: true });
  } catch (err) {
    console.error('[profile/settings]', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

module.exports = router;
