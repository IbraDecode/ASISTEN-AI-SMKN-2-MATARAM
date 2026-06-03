/**
 * Streaming — kirim chunk bertahap dengan jeda natural
 * biar dari sisi WhatsApp keliatan kayak ngetik beneran.
 */

class Streamer {
  constructor(whatsappClient) {
    this.wa = whatsappClient;
    this.activeStreams = new Map();
  }

  async stream(userId, chunks, options = {}) {
    const {
      feedbackCallback = null
    } = options;

    if (this.activeStreams.has(userId)) {
      await this.activeStreams.get(userId);
    }

    const streamPromise = this._doStream(userId, chunks, { feedbackCallback });
    this.activeStreams.set(userId, streamPromise);
    try {
      await streamPromise;
    } finally {
      this.activeStreams.delete(userId);
    }
  }

  async _doStream(userId, chunks, { feedbackCallback }) {
    if (!chunks || chunks.length === 0) return;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk.trim()) continue;

      try {
        await this.wa.sendMessage(userId, chunk);
      } catch (err) {
        console.error(`[STREAM ERR] ${userId}: ${err.message}`);
      }

      // Jeda natural antar-chunk: makin panjang teks makin lama jeda
      if (i < chunks.length - 1) {
        const words = chunk.split(/\s+/).length;
        const delay = Math.min(Math.max(words * 100, 400), 2000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    if (feedbackCallback && typeof feedbackCallback === "function") {
      try {
        await feedbackCallback(userId);
      } catch (err) {
        console.error(`[FEEDBACK ERR] ${userId}: ${err.message}`);
      }
    }
  }

  isStreaming(userId) {
    return this.activeStreams.has(userId);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { Streamer, sleep };
