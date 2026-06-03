/**
 * Tool untuk inspeksi response mentah dari Gemini
 * Jalankan: node tools/scrape-inspect.js
 */
const nodeFetch = require("node-fetch");

async function inspect() {
  console.log("Fetching Gemini homepage...");
  const homeRes = await nodeFetch("https://gemini.google.com/", {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36"
    }
  });
  const homeHtml = await homeRes.text();

  const tokens = {
    a: homeHtml.match(/"SNlM0e":"(.*?)"/)?.[1] || "",
    b: homeHtml.match(/"cfb2h":"(.*?)"/)?.[1] || "",
    c: homeHtml.match(/"FdrFJe":"(.*?)"/)?.[1] || ""
  };

  console.log("Tokens:", tokens.a ? "✅ OK" : "❌ MISSING");
  console.log("SNlM0e (at):", tokens.a.substring(0, 20) + "...");
  console.log("cfb2h (bl):", tokens.b ? tokens.b.substring(0, 10) + "..." : "NONE");
  console.log("FdrFJe (sid):", tokens.c ? tokens.c.substring(0, 10) + "..." : "NONE");

  const testMsg = "Halo, apa kabar?";
  const payload = [null, JSON.stringify([[testMsg, 0, null, null, null, null, 0]])];
  const params = new URLSearchParams({
    bl: tokens.b,
    "f.sid": tokens.c,
    hl: "id",
    _reqid: 1,
    rt: "c"
  });

  console.log("\nSending test message...");
  const url = `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${params}`;
  console.log("URL:", url.replace(tokens.a, "SECRET"));

  const res = await nodeFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "user-agent":
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
      "x-same-domain": "1"
    },
    body: `f.req=${encodeURIComponent(JSON.stringify(payload))}&at=${tokens.a}`
  });

  const raw = await res.text();

  console.log("\n=== RESPONSE MENTAH (first 3000 chars) ===");
  console.log(raw.substring(0, 3000));
  console.log("\n... (truncated)");
  console.log("\nTotal length:", raw.length, "chars");
  console.log("\n=== LINE BY LINE ===");
  const lines = raw.split("\n").filter((l) => l.trim());
  lines.forEach((line, i) => {
    const preview = line.length > 200 ? line.substring(0, 200) + "..." : line;
    if (line.startsWith('[["wrb.fr"')) {
      console.log(`\n[LINE ${i}] MATCH: starts with wrb.fr`);
      try {
        const outer = JSON.parse(line);
        if (outer[0] && outer[0][2]) {
          const inner = JSON.parse(outer[0][2]);
          console.log(` → Parsed inner type: ${typeof inner}`);
          console.log(` → inner keys: ${Array.isArray(inner) ? `array[${inner.length}]` : Object.keys(inner).join(", ")}`);
          if (Array.isArray(inner) && inner[4]) {
            console.log(` → inner[4] is array[${inner[4].length}]`);
            if (inner[4][0]) {
              console.log(` → inner[4][0] keys: ${Array.isArray(inner[4][0]) ? `array[${inner[4][0].length}]` : Object.keys(inner[4][0]).join(", ")}`);
              if (Array.isArray(inner[4][0]) && inner[4][0][1]) {
                const text = inner[4][0][1];
                console.log(` → inner[4][0][1] type: ${typeof text}, length: ${typeof text === 'string' ? text.length : Array.isArray(text) ? text.length : '?'}`);
              }
            }
          }
          if (Array.isArray(inner) && inner[0]) {
            console.log(` → inner[0] (response ID?): ${inner[0]}`);
          }
          if (Array.isArray(inner) && inner.length > 7) {
            console.log(` → inner[7] exists: ${!!inner[7]}`);
            if (inner[7]) console.log(` → inner[7] type: ${typeof inner[7]}, val: ${JSON.stringify(inner[7]).substring(0, 100)}`);
          }
        }
      } catch (e) {
        console.log(` → Parse error: ${e.message}`);
      }
    } else if (line.length > 10) {
      console.log(`\n[LINE ${i}] ${preview}`);
    }
  });
}

inspect().catch(console.error);
