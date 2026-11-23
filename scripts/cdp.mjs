// Minimal Chrome DevTools Protocol client for the measurement Chrome
// (started with --remote-debugging-port=9333 and its own profile).
//   node scripts/cdp.mjs eval '<expression>' [urlPart]   evaluate in the page, with a user gesture
//   node scripts/cdp.mjs open '<url>'                    open a new tab
//   node scripts/cdp.mjs shot '<file.png>' [urlPart]     screenshot of the page
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9333;
const [cmd, arg, urlPart = '127.0.0.1:5194'] = process.argv.slice(2);

async function target() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const t = list.find((x) => x.type === 'page' && x.url.includes(urlPart));
  if (!t) throw new Error(`no page matching ${urlPart}: ${list.map((x) => x.url).join(', ')}`);
  return t;
}

function session(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  const ready = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ready, send, close: () => ws.close() };
}

if (cmd === 'open') {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(arg)}`, { method: 'PUT' });
  console.log((await r.json()).url);
} else {
  const t = await target();
  const s = session(t.webSocketDebuggerUrl);
  await s.ready;
  if (cmd === 'eval') {
    const r = await s.send('Runtime.evaluate', { expression: arg, awaitPromise: true, userGesture: true, returnByValue: true, timeout: 600000 });
    const v = r.result?.result?.value;
    console.log(r.result?.exceptionDetails ? 'EXCEPTION ' + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text) : typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  } else if (cmd === 'shot') {
    const r = await s.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
    console.log(arg);
  }
  s.close();
}
