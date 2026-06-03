# SMKN 2 Mataram AI Assistant

WhatsApp chatbot berbasis AI untuk SMKN 2 Mataram. Menggunakan Google Gemini (web scraping) sebagai LLM dan WhatsApp Cloud API sebagai channel.

## Stack

| Layer | Teknologi |
|-------|-----------|
| Runtime | Node.js 22, Express |
| Database | PostgreSQL (Supabase) via Prisma ORM v7 |
| AI | Google Gemini (web scraping protocol, no API key) |
| Chat | WhatsApp Cloud API (Meta Graph API v25.0) |
| Deploy | Vercel (serverless) / PM2 (server) |

## Struktur

```
src/
├── server.js          # Express app, routing, webhook handler
├── gemini.js          # Gemini scraper client (token fetch, stream)
├── whatsapp.js        # WhatsApp Cloud API client
├── database.js        # Prisma wrapper (sessions, messages, feedback)
├── knowledge-base.js  # KB search & context builder from kb.json
├── router.js          # Intent detection (keyword scoring)
├── language.js        # i18n: id, en, sas (Sasak)
├── sanitizer.js       # Input sanitizer + rate limiter + admin auth
├── markdown.js        # Markdown → WhatsApp format converter
├── splitter.js        # Long message splitter (4096 char limit)
├── streamer.js        # Typing simulation (chunked send + jitter)
├── watcher.js         # File watcher (auto-reload kb.json)
├── analytics.js       # In-memory analytics (daily stats, topics)
├── generated/prisma/  # Prisma client (generated at build)
data/
├── kb.json            # Knowledge base (jurusan, fasilitas, FAQ, etc)
├── smkn2.db           # SQLite fallback (not used with Supabase)
prisma/
├── schema.prisma      # Prisma schema (Session, Message, Feedback, etc)
tools/
├── audit.js           # System audit (75 checks)
├── deep-inspect.js    # Gemini protocol introspection
├── scrape-inspect.js  # Gemini response parser tester
├── chat-simulator.js  # Interactive chat simulator
train/
├── ingest.js          # KB ingestion pipeline
```

## Quick Start

```bash
cp .env.example .env   # isi credentials
npm install
npx prisma generate     # generate Prisma client from schema
npm start               # local server :3000
```

## Environment

```
WHATSAPP_PHONE_NUMBER_ID=1098713246651858
WHATSAPP_ACCESS_TOKEN=<token>
WHATSAPP_VERIFY_TOKEN=<webhook_token>
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
ADMIN_TOKEN=smkn2-admin-2024
PORT=3000
```

## Vercel Deployment

```json
// vercel.json
{
  "builds": [{ "src": "src/server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "src/server.js" }]
}
```

- `vercel-build` script runs `npx prisma generate` automatically
- Set environment variables in Vercel dashboard
- `maxDuration: 30` recommended (AI responses can take 15-25s)

## WhatsApp Webhook

Meta sends webhooks to `POST /webhook`. Verification at `GET /webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<challenge>`.

## Gemini Scraper

The scraper reverse-engineers `gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`:

- No API key required - anonymous tokens extracted from page HTML
- Tokens: `cfb2h` (build label), `FdrFJe` (session ID), `SNlM0e` (access token, optional since Apr 2026)
- Model selection via `x-goog-ext-525001261-jspb` header + payload field `[79]`
- Available models: `FLASH`, `PRO`, `THINKING`, `PRO_EXP`, `FLASH_EXP`, `DEEP_SEARCH`, `GEMINI_3_PRO`, `GEMINI_20`

## API Endpoints

See [docs/API.md](docs/API.md) for full reference.
