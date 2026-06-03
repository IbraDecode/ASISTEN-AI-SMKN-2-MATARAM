/**
 * Chat Simulator — test percakapan lengkap via terminal
 * 
 * Jalankan: node tools/chat-simulator.js
 * 
 Fungsi:
  1. Chat seperti WhatsApp langsung dari terminal
  2. Multi-turn (percakapan lanjutan)
  3. Simulasi button clicks
  4. Lihat history percakapan
  5. Lihat response time
  6. Reset sesi
 */

const readline = require("readline");
const nodeFetch = require("node-fetch");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const USER_ID = "sim-" + Date.now().toString(36);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt() {
  rl.question("\n> ", async (input) => {
    const cmd = input.trim();

    if (cmd === "/quit" || cmd === "/exit") {
      console.log("Bye!");
      rl.close();
      return;
    }

    if (cmd === "/reset") {
      console.log("Session reset. Mulai percakapan baru.");
      return prompt();
    }

    if (cmd === "/history") {
      try {
        const res = await nodeFetch(`${BASE}/conversation/${USER_ID}`);
        const data = await res.json();
        console.log(`\n── History (${data.history?.length || 0} messages) ──`);
        if (data.history) {
          for (const h of data.history) {
            const icon = h.role === "user" ? "👤" : h.role === "ai" ? "🤖" : "📖";
            console.log(`  ${icon} ${h.text.substring(0, 200)}`);
          }
        }
        console.log(`── State: ${data.state} | Messages: ${data.messageCount} ──`);
      } catch (err) {
        console.log(`Error: ${err.message}`);
      }
      return prompt();
    }

    if (cmd === "/menu") {
      console.log("\n── Simulator Commands ──");
      console.log("  /reset       Reset session");
      console.log("  /history     Lihat history percakapan");
      console.log("  /quit        Keluar");
      console.log("  /menu        Menu ini");
      console.log("  /button:id   Simulasi klik tombol (contoh: /button:menu_jurusan)");
      console.log("  teks biasa   Kirim pesan biasa");
      console.log("─────────────────────");
      return prompt();
    }

    // Button simulation
    if (cmd.startsWith("/button:")) {
      const buttonId = cmd.replace("/button:", "");
      console.log(`[Simulasi klik tombol: ${buttonId}]`);

      try {
        const res = await nodeFetch(`${BASE}/simulate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: USER_ID,
            name: "Simulator",
            buttonId
          })
        });
        const data = await res.json();
        console.log(`\n🤖 [${data.elapsed_ms}ms]:`);
        if (typeof data.reply === "string") {
          console.log(data.reply);
        } else if (data.reply?.text) {
          console.log(data.reply.text);
        }
      } catch (err) {
        console.log(`Error: ${err.message}`);
      }
      return prompt();
    }

    // Normal message
    try {
      const res = await nodeFetch(`${BASE}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: USER_ID,
          name: "Simulator",
          text: cmd
        })
      });
      const data = await res.json();
      console.log(`\n🤖 [${data.elapsed_ms}ms]:`);
      if (typeof data.reply === "string") {
        console.log(data.reply);
      } else if (data.reply?.text) {
        console.log(data.reply.text);
      }
    } catch (err) {
      console.log(`Error: ${err.message}`);
    }

    prompt();
  });
}

console.log("\n═══════════════════════════════════════");
console.log("  SMKN 2 AI — Chat Simulator");
console.log("═══════════════════════════════════════");
console.log("  User ID :", USER_ID);
console.log("  Server  :", BASE);
console.log("  Ketik /menu untuk bantuan");
console.log("═══════════════════════════════════════");
prompt();
