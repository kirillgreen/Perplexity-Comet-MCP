import CDP from "chrome-remote-interface";
const PORT = 9223;
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
console.log("Sidecar URL:", sidecar.url);
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();

// Catalog top-of-panel buttons & icons (per screenshot, pencil + "...")
const r = await client.Runtime.evaluate({ expression: `
  (() => {
    const out = [];
    for (const btn of document.querySelectorAll('button, a[role="button"], [role="button"]')) {
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Focus on top-area buttons (y < 200) — the pencil/menu icons
      if (r.y > 250) continue;
      out.push({
        tag: btn.tagName,
        ariaLabel: btn.getAttribute('aria-label'),
        title: btn.getAttribute('title'),
        innerText: (btn.innerText || '').substring(0, 40),
        cls: (btn.className || '').toString().substring(0, 60),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        hasSvgPath: !!btn.querySelector('svg path'),
        svgD: btn.querySelector('svg path')?.getAttribute('d')?.substring(0, 80) || null,
      });
    }
    return out;
  })()
`, returnByValue: true });
console.log("Top-area buttons in sidecar:");
console.log(JSON.stringify(r.result.value, null, 2));
await client.close();
