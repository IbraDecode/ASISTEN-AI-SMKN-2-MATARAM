const nodeFetch = require("node-fetch");
const crypto = require("crypto");

// ─── Model IDs (dari reverse engineering gemini.google.com) ───
// Sumber: g4f (xtekky/gpt4free) + HanaokaYuzu/Gemini-API - June 2026
const MODELS = {
  FLASH:        "9ec249fc9ad08861",  // gemini-2.5-flash
  PRO:          "61530e79959ab139",  // gemini-2.5-pro
  THINKING:     "9c17b1863f581b8a",  // gemini-2.5-flash-thinking
  PRO_EXP:      "2525e3954d185b3c",  // gemini-2.5-pro-exp
  FLASH_EXP:    "35609594dbe934d8",  // gemini-2.5-flash-exp
  DEEP_SEARCH:  "cd472a54d2abba7e",  // gemini-deep-research
  GEMINI_3_PRO: "9d8ca3786ebdfbea",  // gemini-3-pro
  GEMINI_20:    "f299729663a2343f",  // gemini-2.0-flash
};
const MODEL_HEADER_KEY = "x-goog-ext-525001261-jspb";
function buildModelHeader(modelId, isPro = false) {
  // Pro/3-series: format berbeda dari Flash
  if (isPro) {
    return JSON.stringify([1,null,null,null,modelId,null,null,0,[4]]);
  }
  return JSON.stringify([1,null,null,null,modelId,null,null,0,[4],null,null,2]);
}

// ─── Global state ───
const tokenCache = { tokens: null, cookies: null, lastFetch: 0, ttl: 5 * 60 * 1000 };
const tokenLock = { promise: null };
const circuitState = { failures: 0, lastFail: 0, threshold: 5, cooldown: 60 * 1000 };
const FETCH_URLS = ["https://gemini.google.com/", "https://gemini.google.com/app", "https://bard.google.com/"];
const urlHealth = {};

const USER_AGENTS = [
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
];
let uaIndex = 0;

// Metrics
const metrics = { tokenFetches: 0, tokenFailures: 0, apiCalls: 0, apiSuccess: 0, apiFailures: 0, urlStats: {} };
for (const u of FETCH_URLS) metrics.urlStats[u] = { ok: 0, fail: 0, lastUsed: null };

const SAFETY_BLOCK_PHRASES = [
  "content policy", "safety guidelines", "inappropriate",
  "tidak pantas", "dilarang", "violation",
  "tidak dapat merespons", "tidak dapat membantu",
  "can't respond to that", "cannot respond to that",
  "I can't answer", "I cannot answer"
];

class GeminiClient {
  constructor(opts = {}) {
    this.reqId = 1;
    this.context = "";
    this.conversationId = null;
    this.responseId = null;
    this.lastMeta = null;

    this.timeout = opts.timeout || 6000;
    this.maxRetries = opts.maxRetries || 1;
    this.userAgent = opts.userAgent || USER_AGENTS[uaIndex++ % USER_AGENTS.length];

    // Model selection
    const modelName = (opts.model || "flash").toLowerCase();
    this._setModelByName(modelName);
  }

  _setModelByName(name) {
    const key = name.toUpperCase();
    if (MODELS[key]) {
      this.modelId = MODELS[key];
      const isPro = key.includes("PRO") || key.includes("GEMINI_3");
      this.modelHeader = buildModelHeader(this.modelId, isPro);
    } else {
      this.modelId = MODELS.FLASH;
      this.modelHeader = buildModelHeader(MODELS.FLASH);
    }
  }

  setModel(name) {
    this._setModelByName(name);
  }

  setContext(ctx) {
    this.context = ctx;
  }

  async _fetchTokens() {
    const now = Date.now();
    if (tokenCache.tokens && (now - tokenCache.lastFetch) < tokenCache.ttl) {
      return { ...tokenCache.tokens, cookies: tokenCache.cookies };
    }

    // Mutex: jika ada yang sedang fetch, tunggu hasilnya
    if (tokenLock.promise) {
      await tokenLock.promise;
      if (tokenCache.tokens && (Date.now() - tokenCache.lastFetch) < tokenCache.ttl) {
        return { ...tokenCache.tokens, cookies: tokenCache.cookies };
      }
    }

    tokenLock.promise = this._doFetchTokens();
    try {
      const result = await tokenLock.promise;
      return result;
    } finally {
      tokenLock.promise = null;
    }
  }

  async _doFetchTokens() {
    metrics.tokenFetches++;

    for (const url of FETCH_URLS) {
      // Skip URL yang sedang dalam cooldown
      const uh = urlHealth[url];
      if (uh && (Date.now() - uh.lastFail) < uh.cooldown) continue;

      try {
        const res = await nodeFetch(url, {
          headers: { "user-agent": this.userAgent },
          signal: AbortSignal.timeout(5500),
          redirect: "follow"
        });
        const html = await res.text();
        const cookies = (res.headers.raw()["set-cookie"] || []).join("; ");

        const bl = this._regexExtract(html, /"cfb2h"[^:]*:\s*"([^"]+)"/)
          || this._extract(html, '"cfb2h":"', '"')
          || this._extract(html, "cfb2h", "=")
          || "boq_assistant-bard-web-server_20260602.11_p0";

        const fsid = this._regexExtract(html, /"FdrFJe"[^:]*:\s*"([^"]+)"/)
          || this._extract(html, '"FdrFJe":"', '"')
          || this._extract(html, "FdrFJe", '"');

        // SNlM0e dihapus Google sejak April 2026 - optional
        const at = this._regexExtract(html, /"SNlM0e"[^:]*:\s*"([^"]+)"/)
          || this._extract(html, '"SNlM0e":"', '"')
          || "";

        // Token tambahan untuk future-proofing
        const lang = this._regexExtract(html, /"TuX5cc"[^:]*:\s*"([^"]+)"/) || "";
        const pushId = this._regexExtract(html, /"qKIAYe"[^:]*:\s*"([^"]+)"/) || "";

        tokenCache.tokens = { bl, fsid, at, lang, pushId };
        tokenCache.cookies = cookies;
        tokenCache.lastFetch = Date.now();

        // Reset health untuk URL berhasil
        delete urlHealth[url];
        metrics.urlStats[url].ok++;
        metrics.urlStats[url].lastUsed = Date.now();

        return { ...tokenCache.tokens, cookies };
      } catch (err) {
        // Catat kegagalan per URL
        if (!urlHealth[url]) urlHealth[url] = { failCount: 0, lastFail: 0, cooldown: 30000 };
        urlHealth[url].failCount++;
        urlHealth[url].lastFail = Date.now();
        urlHealth[url].cooldown = Math.min(300000, urlHealth[url].cooldown * 2 || 30000);
        metrics.urlStats[url].fail++;
        continue;
      }
    }

    metrics.tokenFailures++;
    throw new Error("TOKEN_FETCH_FAIL: semua URL gagal");
  }

  _regexExtract(text, regex) {
    const m = text.match(regex);
    return m ? m[1] : "";
  }

  _extract(text, prefix, suffix) {
    const idx = text.indexOf(prefix);
    if (idx === -1) return "";
    const start = idx + prefix.length;
    const end = text.indexOf(suffix, start);
    return end === -1 ? "" : text.substring(start, end);
  }

  _isCircuitOpen() {
    const now = Date.now();
    if (circuitState.failures >= circuitState.threshold) {
      if ((now - circuitState.lastFail) < circuitState.cooldown) return true;
      circuitState.failures = 0;
    }
    return false;
  }

  _isSafetyBlocked(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return SAFETY_BLOCK_PHRASES.some(p => lower.includes(p));
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

    // Structured payload matching Gemini's internal format
    // Field [79] = model selector
    const inner = new Array(80).fill(null);
    inner[0] = [fullMsg, 0, null, null, null, snapshot, 0];
    inner[1] = ["id"];
    inner[2] = ["", "", "", null, null, null, null, null, null, ""];
    inner[6] = [0];
    inner[7] = 1;
    inner[10] = 1;
    inner[11] = 0;
    inner[17] = [[0]];  // [think_mode] - 0 = off
    inner[18] = 0;
    inner[27] = 1;
    inner[30] = [4];
    inner[41] = [2];
    inner[53] = 0;
    inner[59] = crypto.randomUUID();
    inner[61] = [];
    inner[68] = 1;
    inner[79] = this.modelId;

    return [null, JSON.stringify(inner)];
  }

  async ask(msg) {
    if (this._isCircuitOpen()) {
      throw new Error("Gemini circuit breaker open - too many failures");
    }

    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this._askOnce(msg);
        circuitState.failures = 0;

        if (result.safetyBlocked) {
          throw new Error("SAFETY_BLOCK: Gemini menolak menjawab");
        }
        if (result.text && this._isSafetyBlocked(result.text)) {
          throw new Error("SAFETY_BLOCK: response mengandung block phrase");
        }

        metrics.apiSuccess++;
        return result;
      } catch (err) {
        lastError = err;
        circuitState.failures++;
        circuitState.lastFail = Date.now();
        metrics.apiFailures++;

        const errStr = err.message.toLowerCase();
        if (errStr.includes("token") || errStr.includes("403") || errStr.includes("401") || errStr.includes("refresh")) {
          tokenCache.tokens = null;
          tokenCache.cookies = null;
          tokenCache.lastFetch = 0;
          if (attempt < this.maxRetries) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
        }
        if (errStr.includes("safety")) {
          // Safety block - tidak usah retry
          break;
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
    if (msg.includes("safety")) return "SAFETY_BLOCK";
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
    if (!tokenCache.tokens || !tokenCache.tokens.fsid || !tokenCache.tokens.bl) {
      await this._fetchTokens();
    }

    metrics.apiCalls++;

    const payload = this._buildPayload(msg);
    const params = new URLSearchParams({
      bl: tokenCache.tokens.bl,
      "f.sid": tokenCache.tokens.fsid,
      hl: "id",
      _reqid: this.reqId++,
      rt: "c"
    });

    const url = `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${params}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers = {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": this.userAgent,
        "x-same-domain": "1",
        origin: "https://gemini.google.com",
        referer: "https://gemini.google.com/",
        accept: "*/*",
        "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        [MODEL_HEADER_KEY]: this.modelHeader
      };

      if (tokenCache.cookies) headers.cookie = tokenCache.cookies;

      const atParam = tokenCache.tokens.at || "";

      const res = await nodeFetch(url, {
        method: "POST",
        signal: controller.signal,
        headers,
        body: `f.req=${encodeURIComponent(JSON.stringify(payload))}&at=${encodeURIComponent(atParam)}`
      });

      if (res.status === 403) throw new Error("403_FORBIDDEN");
      if (res.status === 429) throw new Error("429_RATE_LIMITED");
      if (res.status !== 200) throw new Error(`HTTP_${res.status}`);

      // Baca response sebagai stream biar first word < 2 detik
      const raw = await this._readStreamBody(res.body);
      return this._parse(raw);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Streaming version: callback on each chunk as it arrives
  async askStream(msg, onChunk) {
    if (!tokenCache.tokens || !tokenCache.tokens.fsid || !tokenCache.tokens.bl) {
      await this._fetchTokens();
    }

    metrics.apiCalls++;

    const payload = this._buildPayload(msg);
    const params = new URLSearchParams({
      bl: tokenCache.tokens.bl,
      "f.sid": tokenCache.tokens.fsid,
      hl: "id",
      _reqid: this.reqId++,
      rt: "c"
    });

    const url = `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${params}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers = {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": this.userAgent,
        "x-same-domain": "1",
        origin: "https://gemini.google.com",
        referer: "https://gemini.google.com/",
        accept: "*/*",
        "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        [MODEL_HEADER_KEY]: this.modelHeader
      };

      if (tokenCache.cookies) headers.cookie = tokenCache.cookies;

      const atParam = tokenCache.tokens.at || "";

      const res = await nodeFetch(url, {
        method: "POST",
        signal: controller.signal,
        headers,
        body: `f.req=${encodeURIComponent(JSON.stringify(payload))}&at=${encodeURIComponent(atParam)}`
      });

      if (res.status === 403) throw new Error("403_FORBIDDEN");
      if (res.status === 429) throw new Error("429_RATE_LIMITED");
      if (res.status !== 200) throw new Error(`HTTP_${res.status}`);

      // Stream parsing - process chunks as they arrive
      return await this._parseStream(res.body, onChunk);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  _readStreamBody(body) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      body.on("data", (chunk) => chunks.push(chunk));
      body.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      body.on("error", reject);
    });
  }

  async _parseStream(body, onChunk) {
    let buffer = "";
    let prevText = "";
    let result = null;

    const self = this;

    return new Promise((resolve, reject) => {
      body.on("data", (chunk) => {
        buffer += chunk.toString("utf-8");

        // Process all complete lines in buffer
        let newlineIdx;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.substring(0, newlineIdx);
          buffer = buffer.substring(newlineIdx + 1);

          if (!line.startsWith('[["wrb.fr"')) continue;

          try {
            const parsed = self._parseLine(line);
            if (!parsed) continue;

            if (parsed.text && parsed.text.length > prevText.length) {
              const delta = parsed.text.substring(prevText.length);
              prevText = parsed.text;

              if (onChunk && typeof onChunk === "function") {
                onChunk(delta, parsed.text);
              }
            }

            // Simpan result final (last/complete line)
            result = parsed;
          } catch (e) {
            // skip invalid lines
          }
        }
      });

      body.on("end", () => {
        if (result) {
          // Apply conversation state
          if (result.inner?.[0]) {
            self.conversationId = result.inner[0];
          }
          if (result.inner?.[1]) {
            self.responseId = result.inner[1];
          } else if (Array.isArray(result.inner?.[0])) {
            self.responseId = result.inner[0];
            self.conversationId = null;
          }
          self.lastMeta = result.meta;

          const finalResult = { text: result.text.trim(), safetyBlocked: false };
          if (result.meta?.safetyScore !== undefined) finalResult.safetyScore = result.meta.safetyScore;
          if (result.meta?.modelVersion) finalResult.modelVersion = result.meta.modelVersion;

          resolve(finalResult);
        } else {
          reject(new Error("EMPTY_RESPONSE: no wrb.fr lines in stream"));
        }
      });

      body.on("error", reject);
    });
  }

  _parseLine(line) {
    try {
      const outer = JSON.parse(line);
      if (!outer?.[0]?.[2]) return null;

      const inner = JSON.parse(outer[0][2]);
      if (!inner?.[4]?.[0]) return null;

      const choice = inner[4][0];

      const textRaw = choice[1];
      let text = "";
      if (typeof textRaw === "string") {
        text = textRaw;
      } else if (Array.isArray(textRaw) && textRaw.length > 0) {
        text = textRaw[0];
      }

      if (!text || text.trim().length === 0) return null;

      const meta = {};
      if (Array.isArray(choice[2]) && choice[2][4] && Array.isArray(choice[2][4])) {
        meta.safetyScore = choice[2][4][2];
      }
      if (Array.isArray(choice[8])) {
        meta.modelVersion = choice[8][0];
      }
      if (choice[9]) {
        meta.lang = choice[9];
      }

      return { text: text.trim(), inner, choice, meta };
    } catch (e) {
      return null;
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

        if (inner[0]) {
          this.conversationId = inner[0];
        }
        if (inner[1]) {
          this.responseId = inner[1];
        } else if (Array.isArray(inner[0])) {
          this.responseId = inner[0];
          this.conversationId = null;
        }

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

        // Safety score hanya untuk monitoring, bukan buat blocking
        // (nilai raw dari response tidak selalu akurat buat deteksi)

        this.lastMeta = meta;

        const result = { text: text.trim(), safetyBlocked: false };

        if (meta.safetyScore !== undefined) {
          result.safetyScore = meta.safetyScore;
        }

        if (meta.modelVersion) {
          result.modelVersion = meta.modelVersion;
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

  static getCircuitState() {
    return {
      open: circuitState.failures >= circuitState.threshold,
      failures: circuitState.failures,
      threshold: circuitState.threshold,
      cooldownRemaining: circuitState.lastFail ? Math.max(0, circuitState.cooldown - (Date.now() - circuitState.lastFail)) : 0
    };
  }

  static resetCircuit() {
    circuitState.failures = 0;
    circuitState.lastFail = 0;
  }

  static getMetrics() {
    const now = Date.now();
    const urlStates = {};
    for (const u of FETCH_URLS) {
      const uh = urlHealth[u];
      urlStates[u] = {
        healthy: !uh || (now - uh.lastFail) > uh.cooldown,
        coolDownRemaining: uh ? Math.max(0, uh.cooldown - (now - uh.lastFail)) : 0,
        ...metrics.urlStats[u]
      };
    }
    return {
      tokenFetches: metrics.tokenFetches,
      tokenFailures: metrics.tokenFailures,
      apiCalls: metrics.apiCalls,
      apiSuccess: metrics.apiSuccess,
      apiFailures: metrics.apiFailures,
      successRate: metrics.apiCalls > 0 ? (metrics.apiSuccess / metrics.apiCalls * 100).toFixed(1) + "%" : "0%",
      urls: urlStates
    };
  }
}

module.exports = GeminiClient;
module.exports.MODELS = MODELS;
