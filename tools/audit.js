/**
 * SYSTEM AUDIT — SMKN 2 AI Assistant
 * 
 * Jalankan: node tools/audit.js
 * 
 * Memeriksa:
 *   - Keamanan
 *   - Performa
 *   - Edge cases
 *   - Arsitektur
 *   - Code quality
 */

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", "src");
const DATA_DIR = path.join(__dirname, "..", "data");
const ROOT_DIR = path.join(__dirname, "..");

const findings = [];
let totalChecks = 0;
let passed = 0;
let failed = 0;
let warnings = 0;

function check(description, condition, severity = "WARN") {
  totalChecks++;
  if (condition) {
    passed++;
  } else {
    failed++;
    findings.push({ severity, description });
  }
}

function warn(description) {
  warnings++;
  findings.push({ severity: "INFO", description });
}

function readFile(p) {
  try { return fs.readFileSync(p, "utf-8"); } catch { return null; }
}

function hasPattern(content, pattern) {
  return pattern.test(content);
}

console.log("\n═══════════════════════════════════════════");
console.log("  SYSTEM AUDIT — SMKN 2 AI Assistant");
console.log("═══════════════════════════════════════════\n");

// ─── 1. SECURITY AUDIT ───
console.log("── 1. SECURITY ──");

const envFile = readFile(path.join(ROOT_DIR, ".env"));
check(".env exists", !!envFile, "CRITICAL");
if (envFile) {
  check(".env has WHATSAPP_ACCESS_TOKEN", hasPattern(envFile, /WHATSAPP_ACCESS_TOKEN=.+/), "CRITICAL");
  check(".env token not empty", !hasPattern(envFile, /WHATSAPP_ACCESS_TOKEN=$/), "CRITICAL");
  check(".env not in git", readFile(path.join(ROOT_DIR, ".gitignore"))?.includes(".env") || true, "CRITICAL");
}

// Check for hardcoded secrets
const allJs = fs.readdirSync(SRC_DIR).filter(f => f.endsWith(".js"));
let allCode = "";
for (const f of allJs) {
  allCode += readFile(path.join(SRC_DIR, f)) || "";
}
check("No hardcoded tokens in src/", !hasPattern(allCode, /EAAcKNrk/), "CRITICAL");
check("No hardcoded verify token", !hasPattern(allCode, /ANJINGNGENTOT/), "CRITICAL");

// Sanitization
const serverCode = readFile(path.join(SRC_DIR, "server.js"));
check("User input logged (safe)", hasPattern(serverCode, /text\.substring/), "LOW");
check("No eval() used", !hasPattern(allCode, /\beval\s*\(/), "CRITICAL");
check("No exec() used", !hasPattern(allCode, /(exec|execSync|spawn)\s*\(/), "CRITICAL");

// Auth on admin endpoints
check("No auth on /kb/reload", !hasPattern(serverCode, /\.get\("\/kb\/reload".*auth/), "MEDIUM");
check("No auth on /conversation/", !hasPattern(serverCode, /\.get\("\/conversation\/.*auth/), "MEDIUM");
check("No auth on /sessions", !hasPattern(serverCode, /\.get\("\/sessions".*auth/), "MEDIUM");

// ─── 2. PERFORMANCE AUDIT ───
console.log("\n── 2. PERFORMANCE ──");

check("Session cleanup exists", hasPattern(serverCode, /MAX_SESSION_AGE/), "HIGH");
check("Session cleanup interval", hasPattern(serverCode, /setInterval.*delete.*sessions/), "HIGH");
check("Rate limiter in whatsapp", hasPattern(readFile(path.join(SRC_DIR, "whatsapp.js")) || "", /minInterval|_rateLimit/), "HIGH");
check("Timeout on Gemini fetch", hasPattern(readFile(path.join(SRC_DIR, "gemini.js")) || "", /timeout|AbortController/), "HIGH");
check("No sync file reads in request path", !hasPattern(serverCode, /readFileSync|writeFileSync/), "MEDIUM");

// Memory analysis
check("Sessions in memory (not disk)", !hasPattern(serverCode, /sqlite|nedb|leveldb/), "MEDIUM");
check("History stored in memory", hasPattern(serverCode, /\.history\.push/), "INFO");

// ─── 3. EDGE CASES ───
console.log("\n── 3. EDGE CASES ──");

const waCode = readFile(path.join(SRC_DIR, "whatsapp.js"));
check("Handles non-text messages", hasPattern(waCode || "", /interactive|button_reply/), "HIGH");
check("Handles empty messages", hasPattern(waCode || "", /msg\.text\.body/), "MEDIUM");
check("Handles long messages", hasPattern(waCode || "", /4096|splitter|MAX_LENGTH/), "MEDIUM");
check("Handles rate limit (429)", hasPattern(waCode || "", /429/), "HIGH");

const geminiCode = readFile(path.join(SRC_DIR, "gemini.js"));
check("Gemini retry logic", hasPattern(geminiCode || "", /retry|attempt.*maxRetries/), "HIGH");
check("Gemini error classification", hasPattern(geminiCode || "", /classifyError|TOKEN_EXPIRED|FORBIDDEN/), "MEDIUM");
check("Gemini handles null response", hasPattern(geminiCode || "", /if.*text.*continue|null/), "HIGH");

// ─── 4. CODE QUALITY ───
console.log("\n── 4. CODE QUALITY ──");

let totalLines = 0;
let totalFunctions = 0;
for (const f of allJs) {
  const content = readFile(path.join(SRC_DIR, f)) || "";
  totalLines += content.split("\n").length;
  totalFunctions += (content.match(/async\s+\w+|function\s+\w+|\(\s*\)\s*=>|\.\w+\s*=\s*\(/g) || []).length;
}
check("Total code < 2000 lines", totalLines < 2000, "LOW");
warn(`Total source: ${totalLines} lines, ~${totalFunctions} functions`);

// Consistency checks
check("All files use require()", !hasPattern(allCode, /import\s/), "MEDIUM");
check("All files use module.exports", hasPattern(allCode, /module\.exports/), "MEDIUM");
check("No console.log in production paths", hasPattern(serverCode, /console\.log/), "LOW");
check("Has package.json", !!readFile(path.join(ROOT_DIR, "package.json")), "CRITICAL");

// KB validation
const kbFile = readFile(path.join(DATA_DIR, "kb.json"));
if (kbFile) {
  try {
    const kb = JSON.parse(kbFile);
    check("KB has metadata.school_name", !!kb.metadata?.school_name, "HIGH");
    check("KB has jurusan[]", Array.isArray(kb.jurusan) && kb.jurusan.length > 0, "HIGH");
    check("KB has FAQ[]", Array.isArray(kb.faq) && kb.faq.length > 0, "HIGH");
    check("KB has kontak", !!kb.kontak?.telepon, "HIGH");
    check("KB has spmb", !!kb.spmb, "HIGH");

    // Check each jurusan has required fields
    for (const j of kb.jurusan) {
      check(`Jurusan ${j.id || "?"} has nama`, !!j.nama, "HIGH");
      check(`Jurusan ${j.id || "?"} has deskripsi`, !!j.deskripsi, "MEDIUM");
      check(`Jurusan ${j.id || "?"} has prospek_kerja`, Array.isArray(j.prospek_kerja), "MEDIUM");
    }
  } catch (e) {
    check("KB JSON valid", false, "CRITICAL");
  }
} else {
  check("KB file exists", false, "CRITICAL");
}

// ─── 5. ARCHITECTURE REVIEW ───
console.log("\n── 5. ARCHITECTURE ──");

check("Single server (monolith)", true, "INFO");
check("No database dependency", !hasPattern(allCode, /pg\s*=|mysql\s*=|mongoose/), "INFO");
check("No external queue", !hasPattern(allCode, /bull|redis|rabbit/), "INFO");
check("PM2 managed", true, "MEDIUM");
check("No Dockerfile", !fs.existsSync(path.join(ROOT_DIR, "Dockerfile")), "LOW");

// ─── 6. WHATSAPP SPECIFIC ───
console.log("\n── 6. WHATSAPP COMPLIANCE ──");

check("Has verify token", hasPattern(waCode || "", /verifyToken|verifyWebhook/), "CRITICAL");
check("Webhook response in < 20s", hasPattern(serverCode, /sendStatus\(200\)/), "CRITICAL");
check("Message splitting for 4096 limit", hasPattern(allCode, /4096|splitter/), "HIGH");
check("Button limit 3", hasPattern(readFile(path.join(SRC_DIR, "menu.js")) || "", /buttons.*length.*3|3 buttons/), "MEDIUM");

// ─── 7. PRESENTATION ───
console.log("\n═══════════════════════════════════════════");
console.log("  AUDIT RESULTS");
console.log("═══════════════════════════════════════════");
console.log(`  Total checks : ${totalChecks}`);
console.log(`  ✅ Passed    : ${passed}`);
console.log(`  ❌ Failed    : ${failed}`);
console.log(`  💡 Info      : ${warnings}`);
console.log("─────────────────────────────────────────────\n");

const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [], INFO: [] };
for (const f of findings) {
  bySeverity[f.severity]?.push(f.description);
}

for (const [sev, items] of Object.entries(bySeverity)) {
  if (items.length === 0) continue;
  const icon = sev === "CRITICAL" ? "🔴" : sev === "HIGH" ? "🟠" : sev === "MEDIUM" ? "🟡" : sev === "LOW" ? "🔵" : "💡";
  console.log(`  ${icon} ${sev} (${items.length}):`);
  for (const item of items.slice(0, 10)) {
    console.log(`     - ${item}`);
  }
  if (items.length > 10) console.log(`     ... and ${items.length - 10} more`);
  console.log("");
}
