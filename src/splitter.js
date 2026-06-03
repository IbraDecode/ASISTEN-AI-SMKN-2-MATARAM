/**
 * Message Splitter - potong pesan panjang untuk WhatsApp
 * Batas WhatsApp: 4096 chars per pesan
 */

const MAX_LENGTH = 4000;

function split(text) {
  if (!text || text.length <= MAX_LENGTH) {
    return [text || ""];
  }

  const parts = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      parts.push(remaining);
      break;
    }

    let cutAt = remaining.lastIndexOf("\n\n", MAX_LENGTH);
    if (cutAt === -1 || cutAt < MAX_LENGTH / 2) {
      cutAt = remaining.lastIndexOf("\n", MAX_LENGTH);
    }
    if (cutAt === -1 || cutAt < MAX_LENGTH / 2) {
      cutAt = remaining.lastIndexOf(". ", MAX_LENGTH);
    }
    if (cutAt === -1 || cutAt < MAX_LENGTH / 2) {
      cutAt = remaining.lastIndexOf(" ", MAX_LENGTH);
    }
    if (cutAt === -1 || cutAt < 100) {
      cutAt = MAX_LENGTH;
    }

    const part = remaining.substring(0, cutAt + 1).trim();
    if (part) parts.push(part);
    remaining = remaining.substring(cutAt + 1).trim();
  }

  if (parts.length > 1) {
    for (let i = 0; i < parts.length; i++) {
      parts[i] = `(${i + 1}/${parts.length}) ${parts[i]}`;
    }
  }

  return parts;
}

module.exports = { split };
