import cases from '../../corpus/cases.json';
import seedRegistry from '../../corpus/registry.json';
import { analyze, splitSender } from '../core/pipeline.js';
import { maskIban } from '../core/iban.js';
import { baselineEngine } from '../core/baseline.js';
import { chromeNanoEngine, nanoStatus, nanoWarmUp } from './chrome-nano.js';
import { firebaseConfigured, firebaseEngines, CLOUD_MODEL } from './firebase.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- state kept on this device ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('pg.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pg.' + k, JSON.stringify(v)); } catch { /* private mode: keep in memory */ } },
};
let registry = store.get('registry', structuredClone(seedRegistry));
let journal = store.get('journal', []);

// ---------- sample inbox: one of each situation, all invented ----------
const PICK = ['legit_on_file', 'fraud_change_plain', 'fraud_lookalike', 'fraud_two_accounts', 'fraud_soft_no_iban', 'fraud_bad_checksum', 'duplicate', 'new_supplier', 'impersonates_owner', 'legit_no_iban'];
const samples = [];
for (const k of PICK) for (const lang of ['en', 'fr']) {
  const c = cases.find((x) => x.kind === k && x.lang === lang);
  if (c && samples.filter((s) => s.kind === k).length < (k === 'legit_on_file' ? 2 : 1)) samples.push(c);
}
let current = null;
let last = null;

function subject(text) { return (text.match(/^\s*(?:Subject|Objet)\s*:\s*(.+)$/im) || [])[1] || text.split('\n').find((l) => l.trim()) || 'Pasted document'; }
function fromName(text) { return (splitSender(text) || 'Pasted document').replace(/<.*$/, '').trim(); }

function renderInbox() {
  $('docs').innerHTML = samples.map((c, i) => `<li data-i="${i}" class="${current === c ? 'on' : ''}">
    <div class="from">${esc(fromName(c.text))}${c.result ? `<span class="tag ${c.result}">${c.result}</span>` : ''}</div>
    <div class="subj">${esc(subject(c.text))}</div><div class="dom">${esc((splitSender(c.text) || '').match(/@([^>\s]+)/)?.[1] || '')}</div></li>`).join('');
  for (const li of $('docs').querySelectorAll('li')) li.onclick = () => open(samples[Number(li.dataset.i)]);
  $('supcount').textContent = `(${registry.suppliers.length})`;
  $('suppliers').innerHTML = registry.suppliers.map((s) => `<li><b>${esc(s.names[0])}</b> · ${esc(s.domains.join(', '))}<br>${s.ibans.map((x) => esc(maskIban(x))).join(', ')}</li>`).join('');
}

function open(c) {
  current = c;
  $('text').value = c.text;
  $('doc-title').textContent = 'Document';
  clearVerdict();
  renderInbox();
}

function clearVerdict() {
  $('verdict').className = 'verdict-card empty';
  $('verdict').innerHTML = 'Press <b>Check before paying</b>.';
  $('reasons').innerHTML = '';
  $('where').innerHTML = '';
  $('seen-box').hidden = true;
  $('actions').hidden = true;
}

// ---------- engines ----------
let engines = null;
let engineLabel = '';
async function setupEngines() {
  if (firebaseConfigured()) {
    const fb = await firebaseEngines();
    engines = { device: fb.device, cloud: fb.cloud, prepare: fb.prepareDevice, kind: 'firebase' };
  } else {
    engines = { device: chromeNanoEngine, cloud: null, prepare: nanoWarmUp, kind: 'direct' };
  }
  await refreshEngineBadge();
}

async function refreshEngineBadge() {
  const st = await nanoStatus();
  const el = $('engine');
  if (st === 'available') { el.className = 'engine device'; engineLabel = 'On-device model ready (Gemini Nano)'; }
  else if (st === 'downloadable' || st === 'downloading') {
    el.className = 'engine';
    engineLabel = st === 'downloading' || downloading
      ? 'Gemini Nano downloading · redacted cloud copy meanwhile'
      : 'Gemini Nano not downloaded yet · first check starts it, cloud (redacted) meanwhile';
  }
  else { el.className = 'engine cloud'; engineLabel = engines?.cloud ? 'No on-device model: redacted cloud fallback' : 'No on-device model'; }
  if (engines?.kind === 'direct') engineLabel += ' · Firebase not configured';
  el.textContent = engineLabel;
  return st;
}

let downloading = false;
function startBackgroundDownload() {
  if (downloading) return;
  downloading = true;
  const el = $('engine');
  el.className = 'engine';
  el.textContent = 'Downloading Gemini Nano in the background…';
  Promise.resolve()
    .then(() => engines.prepare((p) => { el.textContent = `Downloading Gemini Nano in the background: ${Math.round((p || 0) * 100)} %`; }))
    .catch(() => { /* stays on the cloud fallback */ })
    .finally(() => { downloading = false; refreshEngineBadge(); });
}

// ---------- check ----------
async function check() {
  const text = $('text').value.trim();
  if (!text) return;
  $('check').disabled = true;
  $('verdict').className = 'verdict-card empty';
  $('verdict').textContent = 'Reading…';
  try {
    const st = await refreshEngineBadge();
    // Never make the user wait for the one-time model download (several GB): start it in the
    // background (a click is the user gesture Chrome asks for) and read this document now,
    // through the redacted cloud copy if allowed. Later checks run on the device once it is ready.
    if (st === 'downloadable' && engines.prepare) startBackgroundDownload();
    const useCloud = $('allow-cloud').checked && engines.cloud;
    let r = await analyze({ text }, registry, { device: engines.device, cloud: useCloud ? engines.cloud : null, allowCloud: Boolean(useCloud) });
    let fallbackNote = '';
    if (r.route === 'cloud' && (downloading || (await nanoStatus()) === 'downloading')) {
      fallbackNote = 'Gemini Nano is downloading in the background (one time, about 4 GB); until it is ready, checks use this redacted cloud copy. Then they run on your device.';
    }
    if (r.status === 'no_engine') {
      r = await analyze({ text }, registry, { device: baselineEngine, allowCloud: false });
      r.route = 'keywords';
      const st2 = await nanoStatus();
      fallbackNote = (st2 === 'downloading' ? 'The on-device model is still downloading and the cloud fallback is off or not configured, ' : 'No model is available here, ')
        + 'so this was read by the keyword reader, which misses reworded fraud.';
    }
    last = { r, text };
    render(r, fallbackNote);
    if (current && current.text === text) { current.result = r.decision?.verdict; renderInbox(); }
  } catch (e) {
    $('verdict').className = 'verdict-card empty';
    $('verdict').textContent = 'Error: ' + (e?.message || e);
  } finally {
    $('check').disabled = false;
  }
}

const TITLE = { clear: 'Clear to pay', verify: 'Verify first', stop: 'Do not pay' };
const SUB = {
  clear: 'Pay to the account already on file.',
  verify: 'Call the supplier on a number you already had, then decide.',
  stop: 'Do not pay this document as it stands.',
};

function render(r, note) {
  if (r.status === 'refused_leak') {
    $('verdict').className = 'verdict-card stop';
    $('verdict').innerHTML = `<span class="big">Not sent</span>The redacted copy still contained ${r.leaks} sensitive value(s), so nothing left the device.`;
    return;
  }
  if (r.status !== 'ok') {
    $('verdict').className = 'verdict-card empty';
    $('verdict').textContent = 'The model answer could not be read (' + r.status + ').';
    return;
  }
  const d = r.decision;
  $('verdict').className = 'verdict-card ' + d.verdict;
  $('verdict').innerHTML = `<span class="big">${TITLE[d.verdict]}</span>${SUB[d.verdict]}`;
  $('reasons').innerHTML = d.reasons.filter((x) => x.code !== 'pay_on_file' || d.verdict === 'clear')
    .map((x) => `<li><span class="sev ${x.severity}">${x.severity}</span>${esc(x.text)}</li>`).join('') || '<li>No warning sign.</li>';
  const where = r.route === 'device'
    ? `Read <b class="device">on this device</b> by Gemini Nano (SDK reports ${esc(r.source)}). Account numbers were replaced by tokens before the model saw the text.`
    : r.route === 'cloud'
      ? `Read <b class="cloud">in the cloud</b> by Gemini ${esc(CLOUD_MODEL)} (SDK reports ${esc(r.source)}) on a <b>redacted</b> copy: accounts, names on file, e-mails, phones, company numbers and postcodes were replaced by tokens on this device first.`
      : esc(note);
  const extra = note && r.route !== 'keywords' ? ` <br><span class="fine">${esc(note)}</span>` : '';
  $('where').innerHTML = `${where} ${r.ms} ms.${r.deviceError ? ' On-device error: ' + esc(r.deviceError) : ''}${extra}`;
  $('seen').textContent = r.sent ? (r.sent.split('Document:\n"""\n')[1] || r.sent).replace(/\n"""$/, '') : '';
  $('seen-box').hidden = !r.sent;
  $('actions').hidden = false;
  $('actions').querySelector('[data-act="verified"]').hidden = !(d.supplierId && d.payeeIban && d.reasons.some((x) => x.code === 'iban_not_on_file'));
}

function act(kind) {
  if (!last?.r?.decision) return;
  const d = last.r.decision;
  const x = last.r.extraction;
  if (kind === 'paid' && d.supplierId && x.invoiceNumber) registry.paid.push({ supplierId: d.supplierId, invoiceNumber: x.invoiceNumber });
  if (kind === 'verified' && d.supplierId && d.payeeIban) {
    const s = registry.suppliers.find((y) => y.id === d.supplierId);
    if (s && !s.ibans.includes(d.payeeIban)) s.ibans.push(d.payeeIban);
  }
  journal.unshift({ at: new Date().toISOString(), doc: subject(last.text), verdict: d.verdict, action: kind, read: last.r.route, account: d.payeeIban ? maskIban(d.payeeIban) : null });
  store.set('registry', registry);
  store.set('journal', journal);
  renderJournal();
  renderInbox();
  $('actions').hidden = true;
}

function renderJournal() {
  $('journal').innerHTML = journal.slice(0, 30).map((j) => `<li>${esc(j.at.slice(0, 16).replace('T', ' '))} · ${esc(j.doc)} · verdict <b>${esc(j.verdict)}</b> · you: <b>${esc(j.action)}</b>${j.account ? ' · ' + esc(j.account) : ''}</li>`).join('')
    + (journal.length ? '' : '<li>No decision yet.</li>');
}

$('reset').onclick = (e) => {
  e.preventDefault();
  registry = structuredClone(seedRegistry); journal = [];
  store.set('registry', registry); store.set('journal', journal);
  for (const s of samples) delete s.result;
  renderJournal(); renderInbox(); clearVerdict();
};

$('check').onclick = check;
$('paste').onclick = () => { current = null; $('text').value = ''; $('text').focus(); clearVerdict(); renderInbox(); };
for (const b of $('actions').querySelectorAll('button')) b.onclick = () => act(b.dataset.act);

renderInbox();
renderJournal();
open(samples[0]);
setupEngines().catch((e) => { $('engine').textContent = 'Engine error: ' + (e?.message || e); });
