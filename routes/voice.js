// routes/voice.js
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { voiceLimiter } = require('../middleware/rateLimit');
const voiceService = require('../services/voice');

const router = express.Router();
router.use(requireAuth);
router.use(voiceLimiter);

// GET /api/voice/providers
router.get('/providers', async (req, res) => {
  try {
    const providers = voiceService.getProviders();
    res.json({ providers });
  } catch (err) {
    console.error('[voice/providers]', err);
    res.status(500).json({ error: 'Failed to get voice providers' });
  }
});

// POST /api/voice/tts
router.post('/tts', async (req, res) => {
  try {
    const { text, voiceId, speed, provider } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const audioBuffer = await voiceService.textToSpeech({
      text,
      voiceId,
      speed,
      provider,
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.send(audioBuffer);
  } catch (err) {
    console.error('[voice/tts]', err);
    res.status(500).json({ error: err.message || 'TTS failed' });
  }
});

// POST /api/voice/stt
router.post('/stt', async (req, res) => {
  try {
    if (!req.body || !req.body.audio) {
      return res.status(400).json({ error: 'audio data is required (base64)' });
    }
    const audioBuffer = Buffer.from(req.body.audio, 'base64');
    const transcript = await voiceService.speechToText(audioBuffer, req.body.provider);
    res.json({ transcript });
  } catch (err) {
    console.error('[voice/stt]', err);
    res.status(500).json({ error: err.message || 'STT failed' });
  }
});

module.exports = router;
