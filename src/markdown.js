/**
 * WhatsApp Markdown Converter
 * 
 * Markdown → WhatsApp format:
 *   **bold**    → *bold*     (WA bold = single asterisk)
 *   *italic*    → _italic_   (WA italic = underscore)
 *   ~~strike~~  → ~strike~   (WA strikethrough = tilde)
 *   `code`      → `code`     (WA monospace = backtick)
 *   ### Header  → *Header*   (bold)
 *   [text](url) → text (url) (plain)
 */

function toWhatsApp(md) {
  if (!md || typeof md !== "string") return "";

  let text = md;

  // Preserve code blocks first
  const codeBlocks = [];
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  });

  const boldParts = [];
  const keepBold = (value) => {
    boldParts.push(String(value).replace(/^[_*\s]+|[_*\s]+$/g, ""));
    return `\x00BOLD${boldParts.length - 1}\x00`;
  };

  // Normalize common model-generated emphasis before conversion.
  text = text.replace(/\*\*\*([^*\n]+?)\*\*\*/g, (_, content) => keepBold(content));
  text = text.replace(/___([^_\n]+?)___/g, (_, content) => keepBold(content));

  // Headers → bold
  text = text.replace(/^#{1,3}\s+(.+)$/gm, (_, content) => keepBold(content));

  // Markdown bullets → WhatsApp-friendly bullets before italic conversion
  text = text.replace(/^(\s*)[*+-]\s+/gm, "$1• ");

  // Bold **text** → WA bold *text*
  text = text.replace(/\*\*(.+?)\*\*/g, (_, content) => keepBold(content));

  // Common AI style: *Label:* should be WhatsApp bold, not italic.
  text = text.replace(/(^|[\s\n])\*([^*\n]{1,40}:)\*/g, (_, prefix, content) => `${prefix}${keepBold(content)}`);

  // Italic *text* → WA italic _text_
  // Avoid list markers and generated WA bold placeholders.
  text = text.replace(/(^|[^\w*])\*([^\s*][^*\n]*?[^\s*])\*(?!\*)/g, "$1_$2_");

  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, "~$1~");

  // Inline code
  text = text.replace(/`([^`]+)`/g, "`$1`");

  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // Remove horizontal rules. They look noisy in WhatsApp.
  text = text.replace(/^\s*[-*_]{3,}\s*$/gm, "");

  // Blockquotes
  text = text.replace(/^>\s+(.+)$/gm, "> $1");

  // Restore generated WA bold
  text = text.replace(/\x00BOLD(\d+)\x00/g, (_, i) => `*${boldParts[parseInt(i)]}*`);

  // Restore code blocks
  text = text.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);

  // Remove Gemini web UI boilerplate that can leak from anonymous scraping.
  text = text.replace(/\n?Untuk membuka fungsionalitas penuh semua Aplikasi, aktifkan Aktivitas Aplikasi Gemini \([^)]*\)\.?/gi, "");
  text = text.replace(/\n?To unlock full functionality for all apps, turn on Gemini Apps Activity \([^)]*\)\.?/gi, "");

  // Keep WhatsApp output ASCII-friendly and avoid awkward long dash rendering.
  text = text.replace(/\s*\u2014\s*/g, " - ");

  // Cleanup: remove excessive blank lines
  text = text.replace(/\n{4,}/g, "\n\n\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/\*{3,}/g, "*");
  text = text.replace(/_{3,}/g, "_");

  return text.trim();
}

/**
 * Split response into "streaming chunks" (sentences)
 */
function splitChunks(text, maxChars = 500) {
  if (!text) return [];

  const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) || [text];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  if (chunks.length === 0) chunks.push(text);
  return chunks;
}

module.exports = { toWhatsApp, splitChunks };
