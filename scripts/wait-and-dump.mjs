import CDP from "chrome-remote-interface";
const PORT = 9223;
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();

const probe = async () => {
  const r = await client.Runtime.evaluate({ expression: `
    (() => {
      let stopBtn = false;
      for (const btn of document.querySelectorAll('button')) {
        const al = (btn.getAttribute('aria-label') || '').toLowerCase();
        const hasRect = btn.querySelector('svg rect') !== null;
        if ((al.includes('stop') || hasRect) && btn.offsetParent !== null && !btn.disabled) { stopBtn = true; break; }
      }
      return { stopBtn, bodyLen: document.body.innerText.length };
    })()
  `, returnByValue: true });
  return r.result.value;
};

let lastLen = 0, stableCount = 0;
const startTime = Date.now();
console.log("Watching... (max 15min)");
while (Date.now() - startTime < 900000) {
  const s = await probe();
  process.stdout.write(`\r[${Math.round((Date.now() - startTime)/1000)}s] stopBtn=${s.stopBtn} bodyLen=${s.bodyLen} stable=${stableCount}/3   `);
  if (!s.stopBtn) {
    if (s.bodyLen === lastLen) stableCount++;
    else { stableCount = 0; lastLen = s.bodyLen; }
    if (stableCount >= 3) break;
  } else {
    stableCount = 0;
    lastLen = s.bodyLen;
  }
  await new Promise(r => setTimeout(r, 5000));
}

console.log("\n\nFinal state — dumping content...\n");
// Try multiple extraction strategies
const dump = await client.Runtime.evaluate({ expression: `
  (() => {
    const out = {};
    // Strategy A: full body text
    out.bodyTail = document.body.innerText.substring(Math.max(0, document.body.innerText.length - 8000));
    // Strategy B: prose elements with classes
    const proseEls = [...document.querySelectorAll('[class*="prose"]')];
    out.proseSample = proseEls.slice(-5).map(el => ({
      cls: el.className.substring(0, 80),
      parentTag: el.parentElement?.tagName,
      parentCls: el.parentElement?.className?.toString().substring(0, 80),
      text: el.innerText.substring(0, 200)
    }));
    return out;
  })()
`, returnByValue: true });

console.log("--- BODY TAIL (last 8000 chars) ---");
console.log(dump.result.value.bodyTail);
console.log("\n--- LAST 5 PROSE ELEMENTS ---");
console.log(JSON.stringify(dump.result.value.proseSample, null, 2));

await client.close();
