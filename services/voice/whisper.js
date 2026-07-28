// services/voice/whisper.js
const fetch = globalThis.fetch || require('node-fetch');
const FormData = require('form-data');

const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = 'https://api.openai.com/v1';

async function transcribe(audioBuffer) {
  if (!API_KEY) throw new Error('OPENAI_API_KEY not configured for Whisper');

  const form = new FormData();
  form.append('file', audioBuffer, { filename: 'audio.webm', contentType: 'audio/webm' });
  form.append('model', process.env.WHISPER_MODEL || 'whisper-1');
  form.append('language', ''); // auto-detect

  const response = await fetch(`${BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Whisper error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.text || '';
}

module.exports = { transcribe };
