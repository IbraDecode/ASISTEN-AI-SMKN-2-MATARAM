/**
 * Ingest Tool — Training Knowledge Base SMKN 2 Mataram
 *
 * Cara pakai:
 *   1. Tambah data baru di data/kb.json
 *   2. Jalankan: node train/ingest.js
 *   3. Tool ini akan validasi dan kasih laporan
 */

const fs = require("fs");
const path = require("path");

const kbPath = path.join(__dirname, "..", "data", "kb.json");

function validate() {
  const raw = fs.readFileSync(kbPath, "utf-8");
  const data = JSON.parse(raw);

  const errors = [];
  const warnings = [];

  if (!data.metadata?.school_name) errors.push("metadata.school_name wajib");
  if (!data.metadata?.npsn) errors.push("metadata.npsn wajib");
  if (!data.jurusan?.length) errors.push("minimal 1 jurusan");
  if (!data.spmb) errors.push("data spmb wajib");
  if (!data.faq?.length) errors.push("minimal 1 faq");
  if (!data.kontak?.telepon) errors.push("kontak.telepon wajib");
  if (!data.kontak?.email) errors.push("kontak.email wajib");
  if (!data.visi_misi?.visi) warnings.push("visi_misi belum diisi");
  if (!data.seragam?.senin) warnings.push("seragam belum diisi");
  if (!data.jam_sekolah?.senin_kamis) warnings.push("jam_sekolah belum diisi");
  if (!data.mpls?.deskripsi) warnings.push("mpls belum diisi");
  if (!data.alumni?.jumlah_alumni) warnings.push("alumni belum diisi");

  data.jurusan.forEach((j, i) => {
    if (!j.id) warnings.push(`jurusan[${i}]: tidak punya id`);
    if (!j.nama) errors.push(`jurusan[${i}]: nama wajib`);
    if (!j.deskripsi) warnings.push(`jurusan[${i}]: deskripsi kosong`);
  });

  data.faq.forEach((f, i) => {
    if (!f.pertanyaan) errors.push(`faq[${i}]: pertanyaan wajib`);
    if (!f.jawaban) errors.push(`faq[${i}]: jawaban wajib`);
  });

  return { data, errors, warnings };
}

function report() {
  const { data, errors, warnings } = validate();

  console.log(`\n  TRAINING REPORT — SMKN 2 Mataram KB`);
  console.log(`  ───────────────────────────────────`);
  console.log(`  Status   : ${errors.length === 0 ? "✅ VALID" : "❌ INVALID"}`);
  console.log(`  Errors   : ${errors.length}`);
  console.log(`  Warnings : ${warnings.length}`);
  console.log(`  ───────────────────────────────────`);
  console.log(`  Metadata : ${data.metadata?.school_name || "MISSING"}`);
  console.log(`  Jurusan  : ${data.jurusan?.length || 0} jurusan`);
  console.log(`  FAQ      : ${data.faq?.length || 0} pertanyaan`);
  console.log(`  Fasilitas: ${data.fasilitas?.length || 0} items`);
  console.log(`  Ekskul   : ${data.ekstrakurikuler?.length || 0} items`);

  if (errors.length > 0) {
    console.log(`\n  ── ERRORS ──`);
    errors.forEach((e) => console.log(`  ❌ ${e}`));
  }
  if (warnings.length > 0) {
    console.log(`\n  ── WARNINGS ──`);
    warnings.forEach((w) => console.log(`  ⚠️  ${w}`));
  }

  const ctxSize = buildContextSize(data);
  console.log(`\n  Konteks AI: ~${ctxSize} karakter`);
  console.log(`  ───────────────────────────────────\n`);
}

function buildContextSize(data) {
  return JSON.stringify(data).length;
}

report();
