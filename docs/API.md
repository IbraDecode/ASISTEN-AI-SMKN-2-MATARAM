# API Reference

All admin endpoints require `?token=` or `x-admin-token` header (default: `smkn2-admin-2024`).

## Webhook

### `GET /webhook`
WhatsApp webhook verification (Meta required).

**Query params:** `hub.mode`, `hub.verify_token`, `hub.challenge`

### `POST /webhook`
Incoming WhatsApp messages. Responds 200 immediately, processes async.

**Body:** Raw Meta webhook payload.

**Group messages:** Ignored unless business is @mentioned (`context.group_id`).

## Public

### `GET /`
Server info + stats.

### `GET /health`
Health check + Gemini circuit state + message counts.

### `GET /events`
Calendar events.

**Query:** `?category=umum&days=7`

### `POST /simulate`
Test the AI pipeline. Requires auth.

```json
{ "userId": "test123", "name": "Tester", "text": "info jurusan" }
```

## Admin

All require `?token=<admin_token>`.

### `GET /analytics`
Daily stats: total/AI/KB/unanswered messages, topic distribution, top users.

### `GET /sessions`
All active sessions (max 100).

### `GET /feedback`
Feedback stats: up/down votes, ratio.

### `GET /unanswered`
Questions the AI couldn't answer (max 50).

### `GET /conversation/:userId`
Message history for a user (max 100).

### `GET /log/:n`
Recent logs (default 50).

### `POST /broadcast`
Send message to all users. 10 concurrent batches.

```json
{ "message": "Pengumuman: ..." }
```

### `POST /broadcast/preview`
Preview broadcast: user count + first 200 chars.

```json
{ "message": "..." }
```

### `POST /events/add`
Add calendar event.

```json
{ "title": "Ujian", "description": "...", "eventDate": "2026-06-10", "category": "akademik" }
```

### `DELETE /events/:id`
Delete event.

### `GET /kb/reload`
Reload `data/kb.json` from disk without restart. Updates all AI instances.
