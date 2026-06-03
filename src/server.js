require("dotenv").config();
const express = require("express");
const GeminiClient = require("./gemini");
const KnowledgeBase = require("./knowledge-base");
const WhatsAppClient = require("./whatsapp");
const Router = require("./router");
const Splitter = require("./splitter");
const Analytics = require("./analytics");
const AppDatabase = require("./database");
const { toWhatsApp, splitChunks } = require("./markdown");
const { Streamer, sleep } = require("./streamer");
const {
  detectLanguage,
  getString,
  getWelcomeButtons,
  getFeedbackButtons,
  getLanguageMenu,
  LANGUAGES
} = require("./language");
const {
  sanitize,
  RateLimiter,
  authMiddleware,
  handleNonTextMessage
} = require("./sanitizer");
const { watchKb } = require("./watcher");

const app = express();
app.use(express.json());

const whatsapp = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN
});

const kb = new KnowledgeBase();
kb.load();

const db = new AppDatabase();
const streamer = new Streamer(whatsapp);
const rateLimiter = new RateLimiter();

// ─── AI Instance Pool ───
const aiPool = {};

function getAI(userId) {
  if (!aiPool[userId]) {
    aiPool[userId] = new GeminiClient({ timeout: 20000 });
  }
  return aiPool[userId];
}

// ─── Cleanup ───
setInterval(() => {
  db.cleanupSessions(120);
  rateLimiter.cleanup();
  // Clean stale AI instances
  for (const [id] of Object.entries(aiPool)) {
    if (Object.keys(aiPool).length > 100) delete aiPool[id];
  }
}, 60 * 1000);

// ─── Core Logic ───

async function handleIncoming(from, name, rawText, isButton, buttonId) {
  const dbSession = db.getOrCreateSession(from);
  const lang = dbSession.language || "id";
  const text = sanitize(rawText || "");

  // ─── Button handlers ───
  if (isButton && buttonId) {
    return handleButton(from, name, buttonId, dbSession, lang);
  }

  // ─── First message → welcome menu ───
  if (dbSession.message_count === 0 && text.length < 3) {
    db.updateSession(from, { message_count: 1 });
    return getWelcomeButtons(name || from, lang);
  }

  // ─── Language command ───
  if (text.match(/^(bahasa|language|lang|\/language|\/bahasa)/i)) {
    return getLanguageMenu(lang);
  }

  // ─── Menu command ───
  if (text.match(/^(menu|kembali|back|start|awal|home)$/i)) {
    return getWelcomeButtons(name || from, lang);
  }

  // ─── Process question ───
  db.updateSession(from, { message_count: dbSession.message_count + 1 });
  const reply = await processQuestion(from, name, text, dbSession, lang);

  // Save messages
  db.saveMessage(from, name || "", "user", text, "user", reply.topic || "general", lang);

  // Store the reply message ID for feedback tracking
  const replyContent = typeof reply.text === "string" ? reply.text : JSON.stringify(reply.text);
  const msgId = db.saveMessage(from, name || "", "ai", replyContent, reply.source || "ai", reply.topic || "general", lang);

  return { ...reply, dbMessageId: msgId };
}

function handleButton(from, name, buttonId, dbSession, lang) {
  // ─── Language switch ───
  if (buttonId.startsWith("lang_")) {
    const newLang = buttonId.replace("lang_", "");
    if (LANGUAGES[newLang]) {
      db.updateSession(from, { language: newLang });
      return {
        type: "text",
        text: getString(newLang, "language_set", { lang: LANGUAGES[newLang].name }),
        thenMenu: true
      };
    }
  }

  // ─── Feedback ───
  if (buttonId === "feedback_up" || buttonId === "feedback_down") {
    const rating = buttonId === "feedback_up" ? "up" : "down";
    db.saveFeedback(from, 0, rating);
    return { type: "text", text: getString(lang, "thanks_feedback"), thenMenu: true };
  }

  // ─── Menu buttons ───
  const menuHandlers = {
    menu_jurusan: () => {
      const j = kb.data.jurusan;
      return {
        type: "buttons",
        text: `${lang === "en" ? "Majors at SMKN 2 Mataram" : "Jurusan SMKN 2 Mataram"}\n\n${j.map((x, i) => `${i + 1}. ${x.nama} (${x.singkatan})`).join("\n")}`,
        buttons: j.slice(0, 5).map(x => ({ id: `jurusan_${x.id}`, title: x.singkatan }))
      };
    },
    menu_spmb: () => ({
      type: "text",
      text: `${lang === "en" ? "Admission" : "SPMB SMKN 2 Mataram"}\n\n${lang === "en" ? "Registration opens April-May. Requirements: Indonesian citizen, SMP graduate, max 21 years old." : "Pendaftaran buka April-Mei. Syarat: WNI, lulusan SMP, max 21 tahun."}\n\n📞 ${kb.data.kontak.telepon}\n🌐 ${kb.data.kontak.website}`
    }),
    menu_kontak: () => ({
      type: "text",
      text: `📍 ${kb.data.kontak.alamat}\n📞 ${kb.data.kontak.telepon}\n📧 ${kb.data.kontak.email}\n🌐 ${kb.data.kontak.website}`
    }),
    menu_kembali: () => getWelcomeButtons(name || from, lang)
  };

  // Jurusan detail
  if (buttonId.startsWith("jurusan_")) {
    const jId = buttonId.replace("jurusan_", "");
    const jurusan = kb.data.jurusan.find(j => j.id === jId || j.singkatan.toLowerCase() === jId);
    if (jurusan) {
      return {
        type: "text",
        text: `*${jurusan.nama} (${jurusan.singkatan})*\n\n${jurusan.deskripsi}\n\n💼 ${lang === "en" ? "Career Prospects:" : "Prospek Kerja:"}\n${jurusan.prospek_kerja.map(p => `• ${p}`).join("\n")}`
      };
    }
  }

  const handler = menuHandlers[buttonId];
  if (handler) return handler();

  // Fallback
  return getWelcomeButtons(name || from, lang);
}

async function processQuestion(from, name, text, dbSession, lang) {
  const intent = Router.detectIntent(text);
  const topic = intent.label;

  // ─── KB direct match ───
  const kbMatch = kb.search(text);
  if (kbMatch.length > 0 && kbMatch[0].data.jawaban) {
    const answer = toWhatsApp(kbMatch[0].data.jawaban);
    Analytics.trackMessage(from, name, { text, type: "text", source: "kb", topic, responseTime: 0 });
    return { text: answer, source: "kb", topic };
  }

  // ─── AI with context ───
  try {
    const ai = getAI(from);
    const smartCtx = kb.smartContext(text);
    const langInstruction = lang === "en"
      ? "\n\nIMPORTANT: Answer in English. Use English for greetings and all responses."
      : lang === "sas"
      ? "\n\nPENTING: Jawab dalam bahasa Sasak (bahasa asli Lombok). Gunakan bahasa Sasak untuk semua jawaban."
      : "\n\nPENTING: Jawab dalam Bahasa Indonesia yang baik dan benar.";
    ai.setContext(smartCtx + langInstruction);
    ai.reset();

    const response = await ai.ask(text);
    if (response?.text) {
      const formatted = toWhatsApp(response.text);
      const chunks = splitChunks(formatted, 600);

      Analytics.trackMessage(from, name, { text, type: "text", source: "ai", topic, responseTime: 0 });
      return { text: chunks, source: "ai", topic, isStream: true };
    }
    throw new Error("empty");
  } catch (err) {
    console.error(`[AI FAIL] ${from}: ${err.message}`);
    Analytics.trackError(from, err.message);

    const fb = kb.search(text);
    if (fb.length > 0 && fb[0].data.jawaban) {
      return { text: toWhatsApp(fb[0].data.jawaban), source: "kb", topic };
    }

    db.addUnanswered(from, text, `AI+KB fail: ${err.message.substring(0, 100)}`);
    Analytics.trackMessage(from, name, { text, type: "text", source: "unanswered", topic, responseTime: 0 });

    return {
      text: `${getString(lang, "sorry_unanswered", { name: name || "Kak" })}\n\n📞 ${kb.data.kontak.telepon}\n📧 ${kb.data.kontak.email}`,
      source: "unanswered",
      topic
    };
  }
}

// ─── Send reply with streaming support ───
async function sendReply(from, reply, lang) {
  if (!reply) return;

  if (reply.thenMenu) {
    await sleep(1000);
    const menu = getWelcomeButtons(from, lang || "id");
    if (menu.buttons) {
      await whatsapp.sendButtonMessage(from, menu.text, menu.buttons);
    }
    return;
  }

  if (reply.isStream && Array.isArray(reply.text)) {
    await streamer.stream(from, reply.text, {
      feedbackCallback: async (uid) => {
        const session = db.getOrCreateSession(uid);
        const l = session.language || "id";
        const fb = getFeedbackButtons(l);
        await sleep(1500);
        await whatsapp.sendButtonMessage(uid, fb.text, fb.buttons);
      }
    });
    return;
  }

  // Regular text
  if (typeof reply.text === "string") {
    const parts = Splitter.split(reply.text);
    for (const part of parts) {
      await whatsapp.sendMessage(from, part);
    }
    return;
  }

  // Buttons
  if (reply.type === "buttons" || reply.buttons) {
    await whatsapp.sendButtonMessage(from, reply.text, reply.buttons);
    return;
  }

  // Fallback
  if (typeof reply === "string") {
    const parts = Splitter.split(reply);
    for (const part of parts) {
      await whatsapp.sendMessage(from, part);
    }
  }
}

// ─── Express Routes ───

app.get("/webhook", (req, res) => {
  const result = whatsapp.verifyWebhook(
    req.query["hub.mode"],
    req.query["hub.verify_token"],
    req.query["hub.challenge"]
  );
  if (result) return res.status(200).send(result);
  res.status(403).send("Forbidden");
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const parsed = whatsapp.parseIncoming(req.body);
  if (!parsed) return;

  const start = Date.now();
  const { from, text: rawText, name, isButton, buttonId, type: msgType } = parsed;

  // Rate limit
  const rateCheck = rateLimiter.check(from);
  if (!rateCheck.allowed) return;

  // Non-text
  if (msgType !== "text" && !isButton) {
    const reply = handleNonTextMessage({ type: msgType });
    if (reply) await whatsapp.sendMessage(from, reply);
    return;
  }

  const lang = (db.getOrCreateSession(from)?.language) || "id";
  console.log(`[⬇ ${isButton ? "BTN" : "TXT"}] ${(name || "?").padEnd(12)} ${from} → ${(rawText || buttonId || "").substring(0, 100)}`);

  try {
    const reply = await handleIncoming(from, name, rawText, isButton, buttonId);
    await sendReply(from, reply, lang);
    console.log(`[⬆ OK] ${from} (${Date.now() - start}ms)`);
  } catch (err) {
    console.error(`[❌ ERR] ${from}: ${err.message.substring(0, 100)}`);
  }
});

// ─── Admin & Utility Routes ───

app.get("/", (req, res) => {
  const stats = db.getStats();
  res.json({
    app: "SMKN 2 Mataram AI Assistant",
    version: "4.0",
    status: "running",
    stats: {
      jurusan: kb.data.jurusan.length,
      faq: kb.data.faq.length,
      total_users: stats.totalUsers,
      total_messages: stats.totalMessages,
      active_sessions: stats.activeSessions,
      ai_instances: Object.keys(aiPool).length
    },
    endpoints: {
      health: "/health",
      analytics: "/analytics?token=",
      sessions: "/sessions?token=",
      feedback: "/feedback?token=",
      unanswered: "/unanswered?token=",
      conversation: "/conversation/:userId?token="
    }
  });
});

app.get("/health", (req, res) => {
  const stats = db.getStats();
  res.json({
    status: "ok",
    uptime: process.uptime(),
    memory: process.memoryUsage().rss,
    ...stats
  });
});

app.get("/analytics", authMiddleware, (req, res) => {
  const stats = db.getStats();
  stats.daily = Analytics.dailyStats;
  res.json(stats);
});

app.get("/sessions", authMiddleware, (req, res) => {
  res.json({ count: db.getAllSessions().length, sessions: db.getAllSessions().slice(0, 100) });
});

app.get("/feedback", authMiddleware, (req, res) => {
  res.json(db.getFeedbackStats());
});

app.get("/unanswered", authMiddleware, (req, res) => {
  res.json(db.getUnanswered(50));
});

app.get("/conversation/:userId", authMiddleware, (req, res) => {
  const messages = db.getMessages(req.params.userId, 100);
  if (messages.length === 0) return res.status(404).json({ error: "No messages found" });
  res.json({ userId: req.params.userId, count: messages.length, messages });
});

app.get("/log/:n", authMiddleware, (req, res) => {
  const n = parseInt(req.params.n) || 50;
  res.json(Analytics.getRecentLog(n));
});

app.post("/simulate", async (req, res) => {
  const { userId, name, text, buttonId, lang: simLang } = req.body;
  if (!userId || (!text && !buttonId)) {
    return res.status(400).json({ error: "userId and text or buttonId required" });
  }

  const start = Date.now();
  try {
    db.getOrCreateSession(userId);
    if (simLang) db.updateSession(userId, { language: simLang });
    const lang = simLang || db.getOrCreateSession(userId).language || "id";
    const reply = await handleIncoming(userId, name || "Sim", text || "", !!buttonId, buttonId);
    await sendReply(userId, reply, lang);
    res.json({ status: "ok", userId, elapsed_ms: Date.now() - start, reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/kb/reload", authMiddleware, (req, res) => {
  try {
    kb.load();
    for (const [id] of Object.entries(aiPool)) {
      aiPool[id].setContext(kb.getContext());
    }
    res.json({ status: "ok", message: "KB reloaded" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ───

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║       SMKN 2 Mataram AI Assistant v4       ║`);
  console.log(`  ╠══════════════════════════════════════════════╣`);
  console.log(`  ║  Database : smkn2.db (SQLite)              ║`);
  console.log(`  ║  Languages: id, en, sas                    ║`);
  console.log(`  ║  Streaming: ON (chunked + feedback)        ║`);
  console.log(`  ║  Webhook  : http://localhost:${PORT}/webhook  ║`);
  console.log(`  ╠══════════════════════════════════════════════╣`);
  console.log(`  ║  Jurusan  : ${kb.data.jurusan.length}         │ FAQ: ${kb.data.faq.length}      ║`);
  console.log(`  ║  KB Size  : ${kb.getContext().length} chars             ║`);
  console.log(`  ║  AI Pool  : 0 instances                    ║`);
  console.log(`  ╚══════════════════════════════════════════════╝\n`);
});
