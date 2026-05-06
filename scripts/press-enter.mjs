import CDP from "chrome-remote-interface";
const PORT = 9223;
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();
// Force focus first
await client.Runtime.evaluate({ expression: `document.querySelector('[contenteditable="true"]').focus()` });
await new Promise(r => setTimeout(r, 200));
console.log("Pressing Enter...");
await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await new Promise(r => setTimeout(r, 1000));
const r2 = await client.Runtime.evaluate({ expression: `
  (() => {
    const el = document.querySelector('[contenteditable="true"]');
    let stopBtn = false;
    for (const btn of document.querySelectorAll('button')) {
      const al = (btn.getAttribute('aria-label') || '').toLowerCase();
      const hasRect = btn.querySelector('svg rect') !== null;
      if ((al.includes('stop') || hasRect) && btn.offsetParent !== null && !btn.disabled) { stopBtn = true; break; }
    }
    return { inputLen: el?.innerText.length, stopBtn };
  })()
`, returnByValue: true });
console.log("After Enter:", JSON.stringify(r2.result.value));
await client.close();
