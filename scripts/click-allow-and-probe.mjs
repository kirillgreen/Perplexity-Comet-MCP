import CDP from "chrome-remote-interface";
import { writeFileSync } from "fs";

const PORT = 9223;
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();

const evalJs = async (expr) => {
  const r = await client.Runtime.evaluate({ expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

// Click Allow once
const clicked = await evalJs(`
  (() => {
    for (const btn of document.querySelectorAll('button')) {
      const t = (btn.innerText || '').trim().toLowerCase();
      if (t === 'allow once' && btn.offsetParent !== null && !btn.disabled) {
        btn.click();
        return 'clicked';
      }
    }
    return 'not found';
  })()
`);
console.log("Allow click:", clicked);
await new Promise(r => setTimeout(r, 2000));

// Now probe DOM as agent runs
console.log("Probing every 1.5s for 40s...");

const snapshot = () => evalJs(`
  (() => {
    let stopBtn = false;
    for (const btn of document.querySelectorAll('button')) {
      const al = (btn.getAttribute('aria-label') || '').toLowerCase();
      const hasRect = btn.querySelector('svg rect') !== null;
      if ((al.includes('stop') || hasRect) && btn.offsetParent !== null && !btn.disabled) { stopBtn = true; break; }
    }
    // Aggressive scan: find any element with svg + text starting with action keyword
    const stepKeywords = ['Navigating', 'Reading', 'Clicking', 'Interacting', 'Searching', 'Analyzing', 'Opening', 'Reviewing', 'Preparing', 'Typing', 'Found', 'Visiting', 'Looking', 'Working', 'Locating'];
    const found = [];
    for (const el of document.querySelectorAll('*')) {
      const t = (el.innerText || '').trim();
      if (t.length === 0 || t.length > 200) continue;
      const firstWord = t.split(/[\s\n]/)[0];
      if (!stepKeywords.includes(firstWord)) continue;
      // Make sure this element is a leaf-ish (text not dominated by descendants > 90%)
      const ownLen = t.length;
      const childLens = [...el.children].map(c => (c.innerText||'').length);
      const maxChildLen = Math.max(0, ...childLens);
      if (maxChildLen > ownLen * 0.9) continue; // dominated by child = wrapper, skip
      found.push({ tag: el.tagName, cls: (el.className||'').toString().substring(0,80), text: t.substring(0, 80) });
    }
    const seen = new Set();
    const dedup = found.filter(f => { const k = f.tag + ':' + f.text; if (seen.has(k)) return false; seen.add(k); return true; });
    return { stopBtn, bodyLen: document.body.innerText.length, stepCards: dedup.slice(0, 12) };
  })()
`);

const all = [];
let bestSnapshot = null;
const start = Date.now();
while (Date.now() - start < 40000) {
  await new Promise(r => setTimeout(r, 1500));
  const s = await snapshot();
  s.t = Math.round((Date.now() - start) / 1000);
  all.push(s);
  console.log(`t=${s.t}s stop=${s.stopBtn} bodyLen=${s.bodyLen} stepCards=${s.stepCards.length}`);
  if (s.stepCards.length > (bestSnapshot?.stepCards.length || 0)) bestSnapshot = s;
  if (!s.stopBtn && s.bodyLen > 300) break;
}

if (bestSnapshot) {
  console.log("\n=== Best snapshot (most step cards) ===");
  console.log(`t=${bestSnapshot.t}s, ${bestSnapshot.stepCards.length} cards`);
  console.log(JSON.stringify(bestSnapshot.stepCards, null, 2));
}
writeFileSync("/tmp/step-card-final.json", JSON.stringify({ all, bestSnapshot }, null, 2));
await client.close();
