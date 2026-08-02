// routes/v1/voice.js
const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { voiceLimiter } = require('../../middleware/rateLimit');
const { auditLog } = require('../../middleware/security');
const voiceService = require('../../services/voice');
const subscriptionService = require('../../services/subscription');
const { db } = require('../../db/init');

const router = express.Router();
router.use(requireAuth);

// Middleware to check voice access
async function requireVoiceAccess(req, res, next) {
  try {
    const hasVoice = await subscriptionService.checkFeatureAccess(req.userId, 'voice');
    if (!hasVoice) {
      return res.status(403).json({ error: 'Voice is a Pro feature. Upgrade your plan to use voice conversations.' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/voice/providers
router.get('/providers', async (req, res) => {
  try {
    const providers = voiceService.getProviders();
    res.json({ providers });
  } catch (err) {
    console.error('[voice/providers]', err);
    res.status(500).json({ error: 'Failed to get voice providers' });
  }
});

// POST /api/v1/voice/tts
router.post('/tts', voiceLimiter, requireVoiceAccess, auditLog('voice.tts'), async (req, res) => {
  try {
    const { text, voiceId, speed, provider } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const audioBuffer = await voiceService.textToSpeech({ text, voiceId, speed, provider });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.send(audioBuffer);
  } catch (err) {
    console.error('[voice/tts]', err);
    res.status(500).json({ error: err.message || 'TTS failed' });
  }
});

// POST /api/v1/voice/stt
router.post('/stt', voiceLimiter, requireVoiceAccess, auditLog('voice.stt'), async (req, res) => {
  try {
    if (!req.body || !req.body.audio) {
      return res.status(400).json({ error: 'audio data is required (base64)' });
    }
    const audioBuffer = Buffer.from(req.body.audio, 'base64');
    const transcript = await voiceService.speechToText(audioBuffer, req.body.provider);

    // Log voice session
    await db.execute({
      sql: 'INSERT INTO voice_sessions (user_id, provider, transcript) VALUES (?, ?, ?)',
      args: [req.userId, req.body.provider || 'whisper', transcript],
    });

    res.json({ transcript });
  } catch (err) {
    console.error('[voice/stt]', err);
    res.status(500).json({ error: err.message || 'STT failed' });
  }
});

// POST /api/v1/voice/session
router.post('/session', voiceLimiter, requireVoiceAccess, auditLog('voice.session'), async (req, res) => {
  try {
    const { transcript, responseText, durationSeconds, provider } = req.body || {};
    await db.execute({
      sql: 'INSERT INTO voice_sessions (user_id, provider, duration_seconds, transcript, response_text) VALUES (?, ?, ?, ?, ?)',
      args: [req.userId, provider || 'whisper', durationSeconds || 0, transcript || '', responseText || ''],
    });

    // Update voice usage
    const today = new Date().toISOString().split('T')[0];
    const minutes = (durationSeconds || 0) / 60;
    await db.execute({
      sql: `INSERT INTO usage_stats (user_id, date, voice_minutes_used) VALUES (?, ?, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET voice_minutes_used = voice_minutes_used + excluded.voice_minutes_used`,
      args: [req.userId, today, minutes],
    });

    res.json({ recorded: true });
  } catch (err) {
    console.error('[voice/session]', err);
    res.status(500).json({ error: 'Failed to record voice session' });
  }
});

// GET /api/v1/voice/usage
router.get('/usage', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await db.execute({
      sql: 'SELECT voice_minutes_used FROM usage_stats WHERE user_id = ? AND date = ?',
      args: [req.userId, today],
    });
    res.json({ voice_minutes_today: result.rows[0]?.voice_minutes_used || 0 });
  } catch (err) {
    console.error('[voice/usage]', err);
    res.status(500).json({ error: 'Failed to get voice usage' });
  }
});

module.exports = router;
