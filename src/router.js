/**
 * Intent Router - deteksi topik pertanyaan otomatis
 * Hybrid: keyword-based routing + AI fallback
 */

const TOPICS = [
  {
    id: "profil",
    keywords: ["profil", "sejarah", "tentang", "identitas", "visi", "misi", "akreditasi", "sekolah ini"],
    label: "Profil Sekolah"
  },
  {
    id: "jurusan",
    keywords: ["jurusan", "kompetensi", "keahlian", "rpl", "tkj", "akl", "mpk", "bdg", "upw", "brt", "lps", "dkv", "animasi", "akuntansi", "perkantoran", "bisnis", "pemasaran", "wisata", "retail", "perbankan", "desain", "komputer", "jaringan", "pilih jurusan", "rekomendasi", "cocok", "minat", "bakat"],
    label: "Jurusan"
  },
  {
    id: "spmb",
    keywords: ["spmb", "ppdb", "daftar", "pendaftaran", "syarat", "berkas", "seleksi", "jalur", "zonasi", "afirmasi", "prestasi", "nilai", "tes", "fisik", "wawancara", "pengumuman", "ulang", "mendaftar", "daftar ulang", "masuk sekolah"],
    label: "SPMB / Pendaftaran"
  },
  {
    id: "kontak",
    keywords: ["kontak", "telepon", "telp", "whatsapp", "wa", "email", "alamat", "hubungi", "lokasi", "maps", "dimana", "jam", "kerja", "piket"],
    label: "Kontak & Alamat"
  },
  {
    id: "fasilitas",
    keywords: ["fasilitas", "laboratorium", "lab", "komputer", "perpustakaan", "lapangan", "mushola", "kantin", "uks", "wifi", "internet", "ruang", "kelas"],
    label: "Fasilitas"
  },
  {
    id: "ekskul",
    keywords: ["ekskul", "ekstrakurikuler", "kegiatan", "paskibra", "pramuka", "pmr", "osis", "rohis", "basket", "voli", "futsal", "silat", "musik", "tari", "english club", "club", "organisasi"],
    label: "Ekstrakurikuler"
  },
  {
    id: "biaya",
    keywords: ["biaya", "uang", "bayar", "spp", "gratis", "bantuan", "pip", "kip", "subsidi", "mahal", "murah"],
    label: "Biaya & Bantuan"
  },
  {
    id: "prospek",
    keywords: ["prospek", "kerja", "karir", "lulus", "alumni", "dunia kerja", "industri", "du", "di", "pkl", "magang", "kerja sama", "mitra"],
    label: "Prospek Kerja"
  }
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasKeyword(text, keyword) {
  const pattern = new RegExp(`(^|\\W)${escapeRegex(keyword)}($|\\W)`, "i");
  return pattern.test(text);
}

function detectIntent(text) {
  const q = text.toLowerCase().trim();

  if (q.length < 3) return { id: "unknown", label: "Lain-lain" };

  const scores = TOPICS.map((topic) => {
    let score = 0;
    for (const kw of topic.keywords) {
      if (hasKeyword(q, kw)) {
        score += kw.length / q.length;
      }
    }
    return { ...topic, score };
  });

  const top = scores.sort((a, b) => b.score - a.score)[0];
  if (top.score > 0.08) {
    return { id: top.id, label: top.label };
  }

  return { id: "general", label: "Pertanyaan Umum" };
}

module.exports = { detectIntent, TOPICS };
