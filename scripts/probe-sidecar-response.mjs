#!/usr/bin/env node
import CDP from "chrome-remote-interface";

const PORT = 9223;
const PROMPT = "What is 7 times 8? Reply with just the number.";

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
if (!sidecar) { console.error("No sidecar"); process.exit(1); }

const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();

const evalJs = async (expr) => {
  const { result, exceptionDetails } = await client.Runtime.evaluate({ expression: expr, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
};

console.log("Typing prompt...");
const typed = await evalJs(`
  (() => {
    const el = document.querySelector('[contenteditable="true"]');
    if (!el) return { ok: false, reason: 'no input' };
    el.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, ${JSON.stringify(PROMPT)});
    return { ok: true, text: el.innerText };
  })()
`);
console.log("Typed:", typed);

await new Promise(r => setTimeout(r, 400));

console.log("Pressing Enter...");
await evalJs(`
  (() => {
    const el = document.querySelector('[contenteditable="true"]');
    el.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
      }));
    }
    return true;
  })()
`);

console.log("Polling for response markers every 1.5s for up to 30s...\n");

const probeNow = async () => evalJs(`
  (() => {
    const out = {
      bodyLen: document.body.innerText.length,
      bodyTail: document.body.innerText.substring(Math.max(0, document.body.innerText.length - 500)),
      proseCount: document.querySelectorAll('[class*="prose"]').length,
      markdownCount: document.querySelectorAll('[class*="markdown"]').length,
      messageCount: document.querySelectorAll('[class*="message"]').length,
      answerCount: document.querySelectorAll('[class*="answer"]').length,
      thinking: document.body.innerText.includes('Thinking'),
      hasStopBtn: false,
      stopBtnAriaLabel: null,
      hasSpinner: !!document.querySelector('[class*="animate-spin"], [class*="animate-pulse"]'),
      anyContentBlocks: [],
    };
    for (const btn of document.querySelectorAll('button')) {
      const al = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (al.includes('stop') || al.includes('cancel') || btn.querySelector('svg rect')) {
        if (btn.offsetParent !== null && !btn.disabled) {
          out.hasStopBtn = true;
          out.stopBtnAriaLabel = btn.getAttribute('aria-label');
          break;
        }
      }
    }
    // Find any non-trivial text blocks (potential answers)
    const allEls = document.querySelectorAll('div, p, span, article, section');
    const candidates = [];
    for (const el of allEls) {
      const text = el.innerText || '';
      if (text.length < 5 || text.length > 500) continue;
      // Skip if it has children with the same length text (we want leaf-ish blocks)
      const hasNestedSimilar = [...el.children].some(c => (c.innerText || '').length > text.length * 0.9);
      if (hasNestedSimilar) continue;
      if (text.includes('Type /') || text.includes('Ask anything') || text.includes('Assistant')) continue;
      candidates.push({
        tag: el.tagName,
        cls: (el.className || '').toString().substring(0, 60),
        text: text.substring(0, 100),
      });
    }
    out.anyContentBlocks = candidates.slice(0, 10);
    return out;
  })()
`);

let last = "";
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 1500));
  const probe = await probeNow();
  const summary = `t=${(i+1)*1.5}s prose=${probe.proseCount} md=${probe.markdownCount} msg=${probe.messageCount} ans=${probe.answerCount} thinking=${probe.thinking} stop=${probe.hasStopBtn}(${probe.stopBtnAriaLabel || ''}) spinner=${probe.hasSpinner} bodyLen=${probe.bodyLen}`;
  if (summary !== last) {
    console.log(summary);
    last = summary;
  }
  if (probe.bodyLen > 200 && !probe.hasStopBtn && !probe.hasSpinner && !probe.thinking) {
    console.log("\n--- Settled. Final state ---");
    console.log("Body tail (last 500 chars):");
    console.log(probe.bodyTail);
    console.log("\nContent block candidates:");
    for (const c of probe.anyContentBlocks) console.log(`  [${c.tag}.${c.cls}] ${c.text}`);
    break;
  }
}

await client.close();
