/**
 * Menu Builder — Welcome Message + Interactive Buttons
 */

function welcomeButtons(name) {
  return {
    text: `Halo ${name} 👋\n\nSelamat datang di *Asisten AI SMKN 2 Mataram*.\nSaya siap bantu kamu menjawab pertanyaan seputar:\n\n📚 Informasi Jurusan\n📋 Syarat & Jadwal SPMB\n📞 Kontak Sekolah\n🏫 Fasilitas & Ekskul\n💼 Prospek Kerja Lulusan\n\nSilakan pilih menu di bawah atau ketik pertanyaan langsung:`,
    buttons: [
      { id: "menu_jurusan", title: "📚 Jurusan" },
      { id: "menu_spmb", title: "📋 SPMB" },
      { id: "menu_kontak", title: "📞 Kontak" }
    ]
  };
}

function jurusanButtons() {
  return {
    text: "Pilih jurusan yang ingin kamu ketahui:",
    buttons: [
      { id: "jurusan_akl", title: "AKL" },
      { id: "jurusan_rpl", title: "RPL" },
      { id: "jurusan_tkj", title: "TKJ" },
      { id: "jurusan_dkv", title: "DKV" },
      { id: "jurusan_lainya", title: "Lainnya" }
    ]
  };
}

function nextButtons() {
  return {
    text: "Ada lagi yang bisa saya bantu?",
    buttons: [
      { id: "menu_kembali", title: "🔙 Kembali" },
      { id: "menu_jurusan", title: "📚 Jurusan" },
      { id: "menu_spmb", title: "📋 SPMB" }
    ]
  };
}

function handler(actionId, kb) {
  const d = kb.data;
  if (!d) return null;

  switch (actionId) {
    case "menu_jurusan":
      return {
        text: `📚 *Jurusan SMKN 2 Mataram*\n\nSMKN 2 memiliki ${d.jurusan.length} kompetensi keahlian:\n\n${d.jurusan.map((j, i) => `${i + 1}. *${j.nama}* (${j.singkatan})`).join("\n")}\n\nKetik nama jurusan untuk info lengkap, atau pilih di bawah:`,
        buttons: jurusanButtons().buttons
      };

    case "menu_spmb":
      return {
        text: `📋 *SPMB SMKN 2 Mataram*\n\n*Jalur Pendaftaran:*\n${d.spmb.jalur_pendaftaran.map((j) => `• ${j.nama}: ${j.keterangan}`).join("\n")}\n\n*Persyaratan:*\n${d.spmb.persyaratan_umum.map((p) => `• ${p}`).join("\n")}\n\n*Tahapan Seleksi:*\n${d.spmb.tahapan.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nPendaftaran biasanya dibuka April-Mei. Pantau website ${d.kontak.website} untuk info terbaru.`,
        buttons: [{ id: "menu_kembali", title: "🔙 Kembali" }]
      };

    case "menu_kontak":
      return {
        text: `📞 *Kontak SMKN 2 Mataram*\n\n📍 ${d.kontak.alamat}\n📞 ${d.kontak.telepon}\n📧 ${d.kontak.email}\n🌐 ${d.kontak.website}\n\n⏰ Jam Kerja: ${d.kontak.jam_kerja}`,
        buttons: [{ id: "menu_kembali", title: "🔙 Kembali" }]
      };

    case "menu_kembali":
      return {
        text: "Kembali ke menu utama. Ada yang bisa saya bantu?",
        buttons: [
          { id: "menu_jurusan", title: "📚 Jurusan" },
          { id: "menu_spmb", title: "📋 SPMB" },
          { id: "menu_kontak", title: "📞 Kontak" }
        ]
      };

    case "menu_lanjut":
      return nextButtons();

    default:
      if (actionId.startsWith("jurusan_")) {
        const jId = actionId.replace("jurusan_", "");
        const jurusan = d.jurusan.find(
          (j) => j.singkatan.toLowerCase() === jId || j.id === jId
        );
        if (jurusan) {
          return {
            text: `📚 *${jurusan.nama} (${jurusan.singkatan})*\n\n${jurusan.deskripsi}\n\n💼 *Prospek Kerja:*\n${jurusan.prospek_kerja.map((p) => `• ${p}`).join("\n")}`,
            buttons: [
              { id: "menu_jurusan", title: "🔙 Daftar Jurusan" },
              { id: "menu_kembali", title: "🔙 Menu Utama" }
            ]
          };
        }
      }

      if (actionId === "jurusan_lainya") {
        const lain = d.jurusan.slice(5);
        return {
          text: `Jurusan lainnya:\n\n${lain.map((j, i) => `${i + 1}. *${j.nama}* (${j.singkatan})`).join("\n")}\n\nKetik nama jurusan untuk detail.`,
          buttons: [{ id: "menu_jurusan", title: "🔙 Kembali" }]
        };
      }

      return null;
  }
}

module.exports = { welcomeButtons, jurusanButtons, nextButtons, handler };
