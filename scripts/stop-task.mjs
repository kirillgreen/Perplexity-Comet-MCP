import CDP from "chrome-remote-interface";
const PORT = 9223;
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();
await client.Runtime.evaluate({ expression: `
  (() => {
    for (const btn of document.querySelectorAll('button')) {
      const al = (btn.getAttribute('aria-label')||'').toLowerCase();
      if (al.includes('stop') || btn.querySelector('svg rect')) { btn.click(); return 'stopped'; }
    }
    return 'no stop btn';
  })()
` });
await client.close();
console.log("done");
