#!/usr/bin/env node
// control-window browser driver: drives the built Window extension in a
// dedicated Chrome-for-Testing instance over CDP. Zero dependencies (Node 22+:
// global fetch + WebSocket). All output goes to --out; stdout is a short log.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};
const PORT = opt('--port', '19222');
const EXT_ID = opt('--ext-id', '');
const OUT = opt('--out', '/tmp/window-verify-evidence');
const EXPECT = opt('--expect', '');
const BUTTON = opt('--button', '');
if (!EXT_ID) fail('missing --ext-id (run control-window launch first)');
const POS = [];
for (let i = 0; i < args.length; i++) {
  if (['--port', '--ext-id', '--out', '--expect', '--button'].includes(args[i])) { i++; continue; }
  POS.push(args[i]);
}
const [command, commandArg] = POS;

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function session(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => {
      let seq = 0; const pending = new Map();
      ws.addEventListener('message', (ev) => {
        let d; try { d = JSON.parse(ev.data); } catch { return; }
        if (d.id && pending.has(d.id)) {
          const p = pending.get(d.id); pending.delete(d.id);
          d.error ? p.reject(new Error(d.method + ': ' + JSON.stringify(d.error))) : p.resolve(d.result);
        }
      });
      ws.addEventListener('error', reject);
      resolve({
        close: () => ws.close(),
        call: (method, params = {}) => {
          const id = ++seq;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
            setTimeout(() => { pending.delete(id); rej(new Error('timeout ' + method)); }, 20000);
          });
        },
      });
    });
    ws.addEventListener('error', reject);
  });
}

async function openSurface(page) {
  // page: "popup" | "options#learning" | "blocked?blocked=example.com"
  // The fragment/query always belongs after index.html, never inside the path.
  let name = page, suffix = '';
  const hash = page.indexOf('#'), query = page.indexOf('?');
  const cut = hash === -1 ? query : query === -1 ? hash : Math.min(hash, query);
  if (cut !== -1) { name = page.slice(0, cut); suffix = page.slice(cut); }
  if (!name) fail(`bad surface ${JSON.stringify(page)}`);
  const url = `chrome-extension://${EXT_ID}/src/${name}/index.html${suffix}`;
  const created = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).then((r) => {
    if (!r.ok) throw new Error('cannot open tab: HTTP ' + r.status);
    return r.json();
  });
  const s = await session(created.webSocketDebuggerUrl);
  await s.call('Page.enable');
  await s.call('Page.navigate', { url });
  return s;
}

async function bodyText(s) {
  const r = await s.call('Runtime.evaluate', { expression: 'document.body ? document.body.innerText : ""', returnByValue: true });
  return r.result.value ?? '';
}

async function axSnapshot(s) {
  const r = await s.call('Runtime.evaluate', {
    expression: `(() => {
      const out = [];
      for (const el of document.querySelectorAll('h1,h2,h3,button,a,input,[role]')) {
        const name = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g,' ').slice(0,80);
        out.push(el.tagName.toLowerCase() + (el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : '') + ' :: ' + name);
      }
      return out.join('\\n');
    })()`,
    returnByValue: true,
  });
  return r.result.value ?? '';
}

async function waitFor(s, predicate, timeoutMs, label) {
  const t0 = Date.now();
  for (;;) {
    const text = await bodyText(s);
    if (predicate(text)) return text;
    if (Date.now() - t0 > timeoutMs) fail(`timed out waiting for ${label}; last text:\n${text.slice(0, 500)}`);
    await sleep(500);
  }
}

async function shot(s, file) {
  const r = await s.call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
}

async function readState(s) {
  const r = await s.call('Runtime.evaluate', {
    expression: `Promise.all([
      new Promise((res) => chrome.runtime.sendMessage({type:'GET_STATE'}, (r) => res(r))),
      chrome.declarativeNetRequest.getDynamicRules().then((rules) => rules.map((x) => x.id)),
    ]).then(([state, dnrDynamicRules]) => JSON.stringify({ state, dnrDynamicRules }))`,
    awaitPromise: true, returnByValue: true,
  });
  return JSON.parse(r.result.value);
}

mkdirSync(OUT, { recursive: true });

if (command === 'resolve') {
  const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
  for (const t of targets.filter((x) => x.type === 'service_worker' && x.url.startsWith('chrome-extension://'))) {
    try {
      const s = await session(t.webSocketDebuggerUrl);
      const r = await s.call('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().name', returnByValue: true });
      const id = new URL(t.url).hostname;
      s.close();
      if (r.result.value === 'Window') { console.log(id); process.exit(0); }
    } catch { /* keep scanning */ }
  }
  fail('Window service worker not found on port ' + PORT);
} else if (command === 'snapshot') {
  const page = commandArg || 'popup';
  const s = await openSurface(page).catch(fail);
  const text = await waitFor(s, (t) => t.length > 0 && !/Loading popup|Loading…/.test(t), 60000, 'surface render');
  writeFileSync(join(OUT, 'snapshot.txt'), text);
  writeFileSync(join(OUT, 'ax.txt'), await axSnapshot(s));
  await shot(s, join(OUT, 'page.png'));
  console.log(`snapshot ${page}: ${text.length} chars, ${(await axSnapshot(s)).split('\n').length} handles`);
  s.close();
} else if (command === 'state') {
  const s = await openSurface('popup').catch(fail);
  await waitFor(s, (t) => t.length > 0 && !/Loading popup/.test(t), 60000, 'popup render');
  const { state, dnrDynamicRules } = await readState(s);
  writeFileSync(join(OUT, 'state.json'), JSON.stringify({ extId: EXT_ID, at: new Date().toISOString(), snoozeState: state.snoozeState, calendarState: { isRestricted: state.calendarState.isRestricted, allowedDomains: state.calendarState.allowedDomains, currentEvent: state.calendarState.currentEvent, activeRuleSource: state.calendarState.activeRuleSource, activeRuleName: state.calendarState.activeRuleName }, learningState: { userTopics: state.learningState?.userTopics, reviewQueueLength: state.learningState?.reviewQueue?.length }, dnrDynamicRules }, null, 2));
  console.log(`state: snooze=${state.snoozeState.active} restricted=${state.calendarState.isRestricted} dnr=${JSON.stringify(dnrDynamicRules)}`);
  s.close();
} else if (command === 'click') {
  const page = commandArg || 'popup';
  if (!BUTTON) fail('click needs --button "<text>"');
  const s = await openSurface(page).catch(fail);
  await waitFor(s, (t) => t.includes(BUTTON), 60000, `button ${BUTTON}`);
  await shot(s, join(OUT, 'before.png'));
  writeFileSync(join(OUT, 'before.txt'), await bodyText(s));
  const r = await s.call('Runtime.evaluate', {
    expression: `(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.textContent||'').includes(${JSON.stringify(BUTTON)})); if(!b) return 'NOTFOUND'; b.click(); return 'CLICKED'; })()`,
    returnByValue: true,
  });
  if (r.result.value !== 'CLICKED') fail(`button ${BUTTON} vanished before click`);
  console.log(`clicked ${BUTTON}`);
  if (EXPECT) {
    const text = await waitFor(s, (t) => t.includes(EXPECT), 60000, `result ${EXPECT}`);
    writeFileSync(join(OUT, 'snapshot.txt'), text);
  } else {
    await sleep(3000);
    writeFileSync(join(OUT, 'snapshot.txt'), await bodyText(s));
  }
  writeFileSync(join(OUT, 'ax.txt'), await axSnapshot(s));
  await shot(s, join(OUT, 'after.png'));
  const { state, dnrDynamicRules } = await readState(s);
  writeFileSync(join(OUT, 'state.json'), JSON.stringify({ snoozeState: state.snoozeState, points: state.allTimeStats?.totalPoints, dnrDynamicRules }, null, 2));
  console.log(`after: snooze=${state.snoozeState.active} dnr=${JSON.stringify(dnrDynamicRules)}`);
  s.close();
} else if (command === 'end-break') {
  const s = await openSurface('popup').catch(fail);
  await waitFor(s, (t) => t.length > 0 && !/Loading popup/.test(t), 60000, 'popup render');
  await s.call('Runtime.evaluate', {
    expression: `new Promise((res) => chrome.runtime.sendMessage({type:'END_SNOOZE'}, res))`,
    awaitPromise: true, returnByValue: true,
  });
  const { state } = await readState(s);
  writeFileSync(join(OUT, 'state-after-end.json'), JSON.stringify({ snoozeState: state.snoozeState }, null, 2));
  console.log(`break ended: snooze=${state.snoozeState.active}`);
  if (state.snoozeState.active) fail('break still active after END_SNOOZE');
  s.close();
} else {
  fail(`unknown command ${command} (want snapshot|state|click|end-break)`);
}
