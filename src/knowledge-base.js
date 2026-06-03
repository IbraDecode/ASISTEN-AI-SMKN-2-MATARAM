const fs = require("fs");
const path = require("path");

class KnowledgeBase {
  constructor() {
    this.data = null;
    this.fullContext = "";
    this.minimalContext = "";
    this.sections = {};
  }

  load() {
    const kbPath = path.join(__dirname, "..", "data", "kb.json");
    const raw = fs.readFileSync(kbPath, "utf-8");
    this.data = JSON.parse(raw);
    this._buildSections();
    this._buildFullContext();
    return this.data;
  }

  _buildSections() {
    const d = this.data;
    if (!d) return;

    this.sections = {
      profil: {
        keywords: ["profil", "sejarah", "tentang", "identitas", "visi", "misi", "alamat", "profile", "history", "about", "identity", "address", "smkn 2 mataram", "smk negeri 2 mataram"],
        content: `Nama: ${d.metadata.school_name}
NPSN: ${d.metadata.npsn}
Akreditasi: ${d.metadata.akreditasi}
Berdiri: ${d.metadata.established}
Status: ${d.metadata.status}
Kepala Sekolah: ${d.metadata.kepala_sekolah}
Alamat: ${d.metadata.alamat}
Telepon: ${d.metadata.telepon} | Fax: ${d.metadata.fax}
Email: ${d.metadata.email}
Website: ${d.metadata.website}
Total Siswa: ${d.metadata.total_siswa} | Total Guru: ${d.metadata.total_guru}`
      },
      jurusan: {
        keywords: ["jurusan", "kompetensi", "keahlian", "rpl", "tkj", "akl", "mpk", "bdg", "upw", "brt", "lps", "dkv", "animasi", "akuntansi", "perkantoran", "bisnis", "wisata", "retail", "perbankan", "desain", "komputer", "jaringan", "major", "skill", "competence", "department", "program", "rpl", "tkj", "accounting", "office", "digital business", "travel", "software engineering", "network", "visual communication"],
        content: d.jurusan.map(j =>
          `- ${j.nama} (${j.singkatan}): ${j.deskripsi} | Prospek: ${j.prospek_kerja.join(", ")}`
        ).join("\n")
      },
      spmb: {
        keywords: ["spmb", "ppdb", "daftar", "pendaftaran", "syarat", "berkas", "seleksi", "jalur", "zonasi", "afirmasi", "prestasi", "nilai", "rapor", "diterima", "keterima", "peluang", "tes", "fisik", "wawancara", "pengumuman", "ulang", "admission", "registration", "requirement", "document", "selection", "zone", "achievement", "test", "interview", "announcement", "enroll", "apply", "register"],
        content: `Deskripsi: ${d.spmb.deskripsi}
Jalur: ${d.spmb.jalur_pendaftaran.map(j => `${j.nama} (${j.keterangan})`).join(" | ")}
Syarat: ${d.spmb.persyaratan_umum.join(", ")}
Berkas: ${d.spmb.berkas_pendaftaran.join(", ")}
Tahapan: ${d.spmb.tahapan.map((t, i) => `${i + 1}. ${t}`).join(" | ")}`
      },
      fasilitas: {
        keywords: ["fasilitas", "laboratorium", "lab", "perpustakaan", "lapangan", "mushola", "kantin", "uks", "wifi"],
        content: d.fasilitas.map(f => `- ${f}`).join("\n")
      },
      ekskul: {
        keywords: ["ekskul", "ekstrakurikuler", "paskibra", "pramuka", "pmr", "osis", "rohis", "basket", "voli", "futsal", "silat", "musik", "tari", "english"],
        content: d.ekstrakurikuler.map(e => `- ${e}`).join("\n")
      },
      kontak: {
        keywords: ["kontak", "telepon", "telp", "whatsapp", "email", "alamat", "hubungi", "jam", "kerja", "contact", "phone", "call", "address", "location", "hour", "open"],
        content: Object.entries(d.kontak).map(([k, v]) => `${k}: ${v}`).join("\n")
      },
      faq: {
        keywords: [],
        content: d.faq.map(f => `Q: ${f.pertanyaan}\nA: ${f.jawaban}`).join("\n\n")
      }
    };
  }

  _buildFullContext() {
    const parts = [];
    for (const [, section] of Object.entries(this.sections)) {
      parts.push(section.content);
    }
    this.fullContext = parts.join("\n\n");
    this.minimalContext = this._buildMinimalContext();
  }

  _buildMinimalContext() {
    const d = this.data;
    if (!d) return "";
    return `Identitas singkat: ${d.metadata.school_name}, NPSN ${d.metadata.npsn}, akreditasi ${d.metadata.akreditasi}, alamat ${d.kontak.alamat}.
Kontak resmi: ${d.kontak.telepon}, ${d.kontak.email}, ${d.kontak.website}.`;
  }

  _tokens(query) {
    const stopwords = new Set([
      "apa", "ada", "dan", "atau", "yang", "untuk", "dari", "dengan", "saya", "aku", "kamu", "anda",
      "di", "ke", "ini", "itu", "yg", "yang", "nya", "dong", "tolong", "bisa", "mau", "ingin"
    ]);
    return query.toLowerCase()
      .replace(/[^a-z0-9\s]/gi, " ")
      .split(/\s+/)
      .filter(t => t.length > 2 && !stopwords.has(t));
  }

  _hasKeyword(q, keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\W)${escaped}($|\\W)`, "i").test(q);
  }

  getContext(query) {
    if (!this.fullContext) this.load();

    if (!query) return this.fullContext;

    const q = query.toLowerCase();
    const tokens = this._tokens(q);
    const schoolRelated = /\b(smkn?\s*2|smk\s*negeri\s*2|mataram|sekolah|jurusan|spmb|ppdb|pendaftaran|daftar|nilai|rapor|diterima|keterima|lokasi|alamat|kontak)\b/i.test(q);

    const matchedSections = Object.entries(this.sections)
      .filter(([key, section]) => {
        if (key === "faq") return false;
        return section.keywords.some(kw => this._hasKeyword(q, kw));
      })
      .map(([key]) => key);

    const faqMatches = this.search(query)
      .filter(m => m.type === "faq" && m.score >= 3)
      .slice(0, 3)
      .map(m => `Q: ${m.data.pertanyaan}\nA: ${m.data.jawaban}`);

    if (matchedSections.length === 0) {
      if (faqMatches.length) {
        const base = schoolRelated ? `${this.minimalContext}\n\n` : "";
        return `${base}FAQ relevan:\n${faqMatches.join("\n\n")}`.slice(0, 7000);
      }
      return schoolRelated ? this.minimalContext : "";
    }

    if (schoolRelated && !matchedSections.includes("profil")) {
      matchedSections.unshift("profil");
    }
    if ((schoolRelated || matchedSections.includes("kontak")) && !matchedSections.includes("kontak")) {
      matchedSections.push("kontak");
    }

    const parts = matchedSections.map(key => this.sections[key].content);
    if (faqMatches.length) {
      parts.push(`FAQ relevan:\n${faqMatches.join("\n\n")}`);
    }

    return parts.join("\n\n").slice(0, 7000);
  }

  search(query) {
    const q = query.toLowerCase().trim();
    const results = [];
    const d = this.data;
    if (!d || !q) return results;

    // Tokenize query into keywords
    const tokens = this._tokens(q).filter(t => !["sekolah", "smk", "smkn", "negeri", "mataram"].includes(t));

    d.jurusan.forEach((j) => {
      const target = (j.nama + " " + j.singkatan + " " + j.deskripsi).toLowerCase();
      let score = 0;
      if (q.length >= 4 && target.includes(q)) { score = 10; }
      else {
        for (const t of tokens) {
          if (target.includes(t)) score++;
        }
      }
      if (score > 0) {
        results.push({ type: "jurusan", data: j, score });
      }
    });

    d.faq.forEach((f) => {
      const pertanyaan = f.pertanyaan.toLowerCase();
      const jawaban = f.jawaban.toLowerCase();
      const target = pertanyaan + " " + jawaban;
      let score = 0;
      if (q.length >= 4 && target.includes(q)) { score = 10; }
      else {
        for (const t of tokens) {
          if (pertanyaan.includes(t)) score += 3; // prefer question match
          else if (jawaban.includes(t)) score++;
        }
      }
      if (score > 0) {
        results.push({ type: "faq", data: f, score });
      }
    });

    // Sort by score descending, keep top 5
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 5);
  }

  smartContext(query) {
    if (!this.fullContext) this.load();
    return this.getContext(query);
  }
}

module.exports = KnowledgeBase;
