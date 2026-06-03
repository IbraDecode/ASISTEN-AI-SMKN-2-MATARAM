/**
 * Streaming Response Simulator
 * 
 * Mengirim jawaban AI dalam beberapa bagian dengan delay
 * untuk mensimulasikan efek "mengetik" seperti ChatGPT.
 * 
 * Cara kerja:
 *   1. Split jawaban jadi beberapa chunk
 *   2. Kirim chunk 1 → wait 2 detik → kirim chunk 2 → ...
 *   3. Setelah selesai, kirim feedback buttons
 */

const MIN_DELAY = 1000;
const MAX_DELAY = 3000;
const CHARS_PER_SECOND = 25;

class Streamer {
  constructor(whatsappClient) {
    this.wa = whatsappClient;
    this.activeStreams = new Map();
  }

  async stream(userId, chunks, options = {}) {
    const {
      feedbackCallback = null,
      minDelay = MIN_DELAY,
      maxDelay = MAX_DELAY,
      charsPerSecond = CHARS_PER_SECOND
    } = options;

    if (this.activeStreams.has(userId)) {
      // Already streaming to this user, wait
      await this.activeStreams.get(userId);
    }

    const streamPromise = this._doStream(userId, chunks, { minDelay, maxDelay, charsPerSecond, feedbackCallback });
    this.activeStreams.set(userId, streamPromise);
    await streamPromise;
    this.activeStreams.delete(userId);
  }

  async _doStream(userId, chunks, { minDelay, maxDelay, charsPerSecond, feedbackCallback }) {
    if (!chunks || chunks.length === 0) return;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk.trim()) continue;

      const prefix = chunks.length > 1 ? `(${i + 1}/${chunks.length}) ` : "";
      const message = prefix + chunk;

      try {
        await this.wa.sendMessage(userId, message);
      } catch (err) {
        console.error(`[STREAM ERR] ${userId}: ${err.message}`);
      }

      // Delay between chunks (simulate typing)
      if (i < chunks.length - 1) {
        const charDelay = Math.min(Math.max(chunk.length / charsPerSecond * 1000, minDelay), maxDelay);
        await sleep(charDelay);
      }
    }

    // Send feedback buttons after all chunks
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
