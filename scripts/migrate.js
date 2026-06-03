/**
 * Migrate data from SQLite → Supabase PostgreSQL via Prisma
 *
 * Usage: node scripts/migrate.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const Database = require("better-sqlite3");
const path = require("path");

async function main() {
  // ─── SQLite source ───
  const sqlitePath = path.join(__dirname, "..", "data", "smkn2.db");
  const sqlite = new Database(sqlitePath);
  sqlite.pragma("journal_mode = WAL");

  // ─── Prisma target ───
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
    import("../generated/prisma/client.ts"),
    import("@prisma/adapter-pg")
  ]);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
  });
  await prisma.$connect();

  console.log("Connected to both databases");

  // ─── Migrate sessions ───
  const sessions = sqlite.prepare("SELECT * FROM sessions").all();
  console.log(`Migrating ${sessions.length} sessions...`);
  for (const s of sessions) {
    await prisma.session.upsert({
      where: { userId: s.user_id },
      create: {
        userId: s.user_id,
        state: s.state || "MENU",
        language: s.language || "id",
        messageCount: s.message_count || 0,
        history: s.history || "[]",
        firstSeen: s.first_seen ? new Date(s.first_seen + "Z") : new Date(),
        updatedAt: s.updated_at ? new Date(s.updated_at + "Z") : new Date()
      },
      update: {}
    });
  }

  // ─── Migrate messages ───
  const messages = sqlite.prepare("SELECT * FROM messages ORDER BY id ASC").all();
  console.log(`Migrating ${messages.length} messages...`);
  for (const m of messages) {
    try {
      await prisma.message.create({
        data: {
          id: m.id,
          userId: m.user_id,
          userName: m.user_name || "",
          role: m.role,
          content: m.content,
          source: m.source || "",
          topic: m.topic || "",
          language: m.language || "id",
          createdAt: m.created_at ? new Date(m.created_at + "Z") : new Date()
        }
      });
    } catch (e) {
      console.error(`  Skip message ${m.id}: ${e.message.substring(0, 60)}`);
    }
  }

  // ─── Migrate feedback ───
  const feedbacks = sqlite.prepare("SELECT * FROM feedback ORDER BY id ASC").all();
  console.log(`Migrating ${feedbacks.length} feedbacks...`);
  for (const f of feedbacks) {
    try {
      await prisma.feedback.create({
        data: {
          id: f.id,
          userId: f.user_id,
          messageId: f.message_id,
          rating: f.rating,
          createdAt: f.created_at ? new Date(f.created_at + "Z") : new Date()
        }
      });
    } catch (e) {
      console.error(`  Skip feedback ${f.id}: ${e.message.substring(0, 60)}`);
    }
  }

  // ─── Migrate unanswered ───
  const unanswereds = sqlite.prepare("SELECT * FROM unanswered ORDER BY id ASC").all();
  console.log(`Migrating ${unanswereds.length} unanswered...`);
  for (const u of unanswereds) {
    try {
      await prisma.unanswered.create({
        data: {
          id: u.id,
          userId: u.user_id,
          question: u.question,
          reason: u.reason || "",
          answered: u.answered || 0,
          createdAt: u.created_at ? new Date(u.created_at + "Z") : new Date()
        }
      });
    } catch (e) {
      console.error(`  Skip unanswered ${u.id}: ${e.message.substring(0, 60)}`);
    }
  }

  // ─── Reset sequences ───
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('messages', 'id'), COALESCE((SELECT MAX(id) FROM messages), 0) + 1, false)`
  );
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('feedback', 'id'), COALESCE((SELECT MAX(id) FROM feedback), 0) + 1, false)`
  );
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('unanswered', 'id'), COALESCE((SELECT MAX(id) FROM unanswered), 0) + 1, false)`
  );

  console.log("Migration complete!");
  sqlite.close();
  await prisma.$disconnect();
}

main().catch(e => {
  console.error("Migration failed:", e.message);
  process.exit(1);
});
