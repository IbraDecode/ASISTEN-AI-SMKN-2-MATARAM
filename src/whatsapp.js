const nodeFetch = require("node-fetch");

const MAX_BUTTONS = 3;
const MAX_TEXT_LENGTH = 4096;

class WhatsAppClient {
  constructor(config) {
    this.phoneNumberId = config.phoneNumberId;
    this.accessToken = config.accessToken;
    this.verifyToken = config.verifyToken;
    this.apiVersion = "v18.0";
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    this.lastSendTime = 0;
    this.minInterval = 200;
    this.conversationCount = 0;
  }

  async _fetch(url, opts, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await nodeFetch(url, { ...opts, signal: controller.signal });
        clearTimeout(timeout);
        if (res.status === 429 && i < retries) {
          await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
          continue;
        }
        return res;
      } catch (err) {
        if (i >= retries) throw err;
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }

  async sendMessage(to, text) {
    await this._rateLimit();

    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "text",
      text: { preview_url: false, body: String(text).substring(0, MAX_TEXT_LENGTH) }
    };

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
  }

  async sendButtonMessage(to, text, buttons) {
    const safeButtons = (buttons || []).slice(0, MAX_BUTTONS);
    if (safeButtons.length === 0) {
      return this.sendMessage(to, text);
    }

    await this._rateLimit();

    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: String(text).substring(0, 1024) },
        action: {
          buttons: safeButtons.map((b, i) => ({
            type: "reply",
            reply: { id: b.id || `btn_${i}`, title: String(b.title).substring(0, 20) }
          }))
        }
      }
    };

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
