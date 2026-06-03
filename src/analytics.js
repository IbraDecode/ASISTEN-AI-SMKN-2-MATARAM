/**
 * Analytics & Logger
 * Melacak percakapan, topik, unanswered, performa
 */

class Analytics {
  constructor() {
    this.log = [];
    this.dailyStats = {
      date: new Date().toISOString().split("T")[0],
      total: 0,
      ai: 0,
      kb: 0,
      menu: 0,
      unanswered: 0,
      errors: 0,
      topTopics: {}
    };
    this.userStats = {};
  }

  trackMessage(userId, userName, msg) {
    this.ensureUser(userId, userName);

    const entry = {
      userId,
      userName,
      text: msg.text,
      type: msg.type,
      timestamp: Date.now(),
      responseTime: msg.responseTime || 0,
      source: msg.source || "unknown",
      topic: msg.topic || "unknown"
    };

    this.log.push(entry);
    if (this.log.length > 1000) this.log.shift();
    this.dailyStats.total++;
    this.dailyStats.topTopics[entry.topic] =
      (this.dailyStats.topTopics[entry.topic] || 0) + 1;

    if (entry.source === "ai") this.dailyStats.ai++;
    else if (entry.source === "kb") this.dailyStats.kb++;
    else if (entry.source === "menu") this.dailyStats.menu++;
    else if (entry.source === "unanswered") this.dailyStats.unanswered++;

    this.userStats[userId].messages++;
    this.userStats[userId].topics[entry.topic] =
      (this.userStats[userId].topics[entry.topic] || 0) + 1;
  }

  trackError(userId, errMsg) {
    this.dailyStats.errors++;
    if (userId && this.userStats[userId]) {
      this.userStats[userId].errors++;
    }
  }

  ensureUser(userId, userName) {
    if (!this.userStats[userId]) {
      this.userStats[userId] = {
        name: userName || "Unknown",
        firstSeen: Date.now(),
        messages: 0,
        errors: 0,
        topics: {}
      };
    } else if (userName) {
      this.userStats[userId].name = userName;
    }
  }

  getStats() {
    return {
      daily: this.dailyStats,
      totalUsers: Object.keys(this.userStats).length,
      totalMessages: this.log.length,
      topUsers: Object.entries(this.userStats)
        .sort((a, b) => b[1].messages - a[1].messages)
        .slice(0, 10)
        .map(([id, s]) => ({
          id: id.substring(0, 8) + "...",
          name: s.name,
          messages: s.messages,
          errors: s.errors
        })),
      topTopics: Object.entries(this.dailyStats.topTopics)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([topic, count]) => ({ topic, count })),
      unanswered: this.log.filter((l) => l.source === "unanswered").slice(-20)
    };
  }

  getRecentLog(n = 50) {
    return this.log.slice(-n).reverse();
  }

  resetDaily() {
    this.dailyStats = {
      date: new Date().toISOString().split("T")[0],
      total: 0,
      ai: 0,
      kb: 0,
      menu: 0,
      unanswered: 0,
      errors: 0,
      topTopics: {}
    };
  }
}

module.exports = new Analytics();
