// services/voice/index.js
// Modular voice provider system — switch providers via env vars without code changes

const elevenlabs = require('./elevenlabs');
const openaiTTS = require('./openai-tts');
const whisper = require('./whisper');

const TTS_PROVIDERS = {
  elevenlabs,
  openai: openaiTTS,
};

const STT_PROVIDERS = {
  whisper,
};

function getDefaultTTSProvider() {
  return process.env.VOICE_TTS_PROVIDER || 'elevenlabs';
}

function getDefaultSTTProvider() {
  return process.env.VOICE_STT_PROVIDER || 'whisper';
}

function getProviders() {
  const tts = getDefaultTTSProvider();
  const stt = getDefaultSTTProvider();
  return {
    tts: {
      current: tts,
      available: Object.keys(TTS_PROVIDERS).map(k => ({
        id: k,
        name: k === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI',
        voices: TTS_PROVIDERS[k].getVoices ? TTS_PROVIDERS[k].getVoices() : [],
      })),
    },
    stt: {
      current: stt,
      available: Object.keys(STT_PROVIDERS).map(k => ({
        id: k,
        name: k === 'whisper' ? 'OpenAI Whisper' : k,
      })),
    },
  };
}

async function textToSpeech({ text, voiceId, speed, provider }) {
  const prov = provider || getDefaultTTSProvider();
  if (prov === 'disabled' || prov === 'none') {
    throw new Error('Voice TTS is disabled');
  }
  const handler = TTS_PROVIDERS[prov];
  if (!handler) throw new Error(`Unknown TTS provider: ${prov}`);
  return handler.synthesize({ text, voiceId, speed });
}

async function speechToText(audioBuffer, provider) {
  const prov = provider || getDefaultSTTProvider();
  if (prov === 'browser' || prov === 'disabled') {
    throw new Error('Server-side STT not configured. Use browser STT.');
  }
  const handler = STT_PROVIDERS[prov];
  if (!handler) throw new Error(`Unknown STT provider: ${prov}`);
  return handler.transcribe(audioBuffer);
}

module.exports = {
  getProviders,
  textToSpeech,
  speechToText,
};
