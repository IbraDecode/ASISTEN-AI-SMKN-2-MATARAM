const nodeFetch = require("node-fetch");

const MAX_BUTTONS = 3;
const MAX_TEXT_LENGTH = 4096;

// Deduplication: skip message IDs yg sudah diproses
const processedIds = new Set();
const DEDUP_TTL = 10000;

class WhatsAppClient {
  constructor(config) {
    this.phoneNumberId = config.phoneNumberId;
    this.accessToken = config.accessToken;
    this.verifyToken = config.verifyToken;
    this.apiVersion = "v25.0";
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    this.lastSendTime = 0;
    this.minInterval = 200;
    this.sendQueue = Promise.resolve();
    this.conversationCount = 0;
  }

  // Rate limit mutex — antre semua send biar gak tabrakan
  _enqueue(fn) {
    this.sendQueue = this.sendQueue.then(fn, fn);
    return this.sendQueue;
  }

  async _fetch(url, opts, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await nodeFetch(url, { ...opts, signal: controller.signal });
        clearTimeout(timeout);

        // Retry rate limits + server errors
        if ((res.status === 429 || res.status >= 500) && i < retries) {
          const delay = res.status === 429 ? 2000 : 1000;
          await new Promise((r) => setTimeout(r, delay * (i + 1)));
          continue;
        }
        return res;
      } catch (err) {
        if (i >= retries) throw err;
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }

  // Cek apakah message ID sudah diproses (dedup)
  isDuplicate(msgId) {
    if (!msgId) return false;
    if (processedIds.has(msgId)) return true;
    processedIds.add(msgId);
    // Bersihin cache lama tiap 100 entry
    if (processedIds.size > 1000) {
      setTimeout(() => processedIds.clear(), DEDUP_TTL);
    }
    return false;
  }

  async sendMessage(to, text) {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "text",
      text: { preview_url: true, body: String(text).substring(0, MAX_TEXT_LENGTH) }
    };

    return this._enqueue(async () => {
      await this._rateLimit();
      try {
        const res = await this._fetch(this.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });
        const result = await res.json();
        if (!result.error) this.conversationCount++;
        return result;
      } catch (err) {
        console.error(`[WA SEND FAIL] ${to}: ${err.message}`);
        return { error: { message: err.message } };
      }
    });
  }

  async sendButtonMessage(to, text, buttons, opts = {}) {
    const safeButtons = (buttons || []).slice(0, MAX_BUTTONS);
    if (safeButtons.length === 0) {
      return this.sendMessage(to, text);
    }

    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "interactive",
      interactive: {
        type: "button",
        header: opts.header ? { type: "text", text: String(opts.header).substring(0, 60) } : undefined,
        body: { text: String(text).substring(0, 1024) },
        footer: opts.footer ? { text: String(opts.footer).substring(0, 60) } : undefined,
        action: {
          buttons: safeButtons.map((b, i) => ({
            type: "reply",
            reply: { id: b.id || `btn_${i}`, title: String(b.title).substring(0, 20) }
          }))
        }
      }
    };

    return this._enqueue(async () => {
      await this._rateLimit();
      try {
        const res = await this._fetch(this.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });
        const result = await res.json();
        if (!result.error) this.conversationCount++;
        return result;
      } catch (err) {
        console.error(`[WA BUTTON FAIL] ${to}: ${err.message}`);
        return { error: { message: err.message } };
      }
    });
  }

  async sendListMessage(to, text, buttonLabel, sections, opts = {}) {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "interactive",
      interactive: {
        type: "list",
        header: opts.header ? { type: "text", text: String(opts.header).substring(0, 60) } : undefined,
        body: { text: String(text).substring(0, 1024) },
        footer: opts.footer ? { text: String(opts.footer).substring(0, 60) } : undefined,
        action: {
          button: String(buttonLabel).substring(0, 20),
          sections: (sections || []).slice(0, 10)
        }
      }
    };

    return this._enqueue(async () => {
      await this._rateLimit();
      try {
        const res = await this._fetch(this.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });
        const result = await res.json();
        if (!result.error) this.conversationCount++;
        return result;
      } catch (err) {
        console.error(`[WA LIST FAIL] ${to}: ${err.message}`);
        return { error: { message: err.message } };
      }
    });
  }

  async markAsRead(to, messageId) {
    try {
      await this._fetch(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId
        })
      });
    } catch (err) {
      console.error(`[WA MARKREAD FAIL] ${to}: ${err.message}`);
    }
  }

  async sendLocation(to, lat, lng, name, address) {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "location",
      location: {
        longitude: lng,
        latitude: lat,
        name: String(name || "").substring(0, 100),
        address: String(address || "").substring(0, 256)
      }
    };

    return this._enqueue(async () => {
      await this._rateLimit();
      try {
        const res = await this._fetch(this.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });
        const result = await res.json();
        if (!result.error) this.conversationCount++;
        return result;
      } catch (err) {
        console.error(`[WA LOC FAIL] ${to}: ${err.message}`);
        return { error: { message: err.message } };
      }
    });
  }

  async sendCTAButton(to, text, url, buttonLabel, opts = {}) {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "interactive",
      interactive: {
        type: "cta_url",
        header: opts.header ? { type: "text", text: String(opts.header).substring(0, 60) } : undefined,
        body: { text: String(text).substring(0, 1024) },
        footer: opts.footer ? { text: String(opts.footer).substring(0, 60) } : undefined,
        action: {
          name: "cta_url",
          parameters: {
            display_text: String(buttonLabel || "Open Link").substring(0, 20),
            url: String(url).substring(0, 2000)
          }
        }
      }
    };

    return this._enqueue(async () => {
      await this._rateLimit();
      try {
        const res = await this._fetch(this.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });
        const result = await res.json();
        if (!result.error) this.conversationCount++;
        return result;
      } catch (err) {
        console.error(`[WA CTA FAIL] ${to}: ${err.message}`);
        return { error: { message: err.message } };
      }
    });
  }

  async sendLocationRequest(to, text) {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "interactive",
      interactive: {
        type: "location_request_message",
        body: { text: String(text || "📍 Share your location").substring(0, 1024) },
        action: { name: "send_location" }
      }
    };

    return this._enqueue(async () => {
      await this._rateLimit();
      try {
        const res = await this._fetch(this.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });
        const result = await res.json();
        if (!result.error) this.conversationCount++;
        return result;
      } catch (err) {
        console.error(`[WA LOCREQ FAIL] ${to}: ${err.message}`);
        return { error: { message: err.message } };
      }
    });
  }

  async sendImage(to, url, caption) {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "image",
      image: {
        link: String(url).substring(0, 2048),
        caption: String(caption || "").substring(0, 1024)
      }
    };

    return this._enqueue(async () => {
      await this._rateLimit();
      try {
        const res = await this._fetch(this.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });
        const result = await res.json();
        if (!result.error) this.conversationCount++;
        return result;
      } catch (err) {
        console.error(`[WA IMG FAIL] ${to}: ${err.message}`);
        return { error: { message: err.message } };
      }
    });
  }

  async sendReaction(to, messageId, emoji) {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "reaction",
      reaction: {
        message_id: messageId,
        emoji: String(emoji || "👍").substring(0, 1)
      }
    };

    return this._enqueue(async () => {
      await this._rateLimit();
      try {
        const res = await this._fetch(this.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });
        return await res.json();
      } catch (err) {
        console.error(`[WA REACT FAIL] ${to}: ${err.message}`);
        return { error: { message: err.message } };
      }
    });
  }

  async _rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastSendTime;
    if (elapsed < this.minInterval) {
      await new Promise((r) => setTimeout(r, this.minInterval - elapsed));
    }
    this.lastSendTime = Date.now();
  }

  verifyWebhook(mode, token, challenge) {
    if (mode === "subscribe" && token === this.verifyToken) {
      return challenge;
    }
    return null;
  }

  parseIncoming(body) {
    if (!body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      return null;
    }

    try {
      const entry = body.entry[0].changes[0].value;
      const msg = entry.messages[0];

      const base = {
        from: msg.from,
        msgId: msg.id,
        timestamp: msg.timestamp,
        name: entry.contacts?.[0]?.profile?.name || "User",
        type: msg.type
      };

      // Dedup
      if (this.isDuplicate(msg.id)) {
        console.log(`[DEDUP] ${msg.id}`);
        return null;
      }

      if (msg.type === "text" && msg.text?.body) {
        return { ...base, text: msg.text.body };
      }

      if (msg.type === "interactive" && msg.interactive?.button_reply) {
        return {
          ...base,
          text: msg.interactive.button_reply.title,
          buttonId: msg.interactive.button_reply.id,
          isButton: true
        };
      }

      if (msg.type === "interactive" && msg.interactive?.list_reply) {
        return {
          ...base,
          text: msg.interactive.list_reply.title,
          buttonId: msg.interactive.list_reply.id,
          isButton: true
        };
      }

      if (msg.type === "interactive" && msg.interactive?.cta_url) {
        return {
          ...base,
          text: msg.interactive.cta_url.display_text || (msg.text?.body || ""),
          buttonId: "cta_url_clicked"
        };
      }

      return { ...base, text: "" };
    } catch (e) {
      console.error("[WA PARSE]", e.message);
      return null;
    }
  }

  getConversationCount() {
    return this.conversationCount;
  }
}

module.exports = WhatsAppClient;
