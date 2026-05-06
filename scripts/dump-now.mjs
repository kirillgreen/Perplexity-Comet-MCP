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
      bodyLen: document.body.innerText.length,
      // take samples of first 3, middle 3, last 5 prose elements with parent context
      proseSample: (() => {
        const out = [];
        const indices = [0, 1, 2, Math.floor(proseEls.length/2), Math.floor(proseEls.length/2)+1, ...Array.from({length:8}, (_,i)=>proseEls.length-8+i)].filter(i => i >= 0 && i < proseEls.length);
        for (const i of [...new Set(indices)]) {
          const el = proseEls[i];
          out.push({
            i,
            cls: el.className.toString().substring(0, 100),
            parentCls: el.parentElement?.className?.toString().substring(0, 100),
            grandparentCls: el.parentElement?.parentElement?.className?.toString().substring(0, 100),
            insideButton: !!el.closest('button'),
            insideArticle: !!el.closest('article'),
            insideSection: !!el.closest('section'),
            textLen: el.innerText.length,
            text: el.innerText.substring(0, 200)
          });
        }
        return out;
      })(),
      bodyTail: document.body.innerText.substring(Math.max(0, document.body.innerText.length - 6000))
    };
  })()
`, returnByValue: true });
console.log(JSON.stringify(r.result.value, null, 2));
await client.close();
