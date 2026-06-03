require("dotenv").config();
const { Pool } = require("pg");
const { PrismaClient } = require("./generated/prisma/client.js");
const { PrismaPg } = require("@prisma/adapter-pg");

const DB_TIMEOUT = 5000;

class AppDatabase {
  async init() {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: DB_TIMEOUT
    });
    this.prisma = new PrismaClient({
      adapter: new PrismaPg(pool)
    });
    await withTimeout(this.prisma.$connect(), DB_TIMEOUT, "Database connection timeout");
    return this;
  }

  // ─── Sessions ───

  async getSession(userId) {
    const row = await this.prisma.session.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      ...row,
      // Backward compatibility: expose snake_case fields
      message_count: row.messageCount,
      first_seen: row.firstSeen,
      updated_at: row.updatedAt,
      history: JSON.parse(row.history || "[]")
    };
  }

  async createSession(userId) {
    await this.prisma.session.upsert({
      where: { userId },
      create: { userId },
      update: {}
    });
    return this.getSession(userId);
  }

  async updateSession(userId, data) {
    const updateData = {};
    if (data.state !== undefined) updateData.state = data.state;
    if (data.language !== undefined) updateData.language = data.language;
    if (data.message_count !== undefined) updateData.messageCount = data.message_count;
    if (data.history !== undefined) updateData.history = JSON.stringify(data.history);
    if (Object.keys(updateData).length === 0) return;
    try {
      await this.prisma.session.update({ where: { userId }, data: updateData });
    } catch (e) {
      console.error(`[DB UPDATE ERR] userId=${userId} data=${JSON.stringify(data)} updateData=${JSON.stringify(updateData)} err=${e.message}`);
      throw e;
    }
  }

  async getOrCreateSession(userId) {
    let s = await this.getSession(userId);
    if (!s) s = await this.createSession(userId);
    return s;
  }

  async cleanupSessions(maxAgeMinutes = 60) {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60000);
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    await this.prisma.session.deleteMany({ where: { updatedAt: { lt: cutoff } } });
    await this.prisma.message.deleteMany({ where: { createdAt: { lt: weekAgo } } });
  }

  async getAllSessions() {
    const rows = await this.prisma.session.findMany({
      select: { userId: true, state: true, language: true, messageCount: true, updatedAt: true },
      orderBy: { updatedAt: "desc" }
    });
    return rows.map(r => ({ ...r, message_count: r.messageCount, updated_at: r.updatedAt }));
  }

  // ─── Messages ───

  async saveMessage(userId, userName, role, content, source = "", topic = "", lang = "id") {
    const msg = await this.prisma.message.create({
      data: { userId, userName, role, content, source, topic, language: lang }
    });
    return msg.id;
  }

  async getMessages(userId, limit = 50) {
    return this.prisma.message.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit
    });
  }

  async getRecentMessages(limit = 20) {
    return this.prisma.message.findMany({
      orderBy: { createdAt: "desc" },
      take: limit
    });
  }

  async getConversationContext(userId, limit = 6) {
    return this.prisma.message.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { role: true, content: true }
    });
  }

  // ─── Feedback ───

  async saveFeedback(userId, messageId, rating) {
    await this.prisma.feedback.create({
      data: { userId, messageId, rating }
    });
  }

  async getFeedbackStats() {
    const [up, down] = await Promise.all([
      this.prisma.feedback.count({ where: { rating: "up" } }),
      this.prisma.feedback.count({ where: { rating: "down" } })
    ]);
    return { up, down, total: up + down, ratio: up + down > 0 ? (up / (up + down) * 100).toFixed(1) : 0 };
  }

  // ─── Unanswered ───

  async addUnanswered(userId, question, reason = "") {
    await this.prisma.unanswered.create({
      data: { userId, question, reason }
    });
  }

  async getUnanswered(limit = 50) {
    return this.prisma.unanswered.findMany({
      where: { answered: 0 },
      orderBy: { createdAt: "desc" },
      take: limit
    });
  }

  async markAnswered(id) {
    await this.prisma.unanswered.update({
      where: { id },
      data: { answered: 1 }
    });
  }

  // ─── Broadcast ───

  async getAllUserIds() {
    const rows = await this.prisma.session.findMany({
      select: { userId: true },
      where: { NOT: { userId: "" } }
    });
    return rows.map(r => r.userId);
  }

  async countAllUsers() {
    return this.prisma.session.count();
  }

  // ─── Events / Calendar ───

  async addEvent(title, description, eventDate, category = "umum") {
    const event = await this.prisma.event.create({
      data: { title, description, eventDate: new Date(eventDate), category }
    });
    return event;
  }

  async getEvents(limit = 20, category = null) {
    const where = category ? { category } : {};
    return this.prisma.event.findMany({
      where,
      orderBy: { eventDate: "asc" },
      take: limit
    });
  }

  async getUpcomingEvents(days = 7) {
    const now = new Date();
    const end = new Date(Date.now() + days * 86400000);
    return this.prisma.event.findMany({
      where: { eventDate: { gte: now, lte: end } },
      orderBy: { eventDate: "asc" }
    });
  }

  async deleteEvent(id) {
    await this.prisma.event.delete({ where: { id } });
  }

  // ─── Stats ───

  async getStats() {
    const [totalUsers, totalMessages, activeSessions, sourceStatsRows, feedbackStats] = await Promise.all([
      this.prisma.message.groupBy({ by: ["userId"] }).then(r => r.length),
      this.prisma.message.count(),
      this.prisma.session.count(),
      this.prisma.message.groupBy({ by: ["source"], _count: { source: true } }).then(r =>
        r.map(x => ({ source: x.source, c: x._count.source })).sort((a, b) => b.c - a.c)
      ),
      this.getFeedbackStats()
    ]);
    return { totalUsers, totalMessages, activeSessions, sourceStats: sourceStatsRows, feedback: feedbackStats };
  }

  async close() {
    if (this.prisma) await this.prisma.$disconnect();
  }
}

function withTimeout(promise, ms, msg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
  ]);
}

module.exports = AppDatabase;
