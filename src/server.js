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
  getString, getWelcomeList, getJurusanList, getFeedbackButtons, getLanguageMenu, LANGUAGES, setKbCache
} = require("./language");
const { sanitize, validateButtonId, RateLimiter, authMiddleware, handleNonTextMessage } = require("./sanitizer");
const { watchKb } = require("./watcher");

const app = express();
app.use(express.json({ limit: "100kb" }));

const whatsapp = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN
});

const kb = new KnowledgeBase();
kb.load();
setKbCache(kb);
watchKb(kb, () => {
  for (const [id] of Object.entries(aiPool)) {
    aiPool[id].setContext(kb.getContext());
  }
  console.log("[WATCH] AI pool context updated");
});

const streamer = new Streamer(whatsapp);
const rateLimiter = new RateLimiter();
const lastMessageId = {};
const aiPool = {};

let db;

function getAI(userId) {
  if (!aiPool[userId]) {
    aiPool[userId] = new GeminiClient({ timeout: 20000 });
  }
  return aiPool[userId];
}

setInterval(() => {
  db?.cleanupSessions(120);
  rateLimiter.cleanup();
  const poolSize = Object.keys(aiPool).length;
  if (poolSize > 100) {
    const ids = Object.keys(aiPool);
    const toDelete = ids.slice(0, poolSize - 50);
    for (const id of toDelete) delete aiPool[id];
  }
}, 60 * 1000);

setInterval(async () => {
  await autoLearnFromAI();
}, 30 * 60 * 1000);

// ─── Auto-learn from AI ───
async function autoLearnFromAI() {
  const unanswered = await db.getUnanswered(20);
  for (const item of unanswered) {
    const kbMatch = kb.search(item.question);
    if (kbMatch.length > 0 && kbMatch[0].data.jawaban) {
      await db.markAnswered(item.id);
    }
  }
}

// ─── Core Logic ───

async function handleIncoming(from, name, rawText, isButton, buttonId) {
  const dbSession = await db.getOrCreateSession(from);
  const lang = dbSession.language || "id";
  const text = sanitize(rawText || "");

  if (isButton && buttonId) {
    return handleButton(from, name, buttonId, dbSession, lang);
  }

  if (dbSession.message_count === 0) {
    await db.updateSession(from, { message_count: 1, state: "MENU" });
    return getWelcomeList(name || from, lang);
  }

  if (text.match(/^(bahasa|language|lang|\/language|\/bahasa)/i)) {
    return getLanguageMenu(lang);
  }

  if (text.match(/^(help|bantuan|tolong|\/help|\/bantuan)$/i)) {
    const helpText = getString(lang, "help_text", {
      name: name || "Kak",
      menu: (getString(lang, "welcome", { name: "" }) || "").split("\n")[0]
    });
    return { type: "text", text: helpText ||
      `Halo ${name || "Kak"}! 👋\n\nSaya asisten AI SMKN 2 Mataram. Saya bisa:\n• Info jurusan (RPL, TKJ, AKL, dll)\n• Syarat & jadwal SPMB\n• Fasilitas & ekstrakurikuler\n• Prestasi sekolah\n• Kontak sekolah\n\nCukup ketik pertanyaan atau pilih menu. Ketik 'menu' untuk kembali kapan saja.`
    };
  }

  if (text.match(/^(menu|kembali|back|start|awal|home)$/i)) {
    await db.updateSession(from, { state: "MENU" });
    return getWelcomeList(name || from, lang);
  }

  // Simpan pertanyaan user SEBELUM proses AI
  await db.saveMessage(from, name || "", "user", text, "user", "general", lang);

  await db.updateSession(from, { message_count: dbSession.message_count + 1, state: "ASKING" });
  const reply = await processQuestion(from, name, text, dbSession, lang);

  const replyContent = typeof reply.text === "string" ? reply.text : JSON.stringify(reply.text);
  const msgId = await db.saveMessage(from, name || "", "ai", replyContent, reply.source || "ai", reply.topic || "general", lang);
  lastMessageId[from] = msgId;

  return { ...reply, dbMessageId: msgId };
}

async function handleButton(from, name, buttonId, dbSession, lang) {
  if (buttonId.startsWith("lang_")) {
    const newLang = buttonId.replace("lang_", "");
    if (LANGUAGES[newLang]) {
      await db.updateSession(from, { language: newLang, state: "MENU" });
      return {
        type: "text",
        text: getString(newLang, "language_set", { lang: LANGUAGES[newLang].name }),
        thenMenu: true
      };
    }
  }

  if (buttonId === "lang_menu") {
    return getLanguageMenu(lang);
  }

  if (buttonId.startsWith("feedback_up") || buttonId.startsWith("feedback_down")) {
    const rating = buttonId.startsWith("feedback_up") ? "up" : "down";
    const parts = buttonId.split("_");
    const msgId = parts.length > 2 ? parseInt(parts[2]) : 0;
    await db.saveFeedback(from, msgId, rating);
    await db.updateSession(from, { state: "MENU" });
    return { type: "text", text: getString(lang, "thanks_feedback"), thenMenu: true };
  }

  const d = kb.data;

  const menuHandlers = {
    menu_jurusan: () => {
      const j = d.jurusan;
      return {
        type: "list",
        text: `${lang === "en" ? "Majors at SMKN 2 Mataram" : "Jurusan SMKN 2 Mataram"}\n\n${j.map((x, i) => `${i + 1}. ${x.nama} (${x.singkatan})`).join("\n")}`,
        button: lang === "en" ? "Select Major" : "Pilih Jurusan",
        sections: [{
          title: lang === "en" ? "Majors" : "Daftar Jurusan",
          rows: j.map(x => ({
            id: `jurusan_${x.id}`,
            title: x.singkatan,
            description: x.nama.substring(0, 40)
          }))
        }]
      };
    },
    menu_spmb: () => ({
      type: "text",
      text: `${lang === "en" ? "Admission" : "SPMB SMKN 2 Mataram"}\n\n${lang === "en" ? "Registration opens April-May. Requirements: Indonesian citizen, SMP graduate, max 21 years old." : "Pendaftaran buka April-Mei. Syarat: WNI, lulusan SMP, max 21 tahun."}\n\n📞 ${d.kontak.telepon}\n🌐 ${d.kontak.website}`
    }),
    menu_prestasi: () => ({
      type: "text",
      text: `🏆 *${lang === "en" ? "Achievements" : "Prestasi SMKN 2 Mataram"}*\n\n${(d.prestasi || []).map((p, i) => `${i + 1}. ${p}`).join("\n")}`
    }),
    menu_ekskul: () => ({
      type: "text",
      text: `⚽ *${lang === "en" ? "Extracurricular" : "Ekstrakurikuler"}*\n\n${(d.ekstrakurikuler || []).map(e => `• ${e.nama || e}${e.hari ? ` (${e.hari})` : ""}`).join("\n")}`
    }),
    menu_fasilitas: () => ({
      type: "text",
      text: `🏫 *${lang === "en" ? "Facilities" : "Fasilitas"}*\n\n${(d.fasilitas || []).map(f => `• ${f}`).join("\n")}`
    }),
    menu_beasiswa: () => {
      const bs = d.bantuan_siswa;
      return {
        type: "text",
        text: `🎓 *${lang === "en" ? "Student Financial Aid" : "Bantuan Siswa"}*\n\n${bs ? `${bs.deskripsi}\n\n📋 ${lang === "en" ? "Programs:" : "Program:"}\n${(bs.program || []).map(p => `• ${p.nama}: ${p.keterangan}`).join("\n")}` : "Info belum tersedia."}`
      };
    },
    menu_guru: () => {
      const so = d.struktur_organisasi || {};
      return {
        type: "text",
        text: `👨‍🏫 *${lang === "en" ? "Teachers & Staff" : "Guru & Staff SMKN 2 Mataram"}*\n\n${Object.entries(so).map(([k, v]) => `• ${k.replace(/_/g, " ").toUpperCase()}: ${v}`).join("\n")}`
      };
    },
    menu_kontak: () => ({
      type: "text",
      text: `📍 ${d.kontak.alamat}\n📞 ${d.kontak.telepon}\n📧 ${d.kontak.email}\n🌐 ${d.kontak.website}`
    }),
    menu_bantuan: () => ({
      type: "text",
      text: `❓ *${lang === "en" ? "How to Use" : "Cara Menggunakan"}*\n\n${lang === "en" ? "Just type your question or choose from the menu. I can help with:\n• School profile\n• Majors info\n• Admission info\n• Facilities & extracurricular\n• Contact info\n\nType 'menu' anytime to return." : "Cukup ketik pertanyaan atau pilih dari menu. Saya bisa bantu:\n• Profil sekolah\n• Info jurusan\n• Info SPMB\n• Fasilitas & ekskul\n• Kontak sekolah\n\nKetik 'menu' kapan saja untuk kembali."}`
    }),
    menu_kembali: () => getWelcomeList(name || from, lang)
  };

  if (buttonId.startsWith("jurusan_")) {
    const jId = buttonId.replace("jurusan_", "");
    const jurusan = d.jurusan.find(j => j.id === jId || j.singkatan.toLowerCase() === jId);
    if (jurusan) {
      return {
        type: "text",
        text: `*${jurusan.nama} (${jurusan.singkatan})*\n\n${jurusan.deskripsi}\n\n💼 ${lang === "en" ? "Career Prospects:" : "Prospek Kerja:"}\n${jurusan.prospek_kerja.map(p => `• ${p}`).join("\n")}`
      };
    }
  }

  const handler = menuHandlers[buttonId];
  if (handler) return handler();

  return getWelcomeList(name || from, lang);
}

async function processQuestion(from, name, text, dbSession, lang) {
  const intent = Router.detectIntent(text);
  const topic = intent.label;

  const kbMatch = kb.search(text);
  if (kbMatch.length > 0 && kbMatch[0].data.jawaban) {
    const answer = toWhatsApp(kbMatch[0].data.jawaban);
    Analytics.trackMessage(from, name, { text, type: "text", source: "kb", topic, responseTime: 0 });
    return { text: answer, source: "kb", topic };
  }

  try {
    const recentMessages = await db.getConversationContext(from, 6);
    const historyStr = recentMessages.length > 0
      ? "\n\nRiwayat percakapan:\n" + recentMessages.map(m =>
          `${m.role === "user" ? "User" : "AI"}: ${m.content.substring(0, 500)}`
        ).join("\n")
      : "";

    const ai = getAI(from);
    const smartCtx = kb.smartContext(text);
    const langInstruction = lang === "en"
      ? "\n\nIMPORTANT: Answer in English. Use English for greetings and all responses."
      : lang === "sas"
      ? "\n\nPENTING: Jawab dalam bahasa Sasak (bahasa asli Lombok). Gunakan bahasa Sasak untuk semua jawaban."
      : "\n\nPENTING: Jawab dalam Bahasa Indonesia yang baik dan benar.";
    ai.setContext(smartCtx + historyStr + langInstruction);
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

    if (err.message.includes("SAFETY")) {
      return {
        text: `${getString(lang, "sorry_unanswered", { name: name || "Kak" })}\n\nAI safety filter menolak pertanyaan ini. Silakan coba pertanyaan lain atau hubungi sekolah melalui:\n📞 ${kb.data.kontak.telepon}\n📧 ${kb.data.kontak.email}`,
        source: "safety_block",
        topic
      };
    }

    const fb = kb.search(text);
    if (fb.length > 0 && fb[0].data.jawaban) {
      return { text: toWhatsApp(fb[0].data.jawaban), source: "kb", topic };
    }

    await db.addUnanswered(from, text, `AI+KB fail: ${err.message.substring(0, 100)}`);
    Analytics.trackMessage(from, name, { text, type: "text", source: "unanswered", topic, responseTime: 0 });

    return {
      text: `${getString(lang, "sorry_unanswered", { name: name || "Kak" })}\n\n📞 ${kb.data.kontak.telepon}\n📧 ${kb.data.kontak.email}`,
      source: "unanswered",
      topic
    };
  }
}

async function sendReply(from, reply, lang, name) {
  if (!reply) return;

  if (reply.thenMenu) {
    await sleep(1000);
    const menu = getWelcomeList(name || from, lang || "id");
    if (menu.sections) {
      await whatsapp.sendListMessage(from, menu.text, menu.button, menu.sections);
    } else if (menu.buttons) {
      await whatsapp.sendButtonMessage(from, menu.text, menu.buttons);
    }
    return;
  }

  if (reply.isStream && Array.isArray(reply.text)) {
    await streamer.stream(from, reply.text, {
      feedbackCallback: async (uid) => {
        const session = await db.getOrCreateSession(uid);
        const l = session.language || "id";
        const fb = getFeedbackButtons(l);
        const mid = lastMessageId[uid] || 0;
        await sleep(1500);
        await whatsapp.sendButtonMessage(uid, fb.text, fb.buttons.map(b => ({
          ...b,
          id: b.id + (mid ? `_${mid}` : "")
        })));
      }
    });
    return;
  }

  if (typeof reply.text === "string") {
    const parts = Splitter.split(reply.text);
    for (const part of parts) {
      await whatsapp.sendMessage(from, part);
    }
    return;
  }

  if (reply.type === "list" && reply.sections) {
    await whatsapp.sendListMessage(from, reply.text, reply.button || "Pilih", reply.sections);
    return;
  }

  if (reply.type === "buttons" || reply.buttons) {
    await whatsapp.sendButtonMessage(from, reply.text, reply.buttons);
    return;
  }

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

  if (parsed.msgId) {
    whatsapp.markAsRead(from, parsed.msgId);
  }

  const rateCheck = rateLimiter.check(from);
  if (!rateCheck.allowed) {
    await whatsapp.sendMessage(from, "Mohon tunggu sebentar, Anda terlalu cepat mengirim pesan. Silakan coba lagi dalam beberapa detik.");
    return;
  }

  // Group chat: hanya reply jika @mention
  if (msgType === "group" || req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.context) {
    return;
  }

  if (isButton && buttonId && !validateButtonId(buttonId)) return;

  if (msgType !== "text" && !isButton) {
    const reply = handleNonTextMessage({ type: msgType });
    if (reply) await whatsapp.sendMessage(from, reply);
    return;
  }

  const lang = ((await db.getOrCreateSession(from))?.language) || "id";
  console.log(`[⬇ ${isButton ? "BTN" : "TXT"}] ${(name || "?").padEnd(12)} ${from} → ${(rawText || buttonId || "").substring(0, 100)}`);

  try {
    const reply = await handleIncoming(from, name, rawText, isButton, buttonId);
    await sendReply(from, reply, lang, name);
    console.log(`[⬆ OK] ${from} (${Date.now() - start}ms)`);
  } catch (err) {
    console.error(`[❌ ERR] ${from}: ${err.message.substring(0, 100)}`);
    await whatsapp.sendMessage(from, "Maaf, terjadi kesalahan. Silakan coba lagi atau ketik 'menu'.");
  }
});

// ─── Admin & Utility Routes ───

app.get("/", async (req, res) => {
  const stats = await db.getStats();
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
      conversation: "/conversation/:userId?token=",
      broadcast: "/broadcast?token=",
      events: "/events",
      "events/add": "/events/add?token="
    }
  });
});

app.get("/health", async (req, res) => {
  const stats = await db.getStats();
  res.json({
    status: "ok",
    uptime: process.uptime(),
    memory: process.memoryUsage().rss,
    gemini: {
      circuit: GeminiClient.getCircuitState ? GeminiClient.getCircuitState() : { open: false },
      metrics: GeminiClient.getMetrics ? GeminiClient.getMetrics() : {}
    },
    ...stats
  });
});

app.get("/analytics", authMiddleware, async (req, res) => {
  const stats = await db.getStats();
  stats.daily = Analytics.dailyStats;
  res.json(stats);
});

app.get("/sessions", authMiddleware, async (req, res) => {
  const sessions = await db.getAllSessions();
  res.json({ count: sessions.length, sessions: sessions.slice(0, 100) });
});

app.get("/feedback", authMiddleware, async (req, res) => {
  res.json(await db.getFeedbackStats());
});

app.get("/unanswered", authMiddleware, async (req, res) => {
  res.json(await db.getUnanswered(50));
});

app.get("/conversation/:userId", authMiddleware, async (req, res) => {
  const messages = await db.getMessages(req.params.userId, 100);
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
    await db.getOrCreateSession(userId);
    if (simLang) await db.updateSession(userId, { language: simLang });
    const lang = simLang || (await db.getOrCreateSession(userId)).language || "id";
    const reply = await handleIncoming(userId, name || "Sim", text || "", !!buttonId, buttonId);
    await sendReply(userId, reply, lang, name || "Sim");
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

// ─── Broadcast ───

app.post("/broadcast", authMiddleware, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });

  const userIds = await db.getAllUserIds();
  let sent = 0;
  let failed = 0;

  // Kirim parallel — 10 batch
  const CONCURRENCY = 10;
  for (let i = 0; i < userIds.length; i += CONCURRENCY) {
    const batch = userIds.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(uid => whatsapp.sendMessage(uid, message))
    );
    for (const r of results) {
      if (r.status === "fulfilled") sent++;
      else failed++;
    }
  }

  res.json({ status: "ok", sent, failed, total: userIds.length });
});

app.post("/broadcast/preview", authMiddleware, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });

  const total = await db.countAllUsers();
  res.json({ status: "ok", total_users: total, preview: message.substring(0, 200) });
});

// ─── Events / Calendar ───

app.get("/events", async (req, res) => {
  const { category, days } = req.query;
  let events;
  if (days) {
    events = await db.getUpcomingEvents(parseInt(days));
  } else {
    events = await db.getEvents(100, category || null);
  }
  res.json({ count: events.length, events });
});

app.post("/events/add", authMiddleware, async (req, res) => {
  const { title, description, eventDate, category } = req.body;
  if (!title || !eventDate) return res.status(400).json({ error: "title and eventDate required" });

  const event = await db.addEvent(title, description || "", eventDate, category || "umum");
  res.json({ status: "ok", event });
});

app.delete("/events/:id", authMiddleware, async (req, res) => {
  await db.deleteEvent(parseInt(req.params.id));
  res.json({ status: "ok" });
});

// ─── Group chat handler ───

app.post("/webhook/group", async (req, res) => {
  res.sendStatus(200);
  // Handled by main webhook with group detection above
});

// ─── Start ───

const PORT = process.env.PORT || 3000;

async function start() {
  db = await new AppDatabase().init();
  app.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════════════╗`);
    console.log(`  ║       SMKN 2 Mataram AI Assistant v4       ║`);
    console.log(`  ║  Database: Supabase PostgreSQL             ║`);
    console.log(`  ║  Prisma ORM v7                             ║`);
    console.log(`  ╠══════════════════════════════════════════════╣`);
    console.log(`  ║  Languages: id, en, sas                    ║`);
    console.log(`  ║  Streaming: ON (chunked + feedback)        ║`);
    console.log(`  ║  Webhook  : http://localhost:${PORT}/webhook  ║`);
    console.log(`  ╠══════════════════════════════════════════════╣`);
    console.log(`  ║  Jurusan  : ${kb.data.jurusan.length}         │ FAQ: ${kb.data.faq.length}      ║`);
    console.log(`  ║  KB Size  : ${kb.getContext().length} chars             ║`);
    console.log(`  ║  AI Pool  : 0 instances                    ║`);
    console.log(`  ╚══════════════════════════════════════════════╝\n`);
  });
}

start().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
