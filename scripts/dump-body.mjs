import CDP from "chrome-remote-interface";
const PORT = 9223;
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();
const r = await client.Runtime.evaluate({ expression: `document.body.innerText`, returnByValue: true });
console.log(r.result.value);
await client.close();
