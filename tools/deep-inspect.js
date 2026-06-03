/**
 * Deep inspection — membedah response Gemini secara detail
 * 
 * Jalankan: node tools/deep-inspect.js
 */

const nodeFetch = require("node-fetch");

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

async function fetchTokens() {
  const res = await nodeFetch("https://gemini.google.com/", {
    headers: { "user-agent": USER_AGENT }
  });
  const html = await res.text();

  function extract(prefix, suffix) {
    const idx = html.indexOf(prefix);
    if (idx === -1) return "";
    const start = idx + prefix.length;
    const end = html.indexOf(suffix, start);
    return end === -1 ? "" : html.substring(start, end);
  }

  const tokens = {
    at: extract('"SNlM0e":"', '"'),
    bl: extract('"cfb2h":"', '"'),
    fsid: extract('"FdrFJe":"', '"'),
    gProp: extract('"gProp":"', '"'),
    cProp: extract('"cProp":"', '"'),
  };

  return tokens;
}

function extractAllTokenPatterns(html) {
  const patterns = [
    "SNlM0e", "cfb2h", "FdrFJe", "gProp", "cProp",
    "sarpab", "xjs", "f.sid", "bl", "reqid",
    "BardChatUi", "assistant.lamda", "StreamGenerate",
    "wrb.fr", "di", "af.httprm"
  ];

  console.log("=== Token Patterns in HTML ===");
  for (const pat of patterns) {
    const count = (html.match(new RegExp(pat, "g")) || []).length;
    const pos = html.indexOf(pat);
    const context = pos >= 0 ? html.substring(Math.max(0, pos - 30), pos + 60) : "NOT FOUND";
    console.log(`  ${pat.padEnd(30)} count=${count} at=${pos} ctx=${context.substring(0, 80)}`);
  }
  console.log("");
}

async function testEndpoint(url, body, label) {
  try {
    const res = await nodeFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": USER_AGENT,
        "x-same-domain": "1",
        origin: "https://gemini.google.com",
        referer: "https://gemini.google.com/"
      },
      body
    });
    const text = await res.text();
    console.log(`[${label}] Status: ${res.status}, Length: ${text.length}`);
    return text;
  } catch (err) {
    console.log(`[${label}] ERROR: ${err.message}`);
    return null;
  }
}

function analyzeResponseStructure(raw) {
  console.log("\n=== RAW RESPONSE ANALYSIS ===");
  console.log(`Total length: ${raw.length} chars`);
  
  const lines = raw.split("\n").filter(l => l.trim());
  console.log(`Total lines: ${lines.length}`);
  
  let wrbLines = 0;
  for (const line of lines) {
    if (line.startsWith('[["wrb.fr"')) {
      wrbLines++;
      analyzeWrbLine(line);
    } else if (line.length > 10 && !line.startsWith("[")) {
      // Probably just a number or short array
    }
  }
  console.log(`\n  wrb.fr lines: ${wrbLines}`);
}

function analyzeWrbLine(line) {
  try {
    const outer = JSON.parse(line);
    const rawInner = outer?.[0]?.[2];
    if (!rawInner) return;
    
    const inner = JSON.parse(rawInner);
    console.log(`\n  ── wrb.fr entry ──`);
    console.log(`  Array length: ${inner.length}`);
    console.log(`  [0] conversationId: ${inner[0]}`);
    console.log(`  [1] responseId: ${inner[1]}`);
    console.log(`  [2] choiceState: ${JSON.stringify(inner[2])}`);
    
    for (let i = 0; i < inner.length; i++) {
      const val = inner[i];
      if (i === 4) continue; // main content, analyze separately
      if (val === null || val === undefined) continue;
      
      let typeStr = typeof val;
      let preview = "";
      if (Array.isArray(val)) {
        typeStr = `array[${val.length}]`;
        preview = JSON.stringify(val).substring(0, 100);
      } else if (typeof val === "string") {
        preview = val.substring(0, 80);
      } else if (typeof val === "object") {
        preview = JSON.stringify(val).substring(0, 80);
      } else {
        preview = String(val).substring(0, 80);
      }
      console.log(`  [${i}] ${typeStr}: ${preview}`);
    }
    
    if (inner[4]) {
      console.log(`\n  ── inner[4] (main choices) array[${inner[4].length}] ──`);
      inner[4].forEach((choice, ci) => {
        if (!choice) { console.log(`  [${ci}] null`); return; }
        console.log(`  [${ci}] array[${choice.length}]`);
        
        for (let j = 0; j < Math.min(choice.length, 30); j++) {
          const v = choice[j];
          if (v === null || v === undefined) continue;
          
          let typeStr = typeof v;
          let preview = "";
          if (Array.isArray(v)) {
            typeStr = `array[${v.length}]`;
            if (j === 1 && v.length > 0) {
              // This is typically the text content
              preview = `"${String(v[0]).substring(0, 100)}..."`;
            } else {
              preview = JSON.stringify(v).substring(0, 100);
            }
          } else if (typeof v === "string") {
            preview = v.substring(0, 100);
          } else if (typeof v === "object") {
            preview = JSON.stringify(v).substring(0, 100);
          } else {
            preview = String(v);
          }
          console.log(`  [${ci}][${j}] ${typeStr}: ${preview}`);
        }
      });
    }
  } catch (e) {
    console.log(`  Parse error: ${e.message}`);
  }
}

async function exploreGeminiEndpoints(tokens) {
  console.log("\n═══════════════════════════════════════");
  console.log("  EXPLORING GEMINI ENDPOINTS");
  console.log("═══════════════════════════════════════\n");
  
  const baseUrl = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService";
  const params = new URLSearchParams({
    bl: tokens.bl,
    "f.sid": tokens.fsid,
    hl: "id",
    _reqid: 1,
    rt: "c"
  });
  
  const payload = [null, JSON.stringify([["Halo, apa saja jurusan SMK?", 0, null, null, null, null, 0]])];
  const body = `f.req=${encodeURIComponent(JSON.stringify(payload))}&at=${tokens.at || ""}`;
  
  // Test 1: Standard StreamGenerate
  console.log("── Test 1: StreamGenerate (standard) ──");
  const url1 = `${baseUrl}/StreamGenerate?${params}`;
  const res1 = await testEndpoint(url1, body, "StreamGenerate");
  if (res1) {
    analyzeResponseStructure(res1);
  }
  
  // Test 2: Try different params
  console.log("\n── Test 2: Different params ──");
  const params2 = new URLSearchParams({
    bl: tokens.bl,
    "f.sid": tokens.fsid,
    hl: "id",
    _reqid: 2,
    rt: "c",
    "f.req": JSON.stringify(payload)
  });
  const url2 = `${baseUrl}/StreamGenerate?${params2}`;
  
  try {
    const res = await nodeFetch(url2, {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
        "x-same-domain": "1"
      }
    });
    console.log(`[GET StreamGenerate] Status: ${res.status}`);
    const text = await res.text();
    console.log(`  Response: ${text.substring(0, 200)}`);
  } catch (err) {
    console.log(`[GET StreamGenerate] ERROR: ${err.message}`);
  }
  
  // Test 3: Try Reset endpoint
  console.log("\n── Test 3: Try other endpoints ──");
  const endpoints = [
    `${baseUrl}/Reset`,
    `${baseUrl}/DeleteConversation`,
    `${baseUrl}/ListConversations`,
    `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/GetSerializedConversation`,
    `https://gemini.google.com/_/GenerativeLanguageUi/data/ai.generativelanguage.GenerativeLanguageUiService/GenerateContent`
  ];
  
  for (const ep of endpoints) {
    try {
      const res = await nodeFetch(ep, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": USER_AGENT,
          "x-same-domain": "1"
        },
        body
      });
      console.log(`  ${ep.split("/").pop()}: Status ${res.status}, Len ${(await res.text()).length}`);
    } catch (err) {
      console.log(`  ${ep.split("/").pop()}: ERROR ${err.message.substring(0, 50)}`);
    }
  }
}

async function analyzeWhatsAppLimits() {
  console.log("\n═══════════════════════════════════════");
  console.log("  WHATSAPP CLOUD API ANALYSIS");
  console.log("═══════════════════════════════════════\n");
  
  console.log("── Rate Limits ──");
  console.log("  Per message: 1 msg/phone-number/second");
  console.log("  Per number:  250 msg/phone-number/day (marketing)");
  console.log("  Per number:  1000 msg/phone-number/day (utility)");
  console.log("  Free tier:   1000 conversations/month (per business)");
  
  console.log("\n── Message Limits ──");
  console.log("  Text:        4096 chars");
  console.log("  Interactive: 1024 chars body");
  console.log("  Button:      20 chars per button");
  console.log("  Button:      3 buttons max");
  console.log("  Template:    10 variables");
  
  console.log("\n── Webhook Events ──");
  console.log("  messages:       text, image, audio, document, video, sticker, location, contacts, interactive");
  console.log("  message_delivered");
  console.log("  message_read");
  console.log("  message_failed");
  console.log("  account_opening, account_closing");
  
  console.log("\n── Interactive Types ──");
  console.log("  button:        up to 3 reply buttons");
  console.log("  list:          up to 10 sections, 30 rows");
  console.log("  product, product_list");
}

async function analyzeSystemFailureModes() {
  console.log("\n═══════════════════════════════════════");
  console.log("  SYSTEM FAILURE MODE ANALYSIS");
  console.log("═══════════════════════════════════════\n");
  
  const scenarios = [
    {
      name: "GEMINI SCRAPER DOWN",
      cause: "Google changes frontend, tokens change, IP blocked, rate limited",
      detect: "Request returns 403, 429, or unexpected HTML structure",
      impact: "All AI features stop. KB-only fallback kicks in.",
      auto_mitigation: "Server.js has retry + fallback to KB. Retry 2x with token refresh.",
      manual_fix: "Need to update _extract() regex patterns to match new Google HTML",
      notes: "This WILL happen eventually. Google actively fights scrapers."
    },
    {
      name: "WHATSAPP TOKEN EXPIRED",
      cause: "Meta access token expires (24h for temporary tokens, 60d for permanent)",
      detect: "API returns 401 or 400 with token error",
      impact: "All outbound messages fail. Inbound still received but no reply.",
      auto_mitigation: "Log error, continue accepting webhooks",
      manual_fix: "Refresh token in Meta Developer Console, update .env, restart",
      notes: "Permanent tokens need Meta App Review. Use 60-day tokens for dev."
    },
    {
      name: "WHATSAPP RATE LIMITED (429)",
      cause: "Sending too many messages too fast",
      detect: "API returns 429 Too Many Requests",
      impact: "Messages delayed or dropped",
      auto_mitigation: "whatsapp.js has built-in rate limiter (200ms interval) + auto-retry on 429",
      manual_fix: "Reduce send rate or request higher limit from Meta",
      notes: "Free tier: 1000 conversations/month. After that, messages fail."
    },
    {
      name: "KB FILE CORRUPTED",
      cause: "JSON syntax error during manual edit, encoding issue",
      detect: "JSON.parse failure on server start or reload",
      impact: "Server uses last valid KB cache. New edits not reflected.",
      auto_mitigation: "Try/catch with fallback to old data",
      manual_fix: "Fix JSON syntax. Validate with 'npm run train' before saving.",
      notes: "ingest.js tool prevents this if run before saving."
    },
    {
      name: "MEMORY OVERFLOW (SESSION LEAK)",
      cause: "Too many concurrent users, sessions never cleaned up",
      detect: "Server OOM killed by PM2",
      impact: "All sessions lost, server restarts",
      auto_mitigation: "Session cleanup every 60s, MAX_SESSION_AGE = 30min",
      manual_fix: "Reduce session timeout, add disk-based session store",
      notes: "Current design: in-memory. ~1KB per session. 10K users ≈ 10MB."
    },
    {
      name: "NETWORK PARTITION",
      cause: "Server loses internet, DNS fails, ISP outage",
      detect: "All API calls timeout",
      impact: "AI + KB + WhatsApp all fail. Server still runs but useless.",
      auto_mitigation: "Timeout errors caught, fallback messages sent",
      manual_fix: "Restore internet connection",
      notes: "Critical for deployment in NTB where internet can be unstable."
    },
    {
      name: "GEMINI RETURNS OFF-TOPIC",
      cause: "No system prompt support in scraper mode",
      detect: "AI answers outside SMKN 2 context (e.g., general knowledge)",
      impact: "User gets wrong info, loses trust",
      auto_mitigation: "Context injection via setContext() - but Gemini can still ignore it",
      manual_fix: "Only fix is official Gemini API with proper system_instruction param",
      notes: "HIGH RISK. This is why official API is strongly recommended."
    }
  ];
  
  for (const s of scenarios) {
    console.log(`── ${s.name} ──`);
    console.log(`  Cause: ${s.cause}`);
    console.log(`  Detect: ${s.detect}`);
    console.log(`  Impact: ${s.impact}`);
    console.log(`  Auto: ${s.auto_mitigation}`);
    console.log(`  Fix: ${s.manual_fix}`);
    if (s.notes) console.log(`  ⚠ ${s.notes}`);
    console.log("");
  }
}

async function analyzeStateMachine() {
  console.log("═══════════════════════════════════════");
  console.log("  USER SESSION STATE MACHINE");
  console.log("═══════════════════════════════════════\n");
  
  const states = {
    "NEW": "User baru, belum pernah chat. Kirim welcome menu.",
    "MENU": "User di menu utama. Tombol: Jurusan, SPMB, Kontak. Ketik apapun → QUESTION.",
    "QUESTION": "User ngirim pertanyaan. Intent router detect topik. Kirim ke AI/KB.",
    "JURUSAN_MENU": "User pilih Jurusan. Tampilin daftar jurusan. Pilih salah satu → detail.",
    "JURUSAN_DETAIL": "User liat detail jurusan. Bisa balik ke menu jurusan.",
    "SPMB_INFO": "User liat info SPMB. Bisa balik ke menu utama.",
    "KONTAK_INFO": "User liat kontak. Bisa balik ke menu utama.",
    "FAQ_BROWSING": "User lagi jelajah FAQ. Multi-turn dalam satu topik.",
    "FALLBACK": "AI dan KB gagal jawab. Kirim kontak admin."
  };
  
  console.log("States:");
  for (const [name, desc] of Object.entries(states)) {
    console.log(`  ${name.padEnd(20)} → ${desc}`);
  }
  
  console.log("\nTransitions:");
  console.log(`
  NEW ──(pesan)──→ MENU
  MENU ──(tombol)──→ JURUSAN_MENU / SPMB_INFO / KONTAK_INFO
  MENU ──(teks)──→ QUESTION
  JURUSAN_MENU ──(pilih)──→ JURUSAN_DETAIL
  JURUSAN_DETAIL ──("kembali")──→ JURUSAN_MENU
  QUESTION ──(berhasil)──→ MENU (optional continue)
  QUESTION ──(gagal)──→ FALLBACK ──→ MENU
  `);
}

async function main() {
  console.log("\n═══════════════════════════════════════");
  console.log("  DEEP RESEARCH — SMKN 2 AI SYSTEM");
  console.log("═══════════════════════════════════════\n");
  
  // Part 1: Get tokens
  console.log("── Fetching Gemini tokens ──");
  const tokens = await fetchTokens();
  console.log(`  at (SNlM0e): ${tokens.at ? tokens.at.substring(0, 20) + "..." : "NOT FOUND (optional)"}`);
  console.log(`  bl (cfb2h): ${tokens.bl ? tokens.bl.substring(0, 30) + "..." : "NOT FOUND"}`);
  console.log(`  fsid (FdrFJe): ${tokens.fsid ? tokens.fsid.substring(0, 15) + "..." : "NOT FOUND"}`);
  console.log(`  gProp: ${tokens.gProp || "NOT FOUND"}`);
  console.log(`  cProp: ${tokens.cProp || "NOT FOUND"}`);
  
  // Part 2: Analyze HTML for tokens
  const htmlRes = await nodeFetch("https://gemini.google.com/", {
    headers: { "user-agent": USER_AGENT }
  });
  const html = await htmlRes.text();
  extractAllTokenPatterns(html);
  
  // Part 3: Explore endpoints
  if (tokens.at || tokens.bl) {
    await exploreGeminiEndpoints(tokens);
  }
  
  // Part 4: State machine
  await analyzeStateMachine();
  
  // Part 5: Failure modes
  await analyzeSystemFailureModes();
  
  // Part 6: WhatsApp limits
  await analyzeWhatsAppLimits();
  
  console.log("═══════════════════════════════════════");
  console.log("  RESEARCH COMPLETE");
  console.log("═══════════════════════════════════════\n");
}

main().catch(console.error);
