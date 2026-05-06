import CDP from "chrome-remote-interface";
const PORT = 9223;
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();
const r = await client.Runtime.evaluate({ expression: `
  (() => {
    const stopBtns = [];
    for (const btn of document.querySelectorAll('button')) {
      const al = (btn.getAttribute('aria-label') || '').toLowerCase();
      const hasRect = btn.querySelector('svg rect') !== null;
      const visible = btn.offsetParent !== null && !btn.disabled;
      if ((al.includes('stop') || al.includes('cancel') || hasRect) && visible) {
        stopBtns.push({ ariaLabel: btn.getAttribute('aria-label'), text: btn.innerText.substring(0,30), hasRect, rect: btn.getBoundingClientRect() });
      }
    }
    const consentText = /Let Assistant control your browser|Allow Assistant to control/i.test(document.body.innerText);
    let allowOnceVisible = false;
    for (const btn of document.querySelectorAll('button')) {
      const t = (btn.innerText || '').trim().toLowerCase();
      if (t === 'allow once' && btn.offsetParent !== null && !btn.disabled) { allowOnceVisible = true; break; }
    }
    const proseStrCount = document.querySelectorAll('[class*="prose-str"]').length;
    const proseStrTexts = [...document.querySelectorAll('[class*="prose-str"]')].slice(-3).map(el => ({ len: el.innerText.length, sample: el.innerText.substring(0, 80) }));
    return {
      detectedStopBtns: stopBtns,
      consentTextPresent: consentText,
      allowOnceButtonVisible: allowOnceVisible,
      proseStrCount,
      proseStrLastFew: proseStrTexts,
    };
  })()
`, returnByValue: true });
console.log(JSON.stringify(r.result.value, null, 2));
await client.close();
