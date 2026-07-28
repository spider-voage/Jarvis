# Spider AI

A premium voice-enabled AI assistant with a cinematic futuristic HUD interface, built with Node.js/Express, libSQL/Turso, and vanilla JavaScript.

## Features

- **Premium Futuristic HUD** — Dark navy/black theme with electric blue/cyan accents, glassmorphism panels, particle effects, and smooth animations
- **Voice Assistant** — High-quality TTS (ElevenLabs/OpenAI), accurate STT (Web Speech API + Whisper fallback), push-to-talk, hands-free mode, real-time waveform visualization, and interrupt capability
- **Streaming Chat** — Real-time SSE streaming with markdown rendering, syntax highlighting, and message actions (copy, edit, regenerate, delete)
- **Conversation Management** — Persistent chat history with search, rename, and delete
- **Settings** — Theme, accent colors, voice provider/voice selection, speed/volume, mic sensitivity, language, notifications, export/import
- **Security** — JWT auth with bcrypt, rate limiting, CSP headers, input sanitization, API keys never exposed to frontend
- **PWA** — Offline support, installable app, responsive design
- **Keyboard Shortcuts** — `/` to focus, `Ctrl+N` new chat, `Ctrl+,` settings, `Space` push-to-talk, `Ctrl+Shift+L` theme toggle
- **File Upload** — Drag-and-drop images and text files

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env with your keys
npm start
```

Visit `http://localhost:3000`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | yes | Long random string for JWT signing |
| `OPENROUTER_API_KEY` | yes | From [openrouter.ai](https://openrouter.ai) |
| `AI_MODEL` | no | Defaults to `openai/gpt-4o-mini` |
| `TURSO_DATABASE_URL` | no | Defaults to `file:local.db` |
| `TURSO_AUTH_TOKEN` | no | Only for hosted Turso |
| `ELEVENLABS_API_KEY` | no | For ElevenLabs TTS |
| `OPENAI_API_KEY` | no | For OpenAI TTS or Whisper STT |
| `VOICE_TTS_PROVIDER` | no | `elevenlabs`, `openai`, or `disabled` |
| `VOICE_STT_PROVIDER` | no | `browser` (default), `whisper` |

## Voice API Setup

### ElevenLabs (Recommended)
1. Get an API key from [elevenlabs.io](https://elevenlabs.io)
2. Set `ELEVENLABS_API_KEY` in `.env`
3. Set `VOICE_TTS_PROVIDER=elevenlabs`

### OpenAI TTS
1. Set `OPENAI_API_KEY` in `.env`
2. Set `VOICE_TTS_PROVIDER=openai`

### Speech-to-Text
- **Browser** (default): Uses Web Speech API — no API key needed, works in Chrome/Edge/Safari
- **Whisper**: Set `OPENAI_API_KEY` and `VOICE_STT_PROVIDER=whisper`

## Deploying

### Vercel
1. Push to GitHub
2. Import into Vercel
3. Set environment variables in Vercel dashboard
4. Set `TURSO_DATABASE_URL` to a real Turso DB for production

### Render / Railway / VPS
1. Set env vars on platform
2. `npm start`

## Architecture

```
spider-ai/
├── server.js              # Express server, SPA fallback
├── db/init.js             # libSQL schema & connection
├── middleware/            # Auth, security headers, rate limiting
├── routes/                # Auth, Chat, Memory, Settings, Voice
├── services/voice/        # Modular TTS/STT providers
├── public/
│   ├── css/style.css      # Futuristic HUD styles
│   ├── js/app.js          # SPA application logic
│   ├── index.html         # Main shell
│   ├── manifest.json      # PWA manifest
│   └── sw.js              # Service worker
└── .env.example
```

## License

MIT
