// routes/settings.js
const express = require('express');
const { db } = require('../db/init');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT theme, accent_color, voice_tts_provider, voice_tts_voice_id,
            voice_speed, voice_volume, mic_sensitivity, language,
            notifications_enabled, settings_json
            FROM user_settings WHERE user_id = ?`,
      args: [req.userId],
    });
    if (result.rows.length === 0) {
      // Create defaults
      await db.execute({
        sql: 'INSERT INTO user_settings (user_id) VALUES (?)',
        args: [req.userId],
      });
      return res.json({
        theme: 'dark',
        accent_color: '#00d4ff',
        voice_tts_provider: 'elevenlabs',
        voice_tts_voice_id: '',
        voice_speed: 1.0,
        voice_volume: 1.0,
        mic_sensitivity: 0.5,
        language: 'auto',
        notifications_enabled: 1,
        settings_json: '{}',
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[settings/get]', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// PUT /api/settings
router.put('/', async (req, res) => {
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
    console.error('[settings/put]', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

module.exports = router;
