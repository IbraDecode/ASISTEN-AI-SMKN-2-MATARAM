/**
 * Multi-Language Support
 * 
 * Supported: id (Indonesia), en (English), sas (Sasak)
 */

const LANGUAGES = {
  id: {
    name: "Bahasa Indonesia",
    code: "id",
    keywords: ["apa", "bagaimana", "kenapa", "siapa", "dimana", "kapan", "berapa", "saya", "kamu", "kami", "tolong", "bisa", "ada", "tidak", "ya", "hai", "halo", "makasih", "terima kasih"],
    welcome: "Halo {name} 👋\n\nSelamat datang di *Asisten AI SMKN 2 Mataram*.\nSaya siap membantu Anda menjawab pertanyaan seputar sekolah.",
    menu_jurusan: "📚 Jurusan",
    menu_spmb: "📋 SPMB",
    menu_kontak: "📞 Kontak",
    back: "🔙 Kembali",
    feedback_positive: "👍 Berguna",
    feedback_negative: "👎 Tidak",
    thanks_feedback: "Terima kasih atas masukannya! 🙏",
    sorry_unanswered: "Maaf {name}, saya belum bisa menjawab pertanyaan itu. Silakan hubungi langsung:",
    switch_language: "🌐 Bahasa",
    choose_language: "Pilih bahasa:",
    language_set: "Bahasa diubah ke {lang} ✅",
    type_help: "Ketik 'menu' untuk kembali ke menu utama"
  },

  en: {
    name: "English",
    code: "en",
    keywords: ["what", "how", "why", "who", "where", "when", "how much", "i", "you", "we", "please", "can", "is", "are", "do", "does", "hello", "hi", "thanks", "thank you"],
    welcome: "Hello {name} 👋\n\nWelcome to *SMKN 2 Mataram AI Assistant*.\nI'm here to help you with information about our school.",
    menu_jurusan: "📚 Majors",
    menu_spmb: "📋 Admission",
    menu_kontak: "📞 Contact",
    back: "🔙 Back",
    feedback_positive: "👍 Helpful",
    feedback_negative: "👎 Not Helpful",
    thanks_feedback: "Thank you for your feedback! 🙏",
    sorry_unanswered: "Sorry {name}, I couldn't answer that. Please contact us directly:",
    switch_language: "🌐 Language",
    choose_language: "Choose language:",
    language_set: "Language changed to {lang} ✅",
    type_help: "Type 'menu' to return to main menu"
  },

  sas: {
    name: "Sasak",
    code: "sas",
    keywords: ["ape", "kembe", "kenapa", "se", "dimbe", "pire", "tiang", "side", "ite", "tulung", "bisa", "ade", "ndeq", "ya", "hai", "halo", "matur suksma", "tampiasih"],
    welcome: "Halo {name} 👋\n\nSelamat datas kaik *Asisten AI SMKN 2 Mataram*.\nTiang siap mantul sampean nawer informasi sekolah.",
    menu_jurusan: "📚 Jurusan",
    menu_spmb: "📋 SPMB",
    menu_kontak: "📞 Kontak",
    back: "🔙 Walik",
    feedback_positive: "👍 Berguna",
    feedback_negative: "👎 Ndeq",
    thanks_feedback: "Matur suksma masukan side! 🙏",
    sorry_unanswered: "Maaf {name}, tiang derik jawab pertanyaan nike. Tulung hubungi langsung:",
    switch_language: "🌐 Bahasa",
    choose_language: "Pilih bahasa:",
    language_set: "Bahasa ubah dadi {lang} ✅",
    type_help: "Ketik 'menu' balik ka menu utama"
  }
};

function detectLanguage(text) {
  if (!text || typeof text !== "string") return "id";
  const q = text.toLowerCase().trim();

  // Score each language by keyword density
  const scores = {};
  for (const [code, lang] of Object.entries(LANGUAGES)) {
    let score = 0;
    for (const kw of lang.keywords) {
      if (q.includes(kw)) score++;
    }
    // Normalize by text length (longer text = more keywords expected)
    scores[code] = q.length > 0 ? (score / q.length) * 1000 : 0;
  }

  // Find best match
  let bestLang = "id";
  let bestScore = 0;
  for (const [code, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestLang = code;
    }
  }

  return bestLang;
}

function getString(lang, key, params = {}) {
  const l = LANGUAGES[lang] || LANGUAGES.id;
  let text = l[key] || LANGUAGES.id[key] || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(`{${k}}`, v);
  }
  return text;
}

function getWelcomeButtons(name, lang) {
  return {
    text: getString(lang, "welcome", { name }),
    buttons: [
      { id: "menu_jurusan", title: getString(lang, "menu_jurusan") },
      { id: "menu_spmb", title: getString(lang, "menu_spmb") },
      { id: "menu_kontak", title: getString(lang, "menu_kontak") }
    ]
  };
}

function getFeedbackButtons(lang) {
  return {
    text: lang === "id" ? "Apakah jawaban ini membantu?" : lang === "en" ? "Was this helpful?" : "Membantu jawaban nike?",
    buttons: [
      { id: "feedback_up", title: getString(lang, "feedback_positive") },
      { id: "feedback_down", title: getString(lang, "feedback_negative") }
    ]
  };
}

function getLanguageMenu(lang) {
  return {
    text: getString(lang, "choose_language"),
    buttons: [
      { id: "lang_id", title: "🇮🇩 Indonesia" },
      { id: "lang_en", title: "🇬🇧 English" },
      { id: "lang_sas", title: "🇮🇩 Sasak" }
    ]
  };
}

module.exports = {
  LANGUAGES,
  detectLanguage,
  getString,
  getWelcomeButtons,
  getFeedbackButtons,
  getLanguageMenu
};
