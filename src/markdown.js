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

  // Headers → bold
  text = text.replace(/^#{1,3}\s+(.+)$/gm, "*$1*");

  // Bold **text** → WA bold *text*
  text = text.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Italic *text* → WA italic _text_
  // (Only if not already WA bold, and single asterisk)
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "_$1_");

  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, "~$1~");

  // Inline code
  text = text.replace(/`([^`]+)`/g, "`$1`");

  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // Horizontal rules
  text = text.replace(/^---+$/gm, "────────────────────");

  // Blockquotes
  text = text.replace(/^>\s+(.+)$/gm, "> $1");

  // Restore code blocks
  text = text.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);

  // Cleanup: remove excessive blank lines
  text = text.replace(/\n{4,}/g, "\n\n\n");

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
