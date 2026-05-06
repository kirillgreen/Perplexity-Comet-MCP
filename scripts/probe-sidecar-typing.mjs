#!/usr/bin/env node
// Test multiple typing strategies for sidecar's Lexical-style contenteditable
import CDP from "chrome-remote-interface";

const PORT = 9223;
const PROMPT = "What is 7 times 8?";

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();
await client.Input.enable?.();

const evalJs = async (expr) => {
  const { result, exceptionDetails } = await client.Runtime.evaluate({ expression: expr, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
};

const readInput = () => evalJs(`
  (() => {
    const el = document.querySelector('[contenteditable="true"]');
    return { text: el?.innerText, hasFocus: document.activeElement === el };
  })()
`);

// Clear & focus
await evalJs(`
  (() => {
    const el = document.querySelector('[contenteditable="true"]');
    el.focus();
    // Clear via select-all + delete
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    return el.innerText;
  })()
`);
console.log("After clear:", await readInput());

console.log("\n--- Strategy A: Input.insertText (CDP) ---");
await client.Input.insertText({ text: PROMPT });
await new Promise(r => setTimeout(r, 300));
console.log("After insertText:", await readInput());

// Clear again
await evalJs(`
  (() => {
    const el = document.querySelector('[contenteditable="true"]');
    el.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
  })()
`);

console.log("\n--- Strategy B: Input.dispatchKeyEvent char-by-char ---");
for (const ch of PROMPT) {
  await client.Input.dispatchKeyEvent({ type: "char", text: ch });
}
await new Promise(r => setTimeout(r, 300));
console.log("After char loop:", await readInput());

// Clear
await evalJs(`
  (() => {
    const el = document.querySelector('[contenteditable="true"]');
    el.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
  })()
`);

console.log("\n--- Strategy C: paste via Input.dispatchKeyEvent + clipboard ---");
// Set clipboard text via Browser.grantPermissions + navigator.clipboard
// Simpler: dispatch a 'paste' event with synthetic clipboardData
await evalJs(`
  (() => {
    const el = document.querySelector('[contenteditable="true"]');
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', ${JSON.stringify(PROMPT)});
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()
`);
await new Promise(r => setTimeout(r, 300));
console.log("After paste event:", await readInput());

await client.close();
