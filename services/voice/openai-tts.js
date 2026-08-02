// services/voice/openai-tts.js
const fetch = globalThis.fetch || require('node-fetch');

const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = 'https://api.openai.com/v1';

function getVoices() {
  return [
    { id: 'alloy', name: 'Alloy', preview: 'Neutral and balanced' },
    { id: 'echo', name: 'Echo', preview: 'Warm and approachable' },
    { id: 'fable', name: 'Fable', preview: 'Expressive and animated' },
    { id: 'onyx', name: 'Onyx', preview: 'Deep and authoritative' },
    { id: 'nova', name: 'Nova', preview: 'Bright and energetic' },
    { id: 'shimmer', name: 'Shimmer', preview: 'Soft and clear' },
  ];
}

async function synthesize({ text, voiceId, speed }) {
  if (!API_KEY) throw new Error('OPENAI_API_KEY not configured');

  const voice = voiceId || process.env.OPENAI_TTS_VOICE || 'alloy';
  const model = process.env.OPENAI_TTS_MODEL || 'tts-1';

  const response = await fetch(`${BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      speed: speed ? parseFloat(speed) : 1.0,
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI TTS error (${response.status}): ${text}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { synthesize, getVoices };
