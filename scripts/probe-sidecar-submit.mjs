#!/usr/bin/env node
import CDP from "chrome-remote-interface";

const PORT = 9223;
const PROMPT = "Reply with just the digit: what is 6+7?";

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();

const evalJs = async (expr) => {
  const { result, exceptionDetails } = await client.Runtime.evaluate({ expression: expr, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
};

// HARD clear — keep deleting until input is truly empty
console.log("Hard-clearing input...");
for (let i = 0; i < 15; i++) {
  const cleared = await evalJs(`
    (() => {
      const el = document.querySelector('[contenteditable="true"]');
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      return el.innerText.length;
    })()
  `);
  if (cleared <= 1) break;
}
console.log("Input length after clear:", await evalJs(`document.querySelector('[contenteditable="true"]').innerText.length`));

console.log("\nFocusing and inserting prompt via CDP Input.insertText...");
await evalJs(`document.querySelector('[contenteditable="true"]').focus()`);
await client.Input.insertText({ text: PROMPT });
await new Promise(r => setTimeout(r, 500));
const beforeSubmit = await evalJs(`document.querySelector('[contenteditable="true"]').innerText`);
console.log("Input contents:", JSON.stringify(beforeSubmit));

console.log("\nPressing Enter via CDP Input.dispatchKeyEvent...");
// Native Enter via CDP — most authentic
await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });

await new Promise(r => setTimeout(r, 500));
const afterEnter = await evalJs(`document.querySelector('[contenteditable="true"]').innerText`);
console.log("Input after Enter:", JSON.stringify(afterEnter));

console.log("\nPolling response state every 2s for 60s...\n");
const probe = () => evalJs(`
  (() => {
    return {
      bodyLen: document.body.innerText.length,
      proseCount: document.querySelectorAll('[class*="prose"]').length,
      mdCount: document.querySelectorAll('[class*="markdown"], .markdown-block').length,
      msgCount: document.querySelectorAll('[role="article"], [class*="MessageBubble"], [class*="message-bubble"], [class*="ChatMessage"]').length,
      hasStop: !!document.querySelector('button[aria-label*="Stop" i], button[aria-label*="Cancel" i]'),
      hasSpinner: !!document.querySelector('[class*="animate-spin"], [class*="animate-pulse"]'),
      thinking: document.body.innerText.toLowerCase().includes('thinking'),
      // Try to identify likely response containers — divs with substantial text not in nav/aside
      contentBlocks: (() => {
        const out = [];
        for (const el of document.querySelectorAll('main div, article, [class*="answer"], [class*="response"], [class*="content"]')) {
          if (el.closest('nav,aside,header,footer,form,button')) continue;
          const t = (el.innerText || '').trim();
          if (t.length < 8 || t.length > 600) continue;
          // Skip if has child with >90% same text
          const child = [...el.children].find(c => (c.innerText || '').length > t.length * 0.9);
          if (child) continue;
          out.push({ cls: (el.className || '').toString().substring(0, 70), text: t.substring(0, 120) });
        }
        return out.slice(0, 6);
      })(),
      bodyTail: document.body.innerText.substring(Math.max(0, document.body.innerText.length - 400))
    };
  })()
`);

let lastBodyLen = 0;
let lastSig = "";
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const p = await probe();
  const sig = `prose=${p.proseCount} md=${p.mdCount} msg=${p.msgCount} stop=${p.hasStop} spin=${p.hasSpinner} think=${p.thinking} bodyLen=${p.bodyLen}`;
  if (sig !== lastSig) {
    console.log(`t=${(i+1)*2}s ${sig}`);
    lastSig = sig;
  }
  if (p.bodyLen > 200 && p.bodyLen === lastBodyLen && !p.hasStop && !p.hasSpinner && !p.thinking) {
    console.log("\nSettled. Final state:");
    console.log("Body tail:", p.bodyTail);
    console.log("\nContent blocks:");
    for (const b of p.contentBlocks) console.log(`  [.${b.cls}] ${b.text}`);
    break;
  }
  lastBodyLen = p.bodyLen;
}

await client.close();
