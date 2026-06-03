const nodeFetch = require("node-fetch");

class GeminiClient {
  constructor(opts = {}) {
    this.tokens = null;
    this.reqId = 1;
    this.context = "";
    this.conversationId = null;
    this.responseId = null;
    this.lastMeta = null;

    this.timeout = opts.timeout || 15000;
    this.maxRetries = opts.maxRetries || 2;
    this.userAgent =
      opts.userAgent ||
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
  }

  setContext(ctx) {
    this.context = ctx;
  }

  async _fetchTokens() {
    const res = await nodeFetch("https://gemini.google.com/", {
      headers: { "user-agent": this.userAgent },
      timeout: 10000
    });
    const html = await res.text();

    this.tokens = {
      bl: this._extract(html, '"cfb2h":"', '"'),
      fsid: this._extract(html, '"FdrFJe":"', '"')
    };

    return this.tokens;
  }

  _extract(text, prefix, suffix) {
    const idx = text.indexOf(prefix);
    if (idx === -1) return "";
    const start = idx + prefix.length;
    const end = text.indexOf(suffix, start);
    return end === -1 ? "" : text.substring(start, end);
  }

  _buildPayload(msg) {
    const fullMsg = this.context
      ? `${this.context}\n\nPertanyaan: ${msg}\n\nJawablah berdasarkan data di atas. Jika tidak ada informasinya di data, katakan dengan jujur bahwa Anda tidak tahu. Gunakan bahasa Indonesia yang ramah dan informatif.`
      : msg;

    let snapshot = [];
    if (this.conversationId || this.responseId) {
      const convId = Array.isArray(this.conversationId)
        ? this.conversationId[0]
        : this.conversationId;
      const respId = this.responseId;
      const respIdStr = Array.isArray(respId) ? respId[1] || respId[0] : respId;
      snapshot = [[null, null, null, null, null, null, null, null, null, null, convId || null, respId]];
    }

    return [
      null,
      JSON.stringify([[fullMsg, 0, null, null, null, snapshot, 0]])
    ];
  }

  async ask(msg) {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this._askOnce(msg);
      } catch (err) {
        lastError = err;
        const errStr = err.message.toLowerCase();
        if (errStr.includes("token") || errStr.includes("403") || errStr.includes("401") || errStr.includes("refresh")) {
          this.tokens = null;
          if (attempt < this.maxRetries) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
        }
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  _classifyError(err) {
    const msg = err.message.toLowerCase();
    if (msg.includes("abort") || msg.includes("timeout")) return "TIMEOUT";
    if (msg.includes("403") || msg.includes("forbidden")) return "FORBIDDEN";
    if (msg.includes("429") || msg.includes("rate")) return "RATE_LIMIT";
    if (msg.includes("empty") || msg.includes("null")) return "EMPTY_RESPONSE";
    if (msg.includes("evaluate") || msg.includes("syntax") || msg.includes("parse")) return "PARSE_ERROR";
    if (msg.includes("token") || msg.includes("refresh")) return "TOKEN_EXPIRED";
    if (msg.includes("enotfound") || msg.includes("econnrefused") || msg.includes("network")) return "NETWORK";
    return "UNKNOWN";
  }

  async _askOnce(msg) {
    if (!this.tokens || !this.tokens.fsid) await this._fetchTokens();

    const payload = this._buildPayload(msg);
    const params = new URLSearchParams({
      bl: this.tokens.bl || "boq_assistant-bard-web-server_20260602.11_p0",
      "f.sid": this.tokens.fsid,
      hl: "id",
      _reqid: this.reqId++,
      rt: "c"
    });

    const url = `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${params}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await nodeFetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": this.userAgent,
          "x-same-domain": "1",
          origin: "https://gemini.google.com",
          referer: "https://gemini.google.com/"
        },
        body: `f.req=${encodeURIComponent(JSON.stringify(payload))}&at=`
      });

      if (res.status === 403) throw new Error("403_FORBIDDEN");
      if (res.status === 429) throw new Error("429_RATE_LIMITED");
      if (res.status !== 200) throw new Error(`HTTP_${res.status}`);

      const raw = await res.text();
      return this._parse(raw);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  _parse(raw) {
    const lines = raw.split("\n").filter((l) => l.startsWith('[["wrb.fr"'));

    if (lines.length === 0) {
      throw new Error("EMPTY_RESPONSE: no wrb.fr lines found");
    }

    for (const line of lines) {
      try {
        const outer = JSON.parse(line);
        if (!outer?.[0]?.[2]) continue;

        const inner = JSON.parse(outer[0][2]);
        if (!inner?.[4]?.[0]) continue;

        const choice = inner[4][0];

        // Parse responseId — bisa string atau array
        if (inner[0]) {
          this.conversationId = inner[0];
        }
        if (inner[1]) {
          this.responseId = inner[1];
        } else if (Array.isArray(inner[0])) {
          // Fallback: some responses put it in inner[0]
          this.responseId = inner[0];
          this.conversationId = null;
        }

        // Extract text from choice[1]
        const textRaw = choice[1];
        let text = "";
        if (typeof textRaw === "string") {
          text = textRaw;
        } else if (Array.isArray(textRaw) && textRaw.length > 0) {
          text = textRaw[0];
        }

        if (!text || text.trim().length === 0) {
          continue;
        }

        // Extract metadata
        const meta = {};

        // Safety score
        if (Array.isArray(choice[2]) && choice[2][4] && Array.isArray(choice[2][4])) {
          meta.safetyScore = choice[2][4][2];
        }

        // Model version
        if (Array.isArray(choice[8])) {
          meta.modelVersion = choice[8][0];
        }

        // Language
        if (choice[9]) {
          meta.lang = choice[9];
        }

        // Location data (from main array)
        if (inner[5] && Array.isArray(inner[5])) {
          meta.location = {
            country: inner[8] || null,
            description: inner[5][1] || null
          };
        }

        this.lastMeta = meta;

        const result = { text };

        if (meta.safetyScore !== undefined) {
          result.safetyScore = meta.safetyScore;
        }

        return result;
      } catch (e) {
        continue;
      }
    }

    throw new Error("PARSE_ERROR: could not extract text from response");
  }

  getLastMeta() {
    return this.lastMeta;
  }

  reset() {
    this.conversationId = null;
    this.responseId = null;
    this.reqId = 1;
    this.lastMeta = null;
  }
}

module.exports = GeminiClient;
