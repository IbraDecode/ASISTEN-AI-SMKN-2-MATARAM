const fs = require("fs");
const path = require("path");

class KnowledgeBase {
  constructor() {
    this.data = null;
    this.fullContext = "";
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
        keywords: ["spmb", "ppdb", "daftar", "pendaftaran", "syarat", "berkas", "seleksi", "jalur", "zonasi", "afirmasi", "prestasi", "tes", "fisik", "wawancara", "pengumuman", "ulang", "admission", "registration", "requirement", "document", "selection", "zone", "achievement", "test", "interview", "announcement", "enroll", "apply", "register"],
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
  }

  getContext(query) {
    if (!this.fullContext) this.load();

    if (!query) return this.fullContext;

    const q = query.toLowerCase();

    const matchedSections = Object.entries(this.sections)
      .filter(([key, section]) => {
        if (key === "faq") {
          return section.content.toLowerCase().includes(q);
        }
        return section.keywords.some(kw => q.includes(kw));
      })
      .map(([key]) => key);

    if (matchedSections.length === 0) {
      return this.fullContext;
    }

    // Always include profil at front + kontak at end as base context
    if (!matchedSections.includes("profil")) {
      matchedSections.unshift("profil");
    }
    if (!matchedSections.includes("kontak")) {
      matchedSections.push("kontak");
    }

    const parts = matchedSections.map(key => this.sections[key].content);
    return parts.join("\n\n");
  }

  smartContext(query) {
    return this.getContext(query);
  }

  search(query) {
    const q = query.toLowerCase();
    const results = [];
    const d = this.data;
    if (!d) return results;

    d.jurusan.forEach((j) => {
      if (
        j.nama.toLowerCase().includes(q) ||
        j.singkatan.toLowerCase().includes(q) ||
        j.deskripsi.toLowerCase().includes(q)
      ) {
        results.push({ type: "jurusan", data: j, score: 1 });
      }
    });

    d.faq.forEach((f) => {
      if (
        f.pertanyaan.toLowerCase().includes(q) ||
        f.jawaban.toLowerCase().includes(q)
      ) {
        results.push({ type: "faq", data: f, score: 1 });
      }
    });

    return results;
  }

  smartContext(query) {
    if (!this.fullContext) this.load();
    return this.getContext(query);
  }
}

module.exports = KnowledgeBase;
