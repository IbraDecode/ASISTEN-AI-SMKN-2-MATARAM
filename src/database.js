const Database = require("better-sqlite3");
const path = require("path");

class AppDatabase {
  constructor(dbPath) {
    this.db = new Database(dbPath || path.join(__dirname, "..", "data", "smkn2.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        user_id TEXT PRIMARY KEY,
        state TEXT DEFAULT 'MENU',
        language TEXT DEFAULT 'id',
        message_count INTEGER DEFAULT 0,
        history TEXT DEFAULT '[]',
        first_seen TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        user_name TEXT DEFAULT '',
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT DEFAULT '',
        topic TEXT DEFAULT '',
        language TEXT DEFAULT 'id',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        message_id INTEGER,
        rating TEXT NOT NULL CHECK(rating IN ('up','down')),
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS unanswered (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        question TEXT NOT NULL,
        reason TEXT DEFAULT '',
        answered INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  // ─── Sessions ───

  getSession(userId) {
    const row = this.db.prepare("SELECT * FROM sessions WHERE user_id = ?").get(userId);
    if (!row) return null;
    row.history = JSON.parse(row.history || "[]");
    return row;
  }

  createSession(userId) {
    this.db.prepare(`
      INSERT OR IGNORE INTO sessions (user_id, state, language, history)
      VALUES (?, 'MENU', 'id', '[]')
    `).run(userId);
    return this.getSession(userId);
  }

  updateSession(userId, data) {
    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(data)) {
      if (["state", "language", "message_count"].includes(key)) {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }
    if (data.history) {
      fields.push("history = ?");
      values.push(JSON.stringify(data.history));
    }
    fields.push("updated_at = datetime('now')");
    values.push(userId);
    this.db.prepare(`UPDATE sessions SET ${fields.join(", ")} WHERE user_id = ?`).run(...values);
  }

  getOrCreateSession(userId) {
    return this.getSession(userId) || this.createSession(userId);
  }

  cleanupSessions(maxAgeMinutes = 60) {
    this.db.prepare(`
      DELETE FROM sessions WHERE updated_at < datetime('now', '-${maxAgeMinutes} minutes')
    `).run();
    this.db.prepare(`
      DELETE FROM messages WHERE created_at < datetime('now', '-7 days')
    `).run();
  }

  getAllSessions() {
    return this.db.prepare("SELECT user_id, state, language, message_count, updated_at FROM sessions ORDER BY updated_at DESC").all();
  }

  // ─── Messages ───

  saveMessage(userId, userName, role, content, source = "", topic = "", lang = "id") {
    this.db.prepare(`
      INSERT INTO messages (user_id, user_name, role, content, source, topic, language)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, userName, role, content, source, topic, lang);
    return this.db.prepare("SELECT last_insert_rowid() as id").get().id;
  }

  getMessages(userId, limit = 50) {
    return this.db.prepare(`
      SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(userId, limit).reverse();
  }

  getRecentMessages(limit = 20) {
    return this.db.prepare(`
      SELECT * FROM messages ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  }

  getConversationContext(userId, limit = 6) {
    return this.db.prepare(`
      SELECT role, content FROM messages
      WHERE user_id = ? ORDER BY created_at ASC LIMIT ?
    `).all(userId, limit);
  }

  // ─── Feedback ───

  saveFeedback(userId, messageId, rating) {
    this.db.prepare(`
      INSERT INTO feedback (user_id, message_id, rating) VALUES (?, ?, ?)
    `).run(userId, messageId, rating);
  }

  getFeedbackStats() {
    const up = this.db.prepare("SELECT COUNT(*) as c FROM feedback WHERE rating = 'up'").get().c;
    const down = this.db.prepare("SELECT COUNT(*) as c FROM feedback WHERE rating = 'down'").get().c;
    return { up, down, total: up + down, ratio: up + down > 0 ? (up / (up + down) * 100).toFixed(1) : 0 };
  }

  // ─── Unanswered ───

  addUnanswered(userId, question, reason = "") {
    this.db.prepare(`
      INSERT INTO unanswered (user_id, question, reason) VALUES (?, ?, ?)
    `).run(userId, question, reason);
  }

  getUnanswered(limit = 50) {
    return this.db.prepare(`
      SELECT * FROM unanswered WHERE answered = 0 ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  }

  markAnswered(id) {
    this.db.prepare("UPDATE unanswered SET answered = 1 WHERE id = ?").run(id);
  }

  // ─── Stats ───

  getStats() {
    const totalUsers = this.db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM messages").get().c;
    const totalMessages = this.db.prepare("SELECT COUNT(*) as c FROM messages").get().c;
    const activeSessions = this.db.prepare("SELECT COUNT(*) as c FROM sessions").get().c;
    const sourceStats = this.db.prepare(`
      SELECT source, COUNT(*) as c FROM messages GROUP BY source ORDER BY c DESC
    `).all();
    const feedbackStats = this.getFeedbackStats();

    return { totalUsers, totalMessages, activeSessions, sourceStats, feedback: feedbackStats };
  }
}

module.exports = AppDatabase;
