import CDP from "chrome-remote-interface";
const PORT = 9223;
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
console.log("Before — sidecar URL:", sidecar.url);
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();
const r = await client.Runtime.evaluate({ expression: `
  (() => {
    const btn = document.querySelector('button[aria-label="New thread (⌘K)"]');
    if (!btn) return { ok: false, reason: 'button not found' };
    btn.click();
    return { ok: true };
  })()
`, returnByValue: true });
console.log("Click result:", r.result.value);
// Wait for navigation
await new Promise(res => setTimeout(res, 1500));
const t2 = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar2 = t2.find(t => t.type === "page" && t.url.includes("/sidecar"));
console.log("After — sidecar URL:", sidecar2.url);
const r2 = await client.Runtime.evaluate({ expression: `
  (() => {
    const proseStr = document.querySelectorAll('[class*="prose-str"]').length;
    const inputContent = document.querySelector('[contenteditable="true"]')?.innerText.length;
    const heading = document.body.innerText.substring(0, 200);
    return { proseStrCount: proseStr, inputLen: inputContent, bodyHead: heading };
  })()
`, returnByValue: true });
console.log("State after click:");
console.log(JSON.stringify(r2.result.value, null, 2));
await client.close();
