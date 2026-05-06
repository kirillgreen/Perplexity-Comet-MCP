import CDP from "chrome-remote-interface";
const PORT = 9223;
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sidecar = targets.find(t => t.type === "page" && t.url.includes("/sidecar"));
const client = await CDP({ port: PORT, host: "127.0.0.1", target: sidecar.id });
await client.Runtime.enable();
const r = await client.Runtime.evaluate({ expression: `
  (() => {
    const el = document.querySelector('[contenteditable="true"]');
    return {
      inputContent: el ? el.innerText.substring(0, 200) : null,
      inputLen: el ? el.innerText.length : 0,
      isFocused: document.activeElement === el,
      activeElTag: document.activeElement?.tagName,
      activeElCls: (document.activeElement?.className || '').toString().substring(0, 60),
    };
  })()
`, returnByValue: true });
console.log("Input state:", JSON.stringify(r.result.value, null, 2));
await client.close();
