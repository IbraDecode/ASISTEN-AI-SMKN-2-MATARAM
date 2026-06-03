/**
 * Streaming - kirim chunk bertahap dengan jeda natural
 * 
 * - Jeda bervariasi + random jitter biar keliatan natural
 * - Stream berjalan bisa dibatalkan (user kirim pesan baru)
 * - Feedback button dikirim setelah stream selesai
 */

const MIN_CHUNK_DELAY = 300;   // ms
const MAX_CHUNK_DELAY = 2000;  // ms

class Streamer {
  constructor(whatsappClient) {
    this.wa = whatsappClient;
    this.activeControllers = new Map();
  }

  async stream(userId, chunks, options = {}) {
    const { feedbackCallback = null } = options;

    // Batalkan stream sebelumnya jika ada
    const prev = this.activeControllers.get(userId);
    if (prev) {
      prev.cancel();
    }

    const controller = { cancelled: false, cancel: () => { controller.cancelled = true; } };
    this.activeControllers.set(userId, controller);

    const streamPromise = this._doStream(userId, chunks, controller, { feedbackCallback });
    try {
      await streamPromise;
    } finally {
      if (this.activeControllers.get(userId) === controller) {
        this.activeControllers.delete(userId);
      }
    }
  }

  async _doStream(userId, chunks, controller, { feedbackCallback }) {
    if (!chunks || chunks.length === 0) return;

    for (let i = 0; i < chunks.length; i++) {
      if (controller.cancelled) return;

      const chunk = chunks[i];
      if (!chunk.trim()) continue;

      try {
        await this.wa.sendMessage(userId, chunk);
      } catch (err) {
        console.error(`[STREAM ERR] ${userId}: ${err.message}`);
      }

      // Jeda natural antar-chunk
      if (i < chunks.length - 1 && !controller.cancelled) {
        await this._naturalDelay(chunk, i, chunks.length);
      }
    }

    if (controller.cancelled) return;

    // Feedback callback
    if (feedbackCallback && typeof feedbackCallback === "function") {
      try {
        await feedbackCallback(userId);
      } catch (err) {
        console.error(`[FEEDBACK ERR] ${userId}: ${err.message}`);
      }
    }
  }

  /**
   * Hitung jeda natural berdasarkan panjang teks dan posisi chunk.
   * 
   * - Chunk pertama: jeda pendek (biar cepet kelihatan)
   * - Chunk selanjutnya: jeda berdasarkan panjang teks
   * - Random jitter ±40% biar gak robotic
   */
  async _naturalDelay(chunk, index, totalChunks) {
    const chars = chunk.length;

    // Base delay: chunk pertama lebih cepet
    let base;
    if (index === 0) {
      base = Math.min(chars * 3, 600);
    } else {
      base = Math.min(chars * 8, 1800);
    }

    // Minimum delay
    base = Math.max(base, index === 0 ? MIN_CHUNK_DELAY : 500);

    // Random jitter ±40%
    const jitter = base * (0.6 + Math.random() * 0.8);
    const delay = Math.min(jitter, MAX_CHUNK_DELAY);

    await new Promise((r) => setTimeout(r, delay));
  }

  isStreaming(userId) {
    return this.activeControllers.has(userId);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { Streamer, sleep };
