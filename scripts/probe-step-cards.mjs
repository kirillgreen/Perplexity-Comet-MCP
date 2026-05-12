#!/usr/bin/env node
// Submit a task, probe sidecar mid-work to find what step-card DOM looks like.
import CDP from "chrome-remote-interface";
import { writeFileSync } from "fs";

const PORT = 9223;
const PROMPT = "Use your browser to open https://example.com and tell me the heading. Just the heading.";

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();

const evalJs = async (expr) => {
  const r = await client.Runtime.evaluate({ expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

// New thread
await evalJs(`
  (() => { const b = document.querySelector('button[aria-label*="New thread"]'); if (b) b.click(); })()
`);
await new Promise(r => setTimeout(r, 1500));

// Type + submit
await evalJs(`document.querySelector('[contenteditable="true"]').focus()`);
await client.Input.insertText({ text: PROMPT });
await new Promise(r => setTimeout(r, 400));
await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });

console.log("Submitted. Probing every 2s for 60s...\n");

const snapshot = () => evalJs(`
  (() => {
    let stopBtn = false;
    for (const btn of document.querySelectorAll('button')) {
      const al = (btn.getAttribute('aria-label') || '').toLowerCase();
      const hasRect = btn.querySelector('svg rect') !== null;
      if ((al.includes('stop') || hasRect) && btn.offsetParent !== null && !btn.disabled) { stopBtn = true; break; }
    }
    // Catalog candidate "step" containers — anything with section-header-ish text
    const candidates = [];
    // Look at the page structure for elements containing keywords
    const stepKeywords = ['Navigating', 'Reading', 'Clicking', 'Interacting', 'Searching', 'Analyzing', 'Opening', 'Reviewing', 'Preparing'];
    const allEls = document.querySelectorAll('div, section, article, h1, h2, h3, h4, span, p');
    for (const el of allEls) {
      const t = (el.innerText || '').trim();
      if (t.length === 0 || t.length > 100) continue;
      // Only direct text — skip if children would dominate
      const ownText = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ');
      const hasOwnText = ownText.length > 0;
      for (const kw of stepKeywords) {
        if (t === kw || t.startsWith(kw)) {
          candidates.push({
            tag: el.tagName,
            cls: (el.className || '').toString().substring(0, 80),
            text: t.substring(0, 80),
            hasOwnText,
            role: el.getAttribute('role'),
            parentCls: (el.parentElement?.className || '').toString().substring(0, 80),
            parentTag: el.parentElement?.tagName,
          });
          break;
        }
      }
    }
    return { stopBtn, bodyLen: document.body.innerText.length, candidates: candidates.slice(0, 15) };
  })()
`);

const all = [];
const start = Date.now();
let lastBodyLen = 0;
let stableTicks = 0;
while (Date.now() - start < 60000) {
  await new Promise(r => setTimeout(r, 2000));
  const s = await snapshot();
  s.t = Math.round((Date.now() - start) / 1000);
  all.push(s);
  console.log(`t=${s.t}s stop=${s.stopBtn} bodyLen=${s.bodyLen} candidates=${s.candidates.length}`);
  if (s.candidates.length > 0 && all.length === 1) {
    console.log("First step-card sample:");
    console.log(JSON.stringify(s.candidates.slice(0, 3), null, 2));
  }
  if (!s.stopBtn) {
    if (s.bodyLen === lastBodyLen) stableTicks++;
    else { stableTicks = 0; lastBodyLen = s.bodyLen; }
    if (stableTicks >= 2 && s.bodyLen > 200) break;
  } else {
    stableTicks = 0;
    lastBodyLen = s.bodyLen;
  }
}

writeFileSync("/tmp/step-card-probe.json", JSON.stringify(all, null, 2));
console.log(`\nSaved ${all.length} snapshots to /tmp/step-card-probe.json`);

// Print best mid-work snapshot's candidates
const midWork = all.find(s => s.stopBtn && s.candidates.length > 0);
if (midWork) {
  console.log("\nMid-work step-card candidates:");
  console.log(JSON.stringify(midWork.candidates, null, 2));
} else {
  console.log("\nNo mid-work step-card candidates found via keyword scan.");
}

await client.close();
