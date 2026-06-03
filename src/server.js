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

// Skip file watcher on Vercel (read-only filesystem)
if (!process.env.VERCEL) {
  watchKb(kb, () => {
    for (const [id] of Object.entries(aiPool)) {
      aiPool[id].setContext(kb.getContext());
    }
    console.log("[WATCH] AI pool context updated");
  });
}

const streamer = new Streamer(whatsapp);
const rateLimiter = new RateLimiter();
const lastMessageId = {};
const lastFeedbackAt = {};
const aiPool = {};
const AI_POOL_TTL = 30 * 60 * 1000; // 30 menit expired
const aiPoolTimestamps = {};
const FEEDBACK_COOLDOWN_MS = 10 * 60 * 1000;

function getAI(userId) {
  if (!aiPool[userId]) {
    aiPool[userId] = new GeminiClient({ timeout: 20000 });
  }
  aiPoolTimestamps[userId] = Date.now();
  return aiPool[userId];
}

// ─── Lazy initialization (Vercel-compatible) ───
let dbReady = false;

app.use(async (req, res, next) => {
  if (dbReady) return next();
  try {
    db = await new AppDatabase().init();
    dbReady = true;
    const info = kb.data;
    console.log(`[INIT] DB ready | ${info.jurusan.length} jurusan, ${info.faq.length} FAQ`);
  } catch (err) {
    console.error("[INIT FAIL]", err);
    return res.status(500).json({ error: "Database initialization failed" });
  }
  next();
});

// ─── Intervals (only in long-running mode, not on Vercel) ───
if (!process.env.VERCEL) {
  setInterval(() => {
    db?.cleanupSessions(120);
    rateLimiter.cleanup();
    const now = Date.now();
    for (const id of Object.keys(aiPool)) {
      if ((now - (aiPoolTimestamps[id] || 0)) > AI_POOL_TTL) {
        delete aiPool[id];
        delete aiPoolTimestamps[id];
      }
    }
    const remaining = Object.keys(aiPool).length;
    if (remaining > 100) {
      const sorted = Object.entries(aiPoolTimestamps).sort((a, b) => a[1] - b[1]);
      for (const [id] of sorted.slice(0, remaining - 50)) {
        delete aiPool[id];
        delete aiPoolTimestamps[id];
      }
    }
  }, 60 * 1000);

  setInterval(async () => {
    await autoLearnFromAI();
  }, 30 * 60 * 1000);
}

async function autoLearnFromAI() {
  if (!db) return;
  const unanswered = await db.getUnanswered(20);
  for (const item of unanswered) {
    const kbMatch = kb.search(item.question);
    if (kbMatch.find(m => m.data.jawaban)) {
      await db.markAnswered(item.id);
    }
  }
}

// ─── Core Logic ───

async function handleIncoming(from, name, rawText, isButton, buttonId) {
  const dbSession = await db.getOrCreateSession(from);
  let lang = dbSession.language || "id";
  const text = sanitize(rawText || "");

  if (isButton && buttonId) {
    return handleButton(from, name, buttonId, dbSession, lang);
  }

  if (dbSession.message_count === 0 && text.match(/^(hai|halo|hello|hi|assalamualaikum|menu|start|mulai)$/i)) {
    await db.updateSession(from, { message_count: 1, state: "MENU" });
    return getWelcomeList(name || from, lang);
  }

  if (text.match(/^(bahasa|language|lang|\/language|\/bahasa)/i)) {
    return getLanguageMenu(lang);
  }

  const requestedLang = detectLanguagePreference(text);
  if (requestedLang && requestedLang !== lang) {
    lang = requestedLang;
    await db.updateSession(from, { language: requestedLang });
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
      await db.updateSession(from, { language: newLang, state: "MENU", message_count: Math.max(1, (dbSession.message_count || 0) + 1) });
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
      text: `🏫 *${lang === "en" ? "Facilities" : "Fasilitas"}*\n\n${(d.fasilitas || []).map(f => `• ${f.nama || f}: ${f.keterangan || ""}${f.jumlah ? " (" + f.jumlah + ")" : ""}`).join("\n")}`
    }),
    menu_beasiswa: () => {
      const bs = d.bantuan_siswa;
      return {
        type: "text",
        text: `🎓 *${lang === "en" ? "Student Financial Aid" : "Bantuan Siswa"}*\n\n${bs ? bs.map(p => `*${p.program}*\n${p.sumber} - ${p.besaran}\n📋 ${p.syarat}`).join("\n\n") : "Info belum tersedia."}`
      };
    },
    menu_guru: () => {
      const so = d.struktur_organisasi || {};
      return {
        type: "text",
        text: `👨‍🏫 *${lang === "en" ? "Teachers & Staff" : "Guru & Staff SMKN 2 Mataram"}*\n\n${Object.entries(so).map(([k, v]) => `• ${k.replace(/_/g, " ").toUpperCase()}: ${v}`).join("\n")}`
      };
    },
    menu_kontak: () => buildContactReply(lang),
    menu_bantuan: () => ({
      type: "text",
      text: getString(lang, "help_text", { name: name || from, menu: "" })
    }),
    menu_visimisi: () => {
      const v = d.visi_misi;
      return {
        type: "text",
        text: `🎯 *${lang === "en" ? "Vision & Mission" : "Visi & Misi SMKN 2 Mataram"}*\n\n*Visi:*\n${v.visi}\n\n*Misi:*\n${v.misi.map((m, i) => `${i + 1}. ${m}`).join("\n")}\n\n*Tujuan:*\n${v.tujuan}`
      };
    },
    menu_seragam: () => {
      const s = d.seragam;
      return {
        type: "text",
        text: `👔 *${lang === "en" ? "Uniform" : "Seragam Sekolah"}*\n\nSenin: ${s.senin}\nSelasa: ${s.selasa}\nRabu: ${s.rabu}\nKamis: ${s.kamis}\nJumat: ${s.jumat}\n\nWajib: ${s.atribut_wajib.join(", ")}.\n${s.khusus_siswi}`
      };
    },
    menu_jamsekolah: () => {
      const j = d.jam_sekolah;
      return {
        type: "text",
        text: `⏰ *${lang === "en" ? "School Hours" : "Jam Sekolah"}*\n\nSenin-Kamis: ${j.senin_kamis}\nJumat: ${j.jumat}\nIstirahat: ${j.istirahat}\n\n${j.keterangan}`
      };
    },
    menu_mpls: () => {
      const m = d.mpls;
      return {
        type: "text",
        text: `📢 *${lang === "en" ? "MPLS (Orientation)" : "MPLS - Masa Pengenalan Lingkungan Sekolah"}*\n\n${m.deskripsi}\n\n📋 Kegiatan: ${m.kegiatan.map(k => `• ${k}`).join("\n")}\n\n🚫 Larangan: ${m.larangan.map(l => `• ${l}`).join("\n")}`
      };
    },
    menu_alumni: () => {
      const a = d.alumni;
      return {
        type: "text",
        text: `🎓 *${lang === "en" ? "Alumni" : "Alumni SMKN 2 Mataram"}*\n\n${a.jumlah_alumni}\nAsosiasi: ${a.asosiasi}\nSebaran: ${a.sebaran}\n\n💼 Profesi: ${a.profesi.join(", ")}`
      };
    },
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

function isContactOrLocationQuery(text) {
  const q = text.toLowerCase().trim();
  return /\b(kontak|contact|telepon|telp|phone|email|hubungi|alamat|lokasi|lokasin|location|maps?|google maps|dimana|taok)\b/.test(q)
    || /\b(lek|di)\s+mbe\b.*\b(smk\s*2|smkn\s*2|sekolah)\b/.test(q);
}

function isLocationQuery(text) {
  const q = text.toLowerCase().trim();
  return /\b(alamat|lokasi|lokasin|location|maps?|google maps|dimana|taok)\b/.test(q)
    || /\b(lek|di)\s+mbe\b.*\b(smk\s*2|smkn\s*2|sekolah)\b/.test(q);
}

function isIncompleteAiReply(text) {
  const cleaned = String(text || "").trim();
  if (cleaned.length < 12) return true;
  return /^(saya|aku|i am|i'm|i)$/i.test(cleaned);
}

function isSpmbQuery(text) {
  const q = text.toLowerCase().trim();
  return /\b(spmb|ppdb|pendaftaran|daftar|murid baru|siswa baru|peserta didik baru)\b/.test(q);
}

function detectLanguagePreference(text) {
  const q = text.toLowerCase().trim();
  if (/\b(bahasa|basa|base|boso)\s+(lombok|sasak)\b/.test(q) || /\b(lombok|sasak)\b.*\b(bahasa|basa|base|boso)\b/.test(q)) {
    return "sas";
  }
  if (/\b(bahasa|basa|base)\s+indonesia\b/.test(q)) return "id";
  if (/\b(english|bahasa inggris)\b/.test(q)) return "en";
  return null;
}

function buildSpmbReply(lang) {
  const d = kb.data;
  const spmb = d.spmb;
  const text = lang === "en"
    ? `*SPMB SMKN 2 Mataram*\n\nRegistration for new students is currently open based on the latest school operational info. Register via the official SPMB channel announced by the school/province, and verify details through the official school website or contact.\n\nRequirements: ${spmb.persyaratan_umum.join("; ")}\n\nDocuments: ${spmb.berkas_pendaftaran.join("; ")}\n\nContact: ${d.kontak.telepon} | ${d.kontak.email}\nWebsite: ${d.kontak.website}`
    : `*SPMB SMKN 2 Mataram*\n\nPendaftaran murid baru saat ini sudah dibuka berdasarkan info operasional terbaru sekolah. Daftar melalui kanal/portal SPMB resmi yang diumumkan sekolah atau provinsi, lalu cek ulang detailnya di website resmi sekolah atau kontak sekolah.\n\nSyarat umum: ${spmb.persyaratan_umum.join("; ")}\n\nBerkas: ${spmb.berkas_pendaftaran.join("; ")}\n\nKontak: ${d.kontak.telepon} | ${d.kontak.email}\nWebsite: ${d.kontak.website}`;
  return {
    type: "text_and_cta",
    text,
    source: "kb",
    topic: lang === "en" ? "Admission" : "SPMB / Pendaftaran",
    cta: { url: d.kontak.website, label: "Info Resmi", text: "Buka website resmi SMKN 2 Mataram untuk info SPMB terbaru." }
  };
}

function shouldAskFeedback(from, reply) {
  if (!reply || reply.noFeedback) return false;
  if (reply.source !== "ai") return false;
  if (!reply.text || String(reply.text).length < 220) return false;
  const now = Date.now();
  if (now - (lastFeedbackAt[from] || 0) < FEEDBACK_COOLDOWN_MS) return false;
  lastFeedbackAt[from] = now;
  return true;
}

function buildContactReply(lang, locationOnly = false) {
  const d = kb.data.kontak;
  const phone = d.telepon.replace(/[^0-9]/g, "");
  const text = locationOnly
    ? lang === "sas"
      ? `📍 *Lokasi SMKN 2 Mataram*\nTaok sekolah: ${d.alamat}\n\nGoogle Maps:\n${d.maps_link}\n\n📞 Telepon/Fax: ${d.telepon}\n🌐 Website: ${d.website}`
      : `📍 *Lokasi SMKN 2 Mataram*\n${d.alamat}\n\nGoogle Maps:\n${d.maps_link}\n\n📞 Telepon/Fax: ${d.telepon}\n🌐 Website: ${d.website}`
    : lang === "sas"
      ? `📞 *Kontak Resmi SMKN 2 Mataram*\n\n📍 Taok: ${d.alamat}\n📞 Telepon/Fax: ${d.telepon}\n📧 Email: ${d.email}\n🌐 Website: ${d.website}\n⏰ Jam kerja: ${d.jam_kerja}\n\nGoogle Maps:\n${d.maps_link}\n\nSumber: ${d.sumber_resmi || d.website}`
      : `📞 *Kontak Resmi SMKN 2 Mataram*\n\n📍 Alamat: ${d.alamat}\n📞 Telepon/Fax: ${d.telepon}\n📧 Email: ${d.email}\n🌐 Website: ${d.website}\n⏰ Jam kerja: ${d.jam_kerja}\n\nGoogle Maps:\n${d.maps_link}\n\nSumber: ${d.sumber_resmi || d.website}`;

  if (!locationOnly) {
    return {
      type: "contact_and_cta",
      text,
      source: "kb",
      topic: lang === "en" ? "Contact & Address" : "Kontak & Alamat",
      contact: {
        name: {
          formatted_name: "SMKN 2 Mataram",
          first_name: "SMKN 2 Mataram"
        },
        org: {
          company: "SMK Negeri 2 Mataram",
          department: "Humas",
          title: "Kontak Resmi Sekolah"
        },
        phones: [{ phone, type: "WORK" }],
        emails: d.email.split(",").map(email => ({ email: email.trim(), type: "WORK" })),
        urls: [{ url: d.website, type: "WORK" }],
        addresses: [{
          street: d.alamat,
          city: "Mataram",
          state: "Nusa Tenggara Barat",
          zip: "831125",
          country: "Indonesia",
          country_code: "ID",
          type: "WORK"
        }]
      },
      cta: { url: d.website, label: "Buka Website", text: "Buka website resmi SMKN 2 Mataram untuk informasi terbaru." }
    };
  }

  return {
    type: "location_and_cta",
    text,
    source: "kb",
    topic: lang === "en" ? "Contact & Address" : "Kontak & Alamat",
    location: { lat: -8.5833, lng: 116.1167, name: "SMKN 2 Mataram", address: d.alamat },
    cta: { url: d.maps_link, label: "Buka Maps", text: "Buka lokasi SMKN 2 Mataram di Google Maps." }
  };
}

function getCurrentWitaContext() {
  const value = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Makassar",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short"
  }).format(new Date());
  return `\n\nWaktu saat ini untuk konteks lokal sekolah: ${value}. Gunakan zona waktu WITA/Asia Makassar saat menjawab pertanyaan waktu.`;
}

function buildNumberContext(messages) {
  const snippets = (messages || [])
    .filter(m => /\d/.test(m.content || ""))
    .slice(-5)
    .map(m => {
      const content = String(m.content || "").replace(/\s+/g, " ").substring(0, 260);
      return `${m.role === "user" ? "User" : "AI"}: ${content}`;
    });
  if (snippets.length === 0) return "";
  return `\n\nAngka/nilai yang sudah disebut di percakapan terbaru:\n${snippets.join("\n")}\nJika pengguna bertanya lanjutan tentang total, rata-rata, peluang, atau nilai, gunakan angka dari riwayat ini. Jika angka yang dibutuhkan belum cukup, minta pengguna mengirim daftar nilainya, jangan mengatakan tidak punya akses ke data pribadi jika angkanya sudah ada di chat.`;
}

async function processQuestion(from, name, text, dbSession, lang) {
  const intent = Router.detectIntent(text);
  const topic = intent.label;

  if (intent.id === "kontak" || isContactOrLocationQuery(text)) {
    const reply = buildContactReply(lang, isLocationQuery(text));
    Analytics.trackMessage(from, name, { text, type: "text", source: "kb", topic: reply.topic, responseTime: 0 });
    return reply;
  }

  try {
    const recentMessages = await db.getConversationContext(from, 12);
    const historyStr = recentMessages.length > 0
      ? "\n\nRiwayat percakapan:\n" + recentMessages.map(m =>
          `${m.role === "user" ? "User" : "AI"}: ${m.content.substring(0, 500)}`
        ).join("\n")
      : "";
    const numberContext = buildNumberContext(recentMessages);

    const ai = getAI(from);
    const smartCtx = kb.smartContext(text);
    const langInstruction = lang === "en"
      ? "\n\nIMPORTANT: Answer in English. Use English for greetings and all responses."
      : lang === "sas"
      ? "\n\nPENTING: Jawab dalam bahasa Sasak (bahasa asli Lombok). Gunakan bahasa Sasak untuk semua jawaban."
      : "\n\nPENTING: Jawab dalam Bahasa Indonesia yang baik dan benar.";
    const assistantInstruction = "\n\nIdentitas Anda: Asisten AI SMKN 2 Mataram. Tugas Anda hanya membantu informasi terkait SMKN 2 Mataram: jurusan, SPMB, fasilitas, jadwal, lokasi, kontak, profil sekolah, dan percakapan pendukung yang masih relevan. Jangan mengaku sebagai manusia atau panitia resmi; Anda asisten informasi.";
    const styleInstruction = "\n\nGaya jawaban WhatsApp: jawab natural, singkat, dan langsung berguna. Target 3-7 kalimat atau maksimal 5 bullet. Hindari artikel panjang, tabel, garis pemisah, heading markdown, dan format ***teks***. Jika memakai penekanan, gunakan format WhatsApp sederhana seperti *Catatan:* atau *Saran:* saja. Untuk pertanyaan peluang seleksi, jangan menjamin diterima; beri estimasi wajar, faktor penentu, dan langkah berikutnya. Untuk pertanyaan hitungan, total, rata-rata, atau nilai, hitung dari angka yang diberikan user atau riwayat chat. Tampilkan perhitungan singkat jika memungkinkan.";
    const memoryInstruction = "\n\nMemori percakapan: gunakan riwayat chat terbaru untuk mengingat nama, preferensi bahasa, angka/nilai, jurusan yang diminati, dan konteks lanjutan. Jika user baru saja menyebut nama atau data dirinya di riwayat, pakai data itu. Jangan bilang tidak tahu hanya karena tidak ada di database sekolah.";
    const generalInstruction = "\n\nBatasan: jika pertanyaan benar-benar di luar konteks SMKN 2 Mataram atau percakapan pendukungnya, tolak dengan sopan dan arahkan kembali ke info SMKN 2 Mataram. Jangan memberi bantuan umum seperti coding, tugas non-sekolah, hiburan, atau topik bebas. Jangan berhenti di kalimat tidak lengkap.";
    const baseContext = smartCtx + historyStr + numberContext + langInstruction + assistantInstruction + styleInstruction + memoryInstruction + generalInstruction + getCurrentWitaContext();
    ai.setContext(baseContext);
    ai.reset();

    const aiStart = Date.now();
    let response = await ai.ask(text);
    if (isIncompleteAiReply(response?.text)) {
      ai.reset();
      ai.setContext(historyStr + numberContext + langInstruction + assistantInstruction + styleInstruction + memoryInstruction + generalInstruction + getCurrentWitaContext());
      response = await ai.ask(text);
    }

    if (response?.text && !isIncompleteAiReply(response.text)) {
      const timeMs = Date.now() - aiStart;
      console.log(`[AI DONE] ${from}: ${response.text.length} chars in ${timeMs}ms`);

      Analytics.trackMessage(from, name, { text, type: "text", source: "ai", topic, responseTime: timeMs });

      const reply = { text: toWhatsApp(response.text), source: "ai", topic };
      if (shouldAskFeedback(from, reply)) {
        const fbLang = lang || "id";
        const fb = getFeedbackButtons(fbLang);
        const mid = lastMessageId[from] || 0;
        setTimeout(async () => {
          try {
            await sleep(1500);
            await whatsapp.sendButtonMessage(from, fb.text, fb.buttons.map(b => ({
              ...b,
              id: b.id + (mid ? `_${mid}` : "")
            })));
          } catch (e) {}
        }, 1000);
      }

      return reply;
    }
    throw new Error(response?.text ? "incomplete" : "empty");
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

    await db.addUnanswered(from, text, `AI+KB fail: ${err.message.substring(0, 100)}`);
    Analytics.trackMessage(from, name, { text, type: "text", source: "unanswered", topic, responseTime: 0 });

    return {
      text: "Maaf, jawaban AI barusan gagal dibuat lengkap. Coba kirim ulang pertanyaannya dengan kalimat yang sama atau sedikit lebih jelas.",
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
      await whatsapp.sendListMessage(from, menu.text, menu.button, menu.sections, { header: menu.header, footer: menu.footer || "SMKN 2 Mataram - Ketik 'menu' kapan saja" });
    } else if (menu.buttons) {
      await whatsapp.sendButtonMessage(from, menu.text, menu.buttons);
    }
    return;
  }

  if (reply.isStream && Array.isArray(reply.text)) {
    // Legacy streaming - send chunks with natural delays
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

  if (reply.streamed) {
    // True SSE streaming - already sent incrementally, no further action needed
    return;
  }

  if (reply.type === "location_and_cta") {
    // Send: text info + location + optional CTA button
    const parts = Splitter.split(reply.text);
    for (const part of parts) {
      await whatsapp.sendMessage(from, part);
    }
    if (reply.location) {
      await sleep(500);
      await whatsapp.sendLocation(from, reply.location.lat, reply.location.lng, reply.location.name, reply.location.address);
    }
    if (reply.cta) {
      await sleep(800);
      await whatsapp.sendCTAButton(from, reply.cta.text || reply.cta.label || "Open link", reply.cta.url, reply.cta.label || "Open");
    }
    return;
  }

  if (reply.type === "contact_and_cta") {
    const parts = Splitter.split(reply.text);
    for (const part of parts) {
      await whatsapp.sendMessage(from, part);
    }
    if (reply.contact) {
      await sleep(500);
      await whatsapp.sendContact(from, reply.contact);
    }
    if (reply.cta) {
      await sleep(800);
      await whatsapp.sendCTAButton(from, reply.cta.text || reply.cta.label || "Open link", reply.cta.url, reply.cta.label || "Open");
    }
    return;
  }

  if (reply.type === "text_and_cta") {
    const parts = Splitter.split(reply.text);
    for (const part of parts) {
      await whatsapp.sendMessage(from, part);
    }
    if (reply.cta) {
      await sleep(800);
      await whatsapp.sendCTAButton(from, reply.cta.text || reply.cta.label || "Open link", reply.cta.url, reply.cta.label || "Open");
    }
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
    await whatsapp.sendListMessage(from, reply.text, reply.button || "Pilih", reply.sections, {
      header: reply.header,
      footer: reply.footer || "SMKN 2 Mataram"
    });
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
  try {
    await processWebhook(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error("[WEBHOOK FATAL]", err?.message || err);
    res.sendStatus(200);
  }
});

async function processWebhook(body) {
  const parsed = whatsapp.parseIncoming(body);
  if (!parsed) return;

  const start = Date.now();
  const { from, text: rawText, name, isButton, buttonId, type: msgType } = parsed;

  try {
    if (parsed.msgId) {
      whatsapp.sendTyping(from, parsed.msgId).catch(err => console.error(`[TYPING ERR] ${from}: ${err.message}`));
    }

    const rateCheck = rateLimiter.check(from);
    if (!rateCheck.allowed) {
      await whatsapp.sendMessage(from, "Mohon tunggu sebentar, Anda terlalu cepat mengirim pesan. Silakan coba lagi dalam beberapa detik.");
      return;
    }

    const msgCtx = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.context;
    if (msgCtx?.group_id) return;

    if (isButton && buttonId && !validateButtonId(buttonId)) return;

    if (msgType !== "text" && !isButton) {
      const reply = handleNonTextMessage({ type: msgType });
      if (reply) await whatsapp.sendMessage(from, reply);
      return;
    }

    const lang = ((await db.getOrCreateSession(from))?.language) || "id";
    console.log(`[⬇ ${isButton ? "BTN" : "TXT"}] ${(name || "?").padEnd(12)} ${from} → ${(rawText || buttonId || "").substring(0, 100)}`);

    const reply = await handleIncoming(from, name, rawText, isButton, buttonId);
    await sendReply(from, reply, lang, name);
    console.log(`[⬆ OK] ${from} (${Date.now() - start}ms)`);
  } catch (err) {
    console.error(`[❌ ERR] ${from || "?"}: ${(err.message || err).substring(0, 100)}`);
    try {
      await whatsapp.sendMessage(from, "Maaf, terjadi kesalahan. Silakan coba lagi atau ketik 'menu'.");
    } catch (_) {}
  }
}

// ─── Admin & Utility Routes ───

app.get("/", async (req, res) => {
  try {
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
  } catch (err) {
    res.json({
      app: "SMKN 2 Mataram AI Assistant",
      version: "4.0",
      status: "degraded",
      db: "unavailable",
      stats: {
        jurusan: kb.data.jurusan.length,
        faq: kb.data.faq.length,
        ai_instances: Object.keys(aiPool).length
      }
    });
  }
});

app.get("/health", async (req, res) => {
  try {
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
  } catch (err) {
    res.status(503).json({ status: "degraded", db: "unavailable" });
  }
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

app.post("/simulate", authMiddleware, async (req, res) => {
  const { userId, name, text, buttonId, lang: simLang, dryRun } = req.body;
  if (!userId || (!text && !buttonId)) {
    return res.status(400).json({ error: "userId and text or buttonId required" });
  }

  const start = Date.now();
  try {
    await db.getOrCreateSession(userId);
    if (simLang) await db.updateSession(userId, { language: simLang });
    const lang = simLang || (await db.getOrCreateSession(userId)).language || "id";
    const reply = await handleIncoming(userId, name || "Sim", text || "", !!buttonId, buttonId);
    if (!dryRun) {
      await sendReply(userId, reply, lang, name || "Sim");
    }
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

  // Kirim parallel - 10 batch
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

// Local: listen on port (Vercel handles this itself)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[SERVER] Listening on :${PORT}`);
  });
}

// Export for Vercel serverless runtime
module.exports = app;
