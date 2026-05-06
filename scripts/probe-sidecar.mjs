#!/usr/bin/env node
import CDP from "chrome-remote-interface";

const PORT = 9223;

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
if (!sidecar) {
  console.error("No sidecar target. Targets:", targets.map(t => ({ type: t.type, url: t.url })));
  process.exit(1);
}
console.log("Sidecar target:", sidecar.id, sidecar.url);

const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();

const probe = async (label, expr) => {
  const { result, exceptionDetails } = await client.Runtime.evaluate({ expression: expr, returnByValue: true });
  console.log(`\n--- ${label} ---`);
  if (exceptionDetails) console.log("EXCEPTION:", exceptionDetails.text);
  else console.log(JSON.stringify(result.value, null, 2));
};

await probe("URL & title", `({ url: location.href, title: document.title })`);

await probe("Input candidates", `
  (() => {
    const inputs = [];
    for (const el of document.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      inputs.push({
        tag: el.tagName,
        contenteditable: el.getAttribute('contenteditable'),
        placeholder: el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('data-placeholder'),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        cls: (el.className || '').toString().substring(0, 80),
      });
    }
    return inputs;
  })()
`);

await probe("Buttons near input (potential submit)", `
  (() => {
    const out = [];
    for (const btn of document.querySelectorAll('button')) {
      if (btn.disabled || btn.offsetParent === null) continue;
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push({
        ariaLabel: btn.getAttribute('aria-label'),
        text: (btn.innerText || '').substring(0, 30),
        type: btn.getAttribute('type'),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      });
    }
    return out.slice(0, 20);
  })()
`);

await probe("Prose / response containers", `
  (() => {
    const proseEls = document.querySelectorAll('[class*="prose"]');
    return {
      proseCount: proseEls.length,
      first3: [...proseEls].slice(0, 3).map(el => ({
        cls: (el.className || '').toString().substring(0, 80),
        textPreview: el.innerText.substring(0, 80),
      })),
    };
  })()
`);

await probe("Mode / segmented control buttons", `
  (() => {
    const candidates = [];
    for (const btn of document.querySelectorAll('button[aria-label], [role="tab"]')) {
      const al = btn.getAttribute('aria-label');
      if (!al) continue;
      if (/search|research|labs|learn|computer|assistant/i.test(al)) {
        candidates.push({ ariaLabel: al, dataState: btn.getAttribute('data-state'), text: btn.innerText.substring(0, 40) });
      }
    }
    return candidates;
  })()
`);

await probe("Body innerText (first 800 chars)", `document.body.innerText.substring(0, 800)`);

await client.close();
