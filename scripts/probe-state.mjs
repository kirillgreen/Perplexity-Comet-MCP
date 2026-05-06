import CDP from "chrome-remote-interface";
const PORT = 9223;
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();
const r = await client.Runtime.evaluate({ expression: `
  (() => {
    let stopBtn = false;
    for (const btn of document.querySelectorAll('button')) {
      const al = (btn.getAttribute('aria-label') || '').toLowerCase();
      const hasRect = btn.querySelector('svg rect') !== null;
      if ((al.includes('stop') || hasRect) && btn.offsetParent !== null && !btn.disabled) { stopBtn = true; break; }
    }
    const proseEls = [...document.querySelectorAll('[class*="prose"]')];
    return {
      stopBtn,
      proseCount: proseEls.length,
      proseTexts: proseEls.map(el => el.innerText.substring(0, 60)),
      bodyLen: document.body.innerText.length,
      tail: document.body.innerText.substring(Math.max(0, document.body.innerText.length - 500))
    };
  })()
`, returnByValue: true });
console.log(JSON.stringify(r.result.value, null, 2));
await client.close();
