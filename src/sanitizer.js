/**
 * Input Sanitizer + Rate Limiter + Admin Auth
 */

// ─── Sanitizer ───

const DANGEROUS_PATTERNS = [
  /[<>"'\\]/g,
  /[\x00-\x08\x0B\x0C\x0E-\x1F]/g
];

function sanitize(text) {
  if (typeof text !== "string") return "";
  let clean = text.trim();
  if (clean.length > 2000) {
    clean = clean.substring(0, 2000);
  }
  for (const pat of DANGEROUS_PATTERNS) {
    clean = clean.replace(pat, "");
  }
  return clean;
}

// ─── Rate Limiter ───

class RateLimiter {
  constructor() {
    this.windows = {};
  }

  check(userId) {
    const now = Date.now();
    const window = 60000; // 1 minute
    const maxRequests = 20; // max 20 messages per minute per user

    if (!this.windows[userId]) {
      this.windows[userId] = { count: 1, start: now };
      return { allowed: true, remaining: maxRequests - 1 };
    }

    const entry = this.windows[userId];
    if (now - entry.start > window) {
      // Reset window
      entry.count = 1;
      entry.start = now;
      return { allowed: true, remaining: maxRequests - 1 };
    }

    entry.count++;
    if (entry.count > maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil((window - (now - entry.start)) / 1000)
      };
    }

    return { allowed: true, remaining: maxRequests - entry.count };
  }

  cleanup() {
    const now = Date.now();
    for (const [id, entry] of Object.entries(this.windows)) {
      if (now - entry.start > 120000) {
        delete this.windows[id];
      }
    }
  }
}

// ─── Admin Auth ───

function authMiddleware(req, res, next) {
  const adminToken = process.env.ADMIN_TOKEN || "smkn2-admin-2024";
  const token = req.query.token || req.headers["x-admin-token"];

  if (token !== adminToken) {
    return res.status(401).json({ error: "Unauthorized. Provide ?token= or x-admin-token header" });
  }
  next();
}

// ─── Non-text handler ───

function handleNonTextMessage(msg) {
  if (msg.type === "text") return null;

  const typeLabels = {
    image: "gambar",
    audio: "audio",
    video: "video",
    document: "dokumen",
    location: "lokasi",
    contacts: "kontak",
    sticker: "stiker",
    interactive: "interaktif"
  };

  const label = typeLabels[msg.type] || "media";
  
  return `Maaf, saya hanya bisa membaca pesan teks. Saya tidak bisa memproses ${label} yang Anda kirim.\n\nSilakan ketik pertanyaan Anda dalam bentuk teks, atau gunakan menu di bawah ini:`;
}

// ─── Unanswered Tracker ───

class UnansweredTracker {
  constructor() {
    this.questions = [];
  }

  add(userId, question, reason) {
    this.questions.push({
      userId,
      question,
      reason,
      timestamp: Date.now(),
      answered: false
    });

    // Keep only last 500
    if (this.questions.length > 500) {
      this.questions.splice(0, this.questions.length - 500);
    }
  }

  getAll() {
    return this.questions.filter(q => !q.answered).slice(-100).reverse();
  }

  markAnswered(question) {
    const found = this.questions.find(
      q => q.question === question && !q.answered
    );
    if (found) found.answered = true;
  }

  getStats() {
    const total = this.questions.length;
    const unanswered = this.questions.filter(q => !q.answered).length;
    const topQuestions = {};
    for (const q of this.questions) {
      topQuestions[q.question] = (topQuestions[q.question] || 0) + 1;
    }
    const top = Object.entries(topQuestions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([q, c]) => ({ question: q.substring(0, 100), count: c }));

    return { total, unanswered, topUnanswered: top };
  }
}

module.exports = {
  sanitize,
  RateLimiter,
  authMiddleware,
  handleNonTextMessage,
  UnansweredTracker
};
