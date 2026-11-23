import cases from '../../corpus/cases.json';
import registry from '../../corpus/registry.json';
import { evaluate } from '../../eval/evaluate.js';
import { baselineEngine } from '../core/baseline.js';
import { chromeNanoEngine, nanoStatus, nanoWarmUp } from './chrome-nano.js';

const $ = (id) => document.getElementById(id);
const show = async () => { $('status').textContent = await nanoStatus(); };
show();

$('warm').onclick = async () => {
  $('progress').textContent = 'Preparing the on-device model…';
  try {
    await nanoWarmUp((p) => { $('progress').textContent = `Downloading the model: ${Math.round(p * 100)} %`; });
    $('progress').textContent = 'Model ready.';
  } catch (e) { $('progress').textContent = 'Error: ' + (e?.message || e); }
  show();
};

async function run(label, engines) {
  $('out').textContent = '';
  const t0 = performance.now();
  const res = await evaluate(cases, registry, engines, (i, n, row) => {
    $('progress').textContent = `${label}: ${i}/${n}`;
    if (row.got !== row.expected) $('out').textContent += `MISS ${row.id} ${row.kind} expected ${row.expected} got ${row.got} ${row.reasons.join(',')} ${row.error || ''}\n`;
  });
  res.summary.engine = label;
  res.summary.totalSeconds = Math.round((performance.now() - t0) / 100) / 10;
  res.summary.userAgent = navigator.userAgent;
  res.summary.at = new Date().toISOString();
  window.__lastRun = res;
  // keep the run (verdicts, reasons, timings; no document text) as a file in results/
  const slim = { summary: res.summary, rows: res.rows.map(({ id, kind, lang, expected, got, status, route, source, ms, reasons, fields, error }) => ({ id, kind, lang, expected, got, status, route, source, ms, reasons, fields, error })) };
  fetch('/__save-result', { method: 'POST', body: JSON.stringify(slim) }).then((r) => r.text()).then((n) => { $('progress').textContent += ` · saved results/${n}`; }).catch(() => {});
  $('out').textContent += JSON.stringify(res.summary, null, 2);
}

$('run-nano').onclick = () => run('chrome-nano-direct', { device: chromeNanoEngine, allowCloud: false });
$('run-kw').onclick = () => run('keywords', { device: baselineEngine, allowCloud: false });

// Firebase engines load only when a config is present (.env.local, never committed).
$('run-fb-device').onclick = async () => {
  const { firebaseEngines } = await import('./firebase.js');
  const e = await firebaseEngines();
  run('firebase-only-on-device', { device: e.device, allowCloud: false });
};
$('run-fb-cloud').onclick = async () => {
  const { firebaseEngines } = await import('./firebase.js');
  const e = await firebaseEngines();
  // free tier: keep well under the per-minute request limit
  const gap = Number(new URLSearchParams(location.search).get('gap') ?? 4500);
  let lastCall = 0;
  // the wait happens before each case, outside the timed call, so latency stays the model's own
  const beforeEach = async () => {
    const wait = lastCall + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
  };
  run('firebase-cloud-redacted', { cloud: e.cloud, allowCloud: true, beforeEach });
};
