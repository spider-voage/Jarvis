# Spider AI v2.0

A modern intelligent assistant with premium voice, subscriptions, and advanced AI architecture.

## Features

- **AI Chat** — Streaming responses, conversation memory, context compression, message editing & regeneration
- **Voice** — Text-to-speech and speech-to-text with multiple providers (Pro only)
- **Subscriptions** — Free and Pro plans with Stripe, PayPal, EcoCash, OneMoney, PayNow Zimbabwe
- **Admin Dashboard** — User management, revenue tracking, usage monitoring
- **Security** — JWT validation, rate limiting, audit logging, XSS/CSRF protection
- **Performance** — Compression, caching, optimized database queries

## Quick Start

```bash
# 1. Clone and install
git clone <repo>
cd spider-ai
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your keys

# 3. Run migrations
npm run db:migrate

# 4. Start
npm run dev
```

## Deployment

### Vercel
```bash
vercel --prod
```

### Render
Push to GitHub, connect repo in Render dashboard using `render.yaml`.

### Railway
```bash
railway up
```

### Docker
```bash
docker-compose up -d
```

### VPS
```bash
npm install
npm run db:migrate
npm start
```

## API

All endpoints are versioned under `/api/v1/`:

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/auth/register` | Create account |
| `POST /api/v1/auth/login` | Sign in |
| `GET /api/v1/chat/conversations` | List conversations |
| `POST /api/v1/chat/conversations/:id/messages` | Send message (add `?stream=true` for SSE) |
| `GET /api/v1/voice/providers` | List voice providers |
| `POST /api/v1/voice/tts` | Text-to-speech |
| `GET /api/v1/subscriptions/plans` | List plans |
| `GET /api/v1/subscriptions/dashboard` | User dashboard |
| `GET /api/v1/admin/users` | Admin: list users |

Legacy `/api/` routes remain for backward compatibility.

## Environment Variables

See `.env.example` for all required variables.

## License

MIT
