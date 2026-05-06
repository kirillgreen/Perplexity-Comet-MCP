#!/usr/bin/env node
// Submit a task to sidecar, then capture full DOM structure of every prose element
// (with parent chain) at multiple time points: just-submitted, mid-work, post-work.
import CDP from "chrome-remote-interface";
import { writeFileSync } from "fs";

const PORT = 9223;
const PROMPT = "Use your browser to open https://news.ycombinator.com and tell me the title of the top story on the front page. Just the title text, no other commentary.";

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();

const evalJs = async (expr) => {
  const r = await client.Runtime.evaluate({ expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

const snapshot = () => evalJs(`
  (() => {
    let stopBtn = false;
    for (const btn of document.querySelectorAll('button')) {
      const al = (btn.getAttribute('aria-label') || '').toLowerCase();
      const hasRect = btn.querySelector('svg rect') !== null;
      if ((al.includes('stop') || hasRect) && btn.offsetParent !== null && !btn.disabled) { stopBtn = true; break; }
    }
    // Detect consent dialog
    const consentText = ['Let Assistant control your browser', 'Allow Assistant', 'control your browser'];
    const hasConsentDialog = consentText.some(t => document.body.innerText.includes(t));
    const consentButton = (() => {
      for (const btn of document.querySelectorAll('button')) {
        const txt = (btn.innerText || '').toLowerCase().trim();
        if (txt === 'allow once' || txt === 'continue without controlling browser') {
          return { text: btn.innerText.trim(), visible: btn.offsetParent !== null };
        }
      }
      return null;
    })();
    // Catalog every prose element
    const proseEls = [...document.querySelectorAll('[class*="prose"]')];
    const catalog = proseEls.map((el, i) => {
      const ancestors = [];
      let p = el.parentElement;
      let depth = 0;
      while (p && depth < 5) {
        ancestors.push({
          tag: p.tagName,
          cls: (p.className || '').toString().substring(0, 80),
          role: p.getAttribute('role'),
          dataAttrs: Object.fromEntries([...p.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value]).slice(0, 3)),
        });
        p = p.parentElement;
        depth++;
      }
      const insideButton = !!el.closest('button');
      const insideStepCard = ancestors.some(a => /step|action-card|tool-call/i.test(a.cls || ''));
      const text = el.innerText.trim();
      return { i, len: text.length, sample: text.substring(0, 80), insideButton, insideStepCard, ownCls: (el.className || '').toString().substring(0, 100), ancestors };
    });
    return { stopBtn, hasConsentDialog, consentButton, proseCount: proseEls.length, catalog, bodyLen: document.body.innerText.length };
  })()
`);

// Submit the task
console.log("Step 1: Hard-clearing input and typing fresh prompt");
for (let i = 0; i < 15; i++) {
  const len = await evalJs(`
    (() => {
      const el = document.querySelector('[contenteditable="true"]');
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      return el.innerText.length;
    })()
  `);
  if (len <= 1) break;
}
await evalJs(`document.querySelector('[contenteditable="true"]').focus()`);
await client.Input.insertText({ text: PROMPT });
await new Promise(r => setTimeout(r, 400));
await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
console.log("Step 2: Submitted. Sampling DOM every 2s for up to 90s");

const snapshots = [];
const startTime = Date.now();
let lastBodyLen = -1;
let stableTicks = 0;
while (Date.now() - startTime < 90000) {
  await new Promise(r => setTimeout(r, 2000));
  const s = await snapshot();
  s.t = Math.round((Date.now() - startTime) / 1000);
  snapshots.push(s);
  const sig = `t=${s.t}s stopBtn=${s.stopBtn} consent=${s.hasConsentDialog} prose=${s.proseCount} bodyLen=${s.bodyLen}`;
  console.log(sig);
  if (!s.stopBtn && !s.hasConsentDialog) {
    if (s.bodyLen === lastBodyLen) stableTicks++;
    else { stableTicks = 0; lastBodyLen = s.bodyLen; }
    if (stableTicks >= 2 && s.bodyLen > 200) break;
  } else {
    stableTicks = 0;
    lastBodyLen = s.bodyLen;
  }
}

const out = { prompt: PROMPT, snapshots };
writeFileSync("/tmp/sidecar-snapshots.json", JSON.stringify(out, null, 2));
console.log(`\nSaved ${snapshots.length} snapshots to /tmp/sidecar-snapshots.json`);
console.log("Last snapshot summary:");
const last = snapshots[snapshots.length - 1];
console.log(`  stopBtn=${last.stopBtn} consent=${last.hasConsentDialog} prose=${last.proseCount} bodyLen=${last.bodyLen}`);
console.log("  prose-element length distribution:");
const lens = last.catalog.map(c => c.len).sort((a,b)=>a-b);
console.log(`    min=${lens[0]} median=${lens[Math.floor(lens.length/2)]} max=${lens[lens.length-1]}`);
console.log(`    insideButton: ${last.catalog.filter(c=>c.insideButton).length} of ${last.catalog.length}`);
console.log(`    insideStepCard (regex): ${last.catalog.filter(c=>c.insideStepCard).length} of ${last.catalog.length}`);

await client.close();
