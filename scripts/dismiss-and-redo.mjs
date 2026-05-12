import CDP from "chrome-remote-interface";
import { writeFileSync } from "fs";

const PORT = 9223;
const PROMPT = "Use your browser to open https://news.ycombinator.com and tell me the title of the very top story. Just the title text.";

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();

const evalJs = async (expr) => {
  const r = await client.Runtime.evaluate({ expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

// Dismiss consent if up
await evalJs(`
  (() => {
    for (const btn of document.querySelectorAll('button')) {
      const t = (btn.innerText || '').trim().toLowerCase();
      if (t === 'continue without controlling browser' || t.includes('without controlling')) {
        btn.click();
        return 'dismissed';
      }
    }
    return 'no dialog';
  })()
`);
await new Promise(r => setTimeout(r, 1500));

// New thread
await evalJs(`
  (() => { const b = document.querySelector('button[aria-label*="New thread"]'); if (b) b.click(); })()
`);
await new Promise(r => setTimeout(r, 1500));

// Type + submit new prompt to ycombinator (cached grant)
await evalJs(`document.querySelector('[contenteditable="true"]').focus()`);
await client.Input.insertText({ text: PROMPT });
await new Promise(r => setTimeout(r, 400));
await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });

console.log("Submitted to ycombinator. Probing for step-card structure mid-work...\n");

const snapshot = () => evalJs(`
  (() => {
    let stopBtn = false;
    for (const btn of document.querySelectorAll('button')) {
      const al = (btn.getAttribute('aria-label') || '').toLowerCase();
      const hasRect = btn.querySelector('svg rect') !== null;
      if ((al.includes('stop') || hasRect) && btn.offsetParent !== null && !btn.disabled) { stopBtn = true; break; }
    }
    // Find any element whose innerText starts with one of the step keywords AND has dropdown chevron
    const stepKeywords = ['Navigating', 'Reading', 'Clicking', 'Interacting', 'Searching', 'Analyzing', 'Opening', 'Reviewing', 'Preparing', 'Typing', 'Found', 'Visiting', 'Looking'];
    const found = [];
    for (const el of document.querySelectorAll('*')) {
      const t = (el.innerText || '').trim();
      if (t.length === 0 || t.length > 200) continue;
      // First word is one of step keywords?
      const firstWord = t.split(/\s+/)[0];
      if (stepKeywords.includes(firstWord)) {
        // Capture parent chain
        const chain = [];
        let p = el;
        for (let i = 0; i < 4 && p; i++) { chain.push({ tag: p.tagName, cls: (p.className||'').toString().substring(0,60) }); p = p.parentElement; }
        found.push({ tag: el.tagName, cls: (el.className||'').toString().substring(0,80), text: t.substring(0, 80), chain });
      }
    }
    // Dedup by text
    const seen = new Set();
    const dedup = found.filter(f => { if (seen.has(f.text)) return false; seen.add(f.text); return true; });
    return { stopBtn, bodyLen: document.body.innerText.length, stepCards: dedup.slice(0, 12) };
  })()
`);

const all = [];
const start = Date.now();
let lastBodyLen = 0;
let stableTicks = 0;
let savedFirstStepSnapshot = false;
while (Date.now() - start < 60000) {
  await new Promise(r => setTimeout(r, 2000));
  const s = await snapshot();
  s.t = Math.round((Date.now() - start) / 1000);
  all.push(s);
  console.log(`t=${s.t}s stop=${s.stopBtn} bodyLen=${s.bodyLen} stepCards=${s.stepCards.length}`);
  if (s.stepCards.length > 0 && !savedFirstStepSnapshot) {
    console.log("\n=== First step-card-rich snapshot ===");
    console.log(JSON.stringify(s.stepCards, null, 2));
    savedFirstStepSnapshot = true;
  }
  if (!s.stopBtn) {
    if (s.bodyLen === lastBodyLen) stableTicks++;
    else { stableTicks = 0; lastBodyLen = s.bodyLen; }
    if (stableTicks >= 2 && s.bodyLen > 200) break;
  }
}

writeFileSync("/tmp/step-card-probe.json", JSON.stringify(all, null, 2));
console.log(`\nSaved ${all.length} snapshots`);
await client.close();
