// services/voice/elevenlabs.js
const fetch = globalThis.fetch || require('node-fetch');

const API_KEY = process.env.ELEVENLABS_API_KEY;
const BASE_URL = 'https://api.elevenlabs.io/v1';

function getVoices() {
  return [
    { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', preview: 'Warm and natural' },
    { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', preview: 'Strong and energetic' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', preview: 'Soft and calm' },
    { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', preview: 'Confident and firm' },
    { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', preview: 'Friendly and casual' },
    { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', preview: 'Deep and authoritative' },
    { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', preview: 'Commanding and powerful' },
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', preview: 'Conversational and warm' },
  ];
}

async function synthesize({ text, voiceId, speed }) {
  if (!API_KEY) throw new Error('ELEVENLABS_API_KEY not configured');

  const vid = voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const model = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

  const response = await fetch(`${BASE_URL}/text-to-speech/${vid}/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': API_KEY,
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
        speed: speed ? parseFloat(speed) : 1.0,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ElevenLabs error (${response.status}): ${text}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { synthesize, getVoices };
