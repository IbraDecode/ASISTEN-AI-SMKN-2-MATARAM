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
    menu_prestasi: "🏆 Prestasi",
    menu_ekskul: "⚽ Ekstrakurikuler",
    menu_fasilitas: "🏫 Fasilitas",
    menu_beasiswa: "🎓 Bantuan Siswa",
    menu_guru: "👨‍🏫 Guru & Staff",
    menu_bantuan: "❓ Bantuan",
    back: "🔙 Kembali",
    feedback_positive: "👍 Berguna",
    feedback_negative: "👎 Tidak",
    thanks_feedback: "Terima kasih atas masukannya! 🙏",
    sorry_unanswered: "Maaf {name}, saya belum bisa menjawab pertanyaan itu. Silakan hubungi langsung:",
    switch_language: "🌐 Bahasa",
    choose_language: "Pilih bahasa:",
    language_set: "Bahasa diubah ke {lang} ✅",
    type_help: "Ketik 'menu' untuk kembali ke menu utama",
    help_text: "Halo {name}! 👋\n\nSaya asisten AI SMKN 2 Mataram. Saya bisa:\n• Info jurusan (RPL, TKJ, AKL, dll)\n• Syarat & jadwal SPMB\n• Fasilitas & ekstrakurikuler\n• Prestasi sekolah\n• Kontak sekolah\n\nCukup ketik pertanyaan atau pilih menu. Ketik 'menu' untuk kembali kapan saja."
  },

  en: {
    name: "English",
    code: "en",
    keywords: ["what", "how", "why", "who", "where", "when", "how much", "i", "you", "we", "please", "can", "is", "are", "do", "does", "hello", "hi", "thanks", "thank you"],
    welcome: "Hello {name} 👋\n\nWelcome to *SMKN 2 Mataram AI Assistant*.\nI'm here to help you with information about our school.",
    menu_jurusan: "📚 Majors",
    menu_spmb: "📋 Admission",
    menu_kontak: "📞 Contact",
    menu_prestasi: "🏆 Achievements",
    menu_ekskul: "⚽ Extracurricular",
    menu_fasilitas: "🏫 Facilities",
    menu_beasiswa: "🎓 Student Aid",
    menu_guru: "👨‍🏫 Teachers & Staff",
    menu_bantuan: "❓ Help",
    back: "🔙 Back",
    feedback_positive: "👍 Helpful",
    feedback_negative: "👎 Not Helpful",
    thanks_feedback: "Thank you for your feedback! 🙏",
    sorry_unanswered: "Sorry {name}, I couldn't answer that. Please contact us directly:",
    switch_language: "🌐 Language",
    choose_language: "Choose language:",
    language_set: "Language changed to {lang} ✅",
    type_help: "Type 'menu' to return to main menu",
    help_text: "Hello {name}! 👋\n\nI'm the SMKN 2 Mataram AI Assistant. I can help with:\n• Majors info (RPL, TKJ, AKL, etc.)\n• Admission requirements & schedule\n• Facilities & extracurricular\n• School achievements\n• Contact info\n\nJust type your question or pick from the menu. Type 'menu' anytime to return."
  },

  sas: {
    name: "Sasak",
    code: "sas",
    keywords: ["ape", "kembe", "kenapa", "se", "dimbe", "pire", "tiang", "side", "ite", "tulung", "bisa", "ade", "ndeq", "ya", "hai", "halo", "matur suksma", "tampiasih"],
    welcome: "Halo {name} 👋\n\nSelamat datas kaik *Asisten AI SMKN 2 Mataram*.\nTiang siap mantul sampean nawer informasi sekolah.",
    menu_jurusan: "📚 Jurusan",
    menu_spmb: "📋 SPMB",
    menu_kontak: "📞 Kontak",
    menu_prestasi: "🏆 Prestasi",
    menu_ekskul: "⚽ Ekstrakurikuler",
    menu_fasilitas: "🏫 Fasilitas",
    menu_beasiswa: "🎓 Bantuan Siswa",
    menu_guru: "👨‍🏫 Guru & Staff",
    menu_bantuan: "❓ Bantuan",
    back: "🔙 Walik",
    feedback_positive: "👍 Berguna",
    feedback_negative: "👎 Ndeq",
    thanks_feedback: "Matur suksma masukan side! 🙏",
    sorry_unanswered: "Maaf {name}, tiang derik jawab pertanyaan nike. Tulung hubungi langsung:",
    switch_language: "🌐 Bahasa",
    choose_language: "Pilih bahasa:",
    language_set: "Bahasa ubah dadi {lang} ✅",
    type_help: "Ketik 'menu' balik ka menu utama",
    help_text: "Halo {name}! 👋\n\nTiang asisten AI SMKN 2 Mataram. Tiang isa mantul:\n• Info jurusan (RPL, TKJ, AKL, dll)\n• Syarat & jadwal SPMB\n• Fasilitas & ekstrakurikuler\n• Prestasi sekolah\n• Kontak sekolah\n\nCukup ketik pertanyaan atau pilih menu. Ketik 'menu' balik kapan aja."
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

let kbCache = null;
function setKbCache(kb) { kbCache = kb; }

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

function getWelcomeList(name, lang) {
  return {
    type: "list",
    text: getString(lang, "welcome", { name }),
    button: getString(lang, "menu_jurusan").startsWith("📚") ? "📋 Pilih Menu" : "📋 Menu",
    sections: [
      {
        title: "📖 Informasi",
        rows: [
          { id: "menu_jurusan", title: getString(lang, "menu_jurusan"), description: `${kbCache?.data?.jurusan?.length || 0} kompetensi keahlian` },
          { id: "menu_spmb", title: getString(lang, "menu_spmb"), description: "Syarat & jadwal pendaftaran" },
          { id: "menu_prestasi", title: getString(lang, "menu_prestasi"), description: "Prestasi sekolah" },
          { id: "menu_ekskul", title: getString(lang, "menu_ekskul"), description: "Kegiatan ekstrakurikuler" },
          { id: "menu_fasilitas", title: getString(lang, "menu_fasilitas"), description: "Sarana & prasarana" },
          { id: "menu_beasiswa", title: getString(lang, "menu_beasiswa"), description: "PIP/KIP & beasiswa" }
        ]
      },
      {
        title: "🔗 Lainnya",
        rows: [
          { id: "menu_guru", title: getString(lang, "menu_guru"), description: "Direktori guru & staff" },
          { id: "menu_kontak", title: getString(lang, "menu_kontak"), description: "Alamat, telepon, email" },
          { id: "lang_menu", title: getString(lang, "switch_language"), description: "Ganti bahasa" },
          { id: "menu_bantuan", title: getString(lang, "menu_bantuan"), description: "Cara menggunakan bot" }
        ]
      }
    ]
  };
}

function getJurusanList(jurusan, lang) {
  return {
    type: "list",
    text: lang === "en" ? "Select a major for details:" : "Pilih jurusan untuk detail:",
    button: lang === "en" ? "Majors" : "Jurusan",
    sections: [
      {
        title: lang === "en" ? "Majors" : "Daftar Jurusan",
        rows: jurusan.map(j => ({
          id: `jurusan_${j.id}`,
          title: j.singkatan,
          description: j.nama.substring(0, 40)
        }))
      }
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
  getWelcomeList,
  getJurusanList,
  getFeedbackButtons,
  getLanguageMenu,
  setKbCache
};
