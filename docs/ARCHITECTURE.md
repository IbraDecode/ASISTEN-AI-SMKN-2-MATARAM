# Architecture

## Request Flow

```
WhatsApp → POST /webhook
  ├── rateLimiter.check() → 429 if spam
  ├── parseIncoming() → { text, from, name, isButton }
  ├── markAsRead()
  ├── handleIncoming()
  │   ├── getOrCreateSession() → DB session (state, lang, history)
  │   ├── handleButton()  → if buttonId (lang_, jurusan_, menu_, feedback_)
  │   └── processQuestion()
  │       ├── Router.detectIntent() → topic
  │       ├── kb.search() → direct KB hit → return
  │       ├── GeminiClient (streaming)
  │       │   ├── _fetchTokens() → { bl, fsid, at } from gemini.google.com
  │       │   ├── _buildPayload(msg) → f.req array (80 fields)
  │       │   ├── POST StreamGenerate → SSE stream
  │       │   └── _parseStream() → delta callbacks → sendMessage()
  │       └── feedback buttons → setTimeout()
  ├── saveMessage() → DB
  └── Analytics.trackMessage()
```

## Database Schema (PostgreSQL via Prisma)

```
chat_sessions    - userId, state, language, messageCount, history, timestamps
messages         - id, userId, role, content, source, topic, language, createdAt
feedback         - id, userId, messageId, rating (up/down)
events           - id, title, description, eventDate, category
unanswered       - id, userId, question, reason, answered (boolean)
```

## Gemini Scraper

The client fetches anonymous tokens by scraping `gemini.google.com`:

1. Fetch `gemini.google.com/` → extract `cfb2h` (build label) and `FdrFJe` (session ID) from inline HTML
2. Build payload as 80-element array with `[79]` = model ID
3. POST to `StreamGenerate` endpoint with `f.req` + `at` params
4. Parse SSE response: extract text from `wrb.fr` JSON lines
5. Delta-based streaming: compare current text vs previous to extract new content

**Token health:** multi-URL fallback (3 URLs), per-URL cooldown (exponential backoff 30s-5min), circuit breaker (5 failures → 60s cooldown).

**Model IDs** are extracted from Gemini's frontend JS (`MODE_CATEGORY` enum). Updated periodically when Google rotates them.

## WhatsApp Client

Thin wrapper around Meta's REST API:

- Send queue: sequential Promise chain (prevents concurrent 429s)
- Rate limit: 200ms minimum interval between sends
- Retry: exponential backoff for 429/5xx (2 retries)
- Dedup: `Set<msgId>` with 10s TTL (cleared at 1000 entries)
- Message types: text, button, list, CTA URL, location, image, reaction, location request

## Knowledge Base

`data/kb.json` contains structured school data:

```
metadata       - school name, NPSN, accreditation, contact
jurusan[10]    - RPL, TKJ, AKL, MPK, BDG, UPW, BRT, LPS, DKV, Animasi
fasilitas[]    - labs, library, field, mosque, canteen, WiFi
ekstrakurikuler - paskibra, pramuka, PMR, sports, arts
prestasi[]     - competition achievements
spmb           - admission jalur, requirements, stages
kontak         - address, phone, email, website, social media
visi_misi      - vision, mission, goals
seragam        - daily uniform by day
jam_sekolah    - school hours
mpls           - orientation program
bantuan_siswa  - PIP/KIP financial aid programs
struktur_organisasi - staff directory
faq[63]        - question-answer pairs
```

`kb.search()` tokenizes query, scores against jurusan + FAQ by keyword overlap, returns top 5 matches. `smartContext()` selects relevant sections by keyword matching for Gemini context injection.

## Streaming

Two streaming strategies:

| Strategy | When | How |
|----------|------|-----|
| True streaming | Gemini | `_parseStream` → delta callbacks → `sendMessage()` per chunk |
| Simulated streaming | Legacy | `splitChunks()` + `Streamer._naturalDelay()` with 40% jitter |

## Vercel Differences

| Feature | Local (PM2) | Vercel |
|---------|-------------|--------|
| `app.listen()` | Yes | No (exported) |
| DB init | At startup | Lazy (first request) |
| `fs.watch` | Yes (auto-reload) | Skipped |
| `setInterval` cleanup | Every 60s | Skipped |
| Function timeout | Unlimited | 30s max |
