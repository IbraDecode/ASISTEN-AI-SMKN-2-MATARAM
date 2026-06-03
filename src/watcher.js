/**
 * File Watcher — auto-reload KB saat file berubah
 */

const fs = require("fs");
const path = require("path");

function watchKb(kb, onReload) {
  const kbPath = path.join(__dirname, "..", "data", "kb.json");

  if (!fs.existsSync(kbPath)) {
    console.log("[WATCH] kb.json tidak ditemukan, watch skipped");
    return null;
  }

  let debounceTimer = null;

  const watcher = fs.watch(kbPath, (eventType) => {
    if (eventType !== "change") return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        kb.load();
        console.log(`[WATCH] KB reloaded at ${new Date().toLocaleTimeString()}`);
        if (onReload) onReload();
      } catch (err) {
        console.error(`[WATCH] KB reload failed: ${err.message}`);
      }
    }, 500);
  });

  console.log("[WATCH] Watching kb.json for changes...");
  return watcher;
}

module.exports = { watchKb };
