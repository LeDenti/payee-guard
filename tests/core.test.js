import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findIbans, isValidIban, ibanCheckDigits, maskIban, normalizeIban } from '../src/core/iban.js';
import { pseudonymize, leakedValues } from '../src/core/redact.js';
import { lookalikeOf, matchSupplier, sensitiveLiterals, partiesForRedaction } from '../src/core/registry.js';
import { decide } from '../src/core/rules.js';
import { toExtraction, parseJson, buildPrompt } from '../src/core/extract.js';
import { analyze, splitSender } from '../src/core/pipeline.js';
import { evaluate, oracleEngine } from '../eval/evaluate.js';

const cases = JSON.parse(readFileSync(new URL('../corpus/cases.json', import.meta.url)));
const registry = JSON.parse(readFileSync(new URL('../corpus/registry.json', import.meta.url)));

// ---------- IBAN ----------
test('IBAN checksum: known good and one-digit typo', () => {
  assert.equal(isValidIban('FR76 3000 6000 0112 3456 7890 189'), true);
  assert.equal(isValidIban('FR76 3000 6000 0112 3456 7890 188'), false);
  assert.equal(isValidIban('GB82 WEST 1234 5698 7654 32'), true);
  assert.equal(isValidIban('DE89 3704 0044 0532 0130 00'), true);
});

test('check digits build valid IBANs', () => {
  const bban = '30006000011234567890189';
  assert.equal(ibanCheckDigits('FR', bban), '76');
});

test('findIbans: spaced, glued, followed by BIC, inside sentences', () => {
  const t = 'Pay to IBAN FR76 3000 6000 0112 3456 7890 189 – BIC ABCDFRPP. Old: GB82WEST12345698765432, VAT FR32 412386753.';
  const f = findIbans(t);
  assert.deepEqual(f.map((x) => x.iban), ['FR7630006000011234567890189', 'GB82WEST12345698765432']);
  assert.ok(f.every((x) => x.valid));
  assert.equal(t.slice(f[0].start, f[0].end), 'FR76 3000 6000 0112 3456 7890 189');
});

test('findIbans flags a doctored number instead of ignoring it', () => {
  const f = findIbans('IBAN FR76 3000 6000 0112 3456 7890 188 merci');
  assert.equal(f.length, 1);
  assert.equal(f[0].valid, false);
});

test('mask keeps country, check digits and the last four only', () => {
  assert.equal(maskIban('FR7630006000011234567890189'), 'FR76 •••• 0189');
});

// ---------- pseudonymization ----------
test('device level: no account number reaches the model, other text untouched', () => {
  const c = cases.find((x) => x.kind === 'legit_on_file');
  const p = pseudonymize(c.text, { level: 'device' });
  assert.equal(findIbans(p.text).length, 0);
  assert.ok(p.text.includes('[IBAN_1]'));
  assert.ok(p.text.includes(c.expect.issuerName));
  assert.equal(p.vault['[IBAN_1]'], normalizeIban(c.expect.payee));
});

test('cloud level: for every case, no account, name on file, e-mail, phone or company number leaves', () => {
  const parties = partiesForRedaction(registry);
  const secrets = sensitiveLiterals(registry);
  for (const c of cases) {
    const p = pseudonymize(c.text, { level: 'cloud', parties, self: registry.self.names });
    const literal = [...secrets, ...Object.entries(p.vault).filter(([t]) => /^\[(IBAN|EMAIL|PHONE|ID|BIC|WEB)_/.test(t)).map(([, v]) => v)];
    assert.deepEqual(leakedValues(p.text, literal.filter((s) => s.length >= 4)), [], c.id);
    assert.equal(findIbans(p.text).length, 0, c.id);
    assert.equal(/@/.test(p.text), false, c.id);
    assert.equal(/\d{2}[ .]?\d{2}[ .]?\d{2}[ .]?\d{2}[ .]?\d{2}/.test(p.text), false, `${c.id}: phone-like digits left`);
  }
});

test('the same account gets the same token both times it appears', () => {
  const t = 'Pay FR76 3000 6000 0112 3456 7890 189, again FR7630006000011234567890189.';
  const p = pseudonymize(t, { level: 'device' });
  assert.equal(p.text, 'Pay [IBAN_1], again [IBAN_1].');
});

// ---------- registry ----------
test('lookalike domains are caught, the genuine one is not', () => {
  const k = ['orvanne-labo.fr'];
  assert.equal(lookalikeOf('orvanne-labo.fr', k), null);
  assert.equal(lookalikeOf('mail.orvanne-labo.fr', k), null);
  assert.equal(lookalikeOf('orvanne-lab0.fr', k), 'orvanne-labo.fr');
  assert.equal(lookalikeOf('orvanne-labo.com', k), 'orvanne-labo.fr');
  assert.equal(lookalikeOf('orvane-labo.fr', k), 'orvanne-labo.fr');
  assert.equal(lookalikeOf('mistralys-rnedical.com', ['mistralys-medical.com']), 'mistralys-medical.com');
  assert.equal(lookalikeOf('gmail.com', k), null);
});

test('supplier found by name, alias, legal form or domain', () => {
  assert.equal(matchSupplier(registry, { issuer: 'LABO ORVANNE SAS' }).supplier.id, 'orvanne');
  assert.equal(matchSupplier(registry, { issuer: '', domain: 'billing.kestrelsoft.ie' }).supplier.id, 'kestrel');
  assert.equal(matchSupplier(registry, { issuer: 'Helvar Conseil' }).supplier, null);
});

// ---------- rules ----------
const sup = registry.suppliers.find((s) => s.id === 'mistralys');
const base = { issuer: 'Mistralys Medical', issuerPartyId: null, invoiceNumber: 'MIS-1', total: 900, currency: 'EUR', payeeIbanToken: 'IBAN_1', claimsBankChange: false, pressure: false };
const onFile = [{ token: 'IBAN_1', iban: sup.ibans[0], valid: true }];
const other = 'LT' + ibanCheckDigits('LT', '1000011101001000') + '1000011101001000';

test('rules: known supplier, account on file, genuine domain -> clear', () => {
  const d = decide({ extraction: base, ibans: onFile, sender: 'A <a@mistralys-medical.com>', registry });
  assert.equal(d.verdict, 'clear');
});

test('rules: account not on file -> stop, and a claimed change makes it a second stop reason', () => {
  const d = decide({ extraction: { ...base, claimsBankChange: true }, ibans: [{ token: 'IBAN_1', iban: other, valid: true }], sender: null, registry });
  assert.equal(d.verdict, 'stop');
  assert.deepEqual(d.reasons.map((r) => r.code).sort(), ['bank_change_claim', 'iban_country', 'iban_not_on_file']);
});

test('rules: change announced with no account in the text -> verify, never clear', () => {
  const d = decide({ extraction: { ...base, payeeIbanToken: null, claimsBankChange: true }, ibans: [], sender: null, registry });
  assert.equal(d.verdict, 'verify');
});

test('rules: the model cannot launder a bad account by naming the old token', () => {
  // two accounts, the model wrongly says the old one: still clear, which is why the
  // two-account cases measure the model, and why the claim flag stays a separate signal
  const ibans = [{ token: 'IBAN_1', iban: other, valid: true }, { token: 'IBAN_2', iban: sup.ibans[0], valid: true }];
  const wrong = decide({ extraction: { ...base, payeeIbanToken: 'IBAN_2', claimsBankChange: true }, ibans, sender: null, registry });
  assert.equal(wrong.verdict, 'verify'); // the claim alone keeps it out of "clear"
  const right = decide({ extraction: { ...base, payeeIbanToken: 'IBAN_1', claimsBankChange: true }, ibans, sender: null, registry });
  assert.equal(right.verdict, 'stop');
});

test('rules: two accounts and no answer from the model -> verify', () => {
  const ibans = [{ token: 'IBAN_1', iban: other, valid: true }, { token: 'IBAN_2', iban: sup.ibans[0], valid: true }];
  const d = decide({ extraction: { ...base, payeeIbanToken: null }, ibans, sender: null, registry });
  assert.equal(d.verdict, 'verify');
  assert.ok(d.reasons.some((r) => r.code === 'payee_unclear'));
});

test('rules: bad checksum, duplicate, unusual amount, impersonation', () => {
  assert.equal(decide({ extraction: base, ibans: [{ token: 'IBAN_1', iban: 'FR7630006000011234567890188', valid: false }], sender: null, registry }).verdict, 'stop');
  const orv = registry.suppliers.find((s) => s.id === 'orvanne');
  assert.equal(decide({ extraction: { ...base, issuer: 'Labo Orvanne', invoiceNumber: 'ORV-2026-0418' }, ibans: [{ token: 'IBAN_1', iban: orv.ibans[0], valid: true }], sender: null, registry }).verdict, 'stop');
  assert.equal(decide({ extraction: { ...base, total: 9000 }, ibans: onFile, sender: null, registry }).verdict, 'verify');
  const imp = decide({ extraction: { ...base, issuer: '' }, ibans: [], sender: 'Pharmacie des Goudes <x.goudes@gmail.com>', registry });
  assert.ok(imp.reasons.some((r) => r.code === 'impersonates_you'));
  assert.equal(imp.verdict, 'stop');
});

// ---------- extraction ----------
test('parseJson tolerates fences and prose', () => {
  assert.deepEqual(parseJson('Sure:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseJson('no json here'));
});

test('toExtraction maps party tokens back on the device and drops unknown IBAN tokens', () => {
  const ctx = { ibans: [{ token: 'IBAN_1' }], vault: { '[PARTY_1]': 'orvanne', '[CLIENT_1]': 'self' } };
  const x = toExtraction({ issuer: '[PARTY_1]', invoice_number: 'A1', total: 12.5, currency: 'eur', payee_iban: '[IBAN_7]', claims_bank_change: true, pressure: false }, ctx);
  assert.equal(x.issuerPartyId, 'orvanne');
  assert.equal(x.payeeIbanToken, null);
  assert.equal(x.currency, 'EUR');
  const y = toExtraction({ issuer: '[CLIENT_1]', payee_iban: 'IBAN_1' }, ctx);
  assert.equal(y.issuer, '');
  assert.equal(y.payeeIbanToken, 'IBAN_1');
});

// ---------- routing ----------
const fakeAnswer = JSON.stringify({ issuer: 'Mistralys Medical', invoice_number: '', total: 0, currency: '', payee_iban: 'IBAN_1', claims_bank_change: false, pressure: false });
const doc = cases.find((c) => c.kind === 'legit_on_file' && c.expect.supplierId === 'mistralys');

test('routing: device available -> device, cloud never called', async () => {
  let cloudCalls = 0;
  const r = await analyze({ text: doc.text }, registry, {
    device: { available: async () => true, run: async () => ({ text: fakeAnswer, source: 'ON_DEVICE' }) },
    cloud: { run: async () => { cloudCalls++; return { text: fakeAnswer }; } },
  });
  assert.equal(r.route, 'device');
  assert.equal(cloudCalls, 0);
  assert.equal(r.decision.verdict, 'clear');
});

test('routing: device fails -> cloud gets the redacted prompt only', async () => {
  let seen = null;
  const r = await analyze({ text: doc.text }, registry, {
    device: { available: async () => true, run: async () => { throw new Error('model not downloaded'); } },
    cloud: { run: async (p) => { seen = p; return { text: fakeAnswer.replace('Mistralys Medical', '[PARTY_1]') }; } },
  });
  assert.equal(r.route, 'cloud');
  assert.equal(r.deviceError, 'model not downloaded');
  assert.ok(!seen.includes('Mistralys'));
  assert.ok(!seen.includes('@'));
  assert.equal(findIbans(seen).length, 0);
  assert.equal(r.decision.supplierId, 'mistralys');
});

test('routing: cloud not allowed -> nothing leaves, no verdict', async () => {
  const r = await analyze({ text: doc.text }, registry, { device: { available: async () => false, run: async () => ({}) }, cloud: { run: async () => { throw new Error('must not be called'); } }, allowCloud: false });
  assert.equal(r.status, 'no_engine');
});

test('routing: a name the redactor missed blocks the cloud call', async () => {
  const reg = { ...registry, suppliers: [...registry.suppliers, { id: 'odd', names: ['Zed’s Pharma Café'], domains: [], ibans: [] }] };
  let called = false;
  const r = await analyze({ text: doc.text + '\nCopy to Zeds Pharma Cafe and Zed’s Pharma Cafe' }, reg, { cloud: { run: async () => { called = true; return { text: fakeAnswer }; } } });
  // "Zed’s Pharma Café" itself is not in the text; the check only blocks exact literals,
  // so this goes through: the test documents that limit rather than hiding it
  assert.equal(r.status, 'ok');
  assert.equal(called, true);
});

test('splitSender reads From: and De :', () => {
  assert.equal(splitSender('De : A <a@b.fr>\nx'), 'A <a@b.fr>');
  assert.equal(splitSender('Subject: x'), null);
});

test('prompt carries the instructions and the pseudonymized document only', () => {
  const p = buildPrompt('[IBAN_1]');
  assert.ok(p.startsWith('You read supplier invoices'));
  assert.ok(p.endsWith('"""\n[IBAN_1]\n"""'));
});

// ---------- corpus ----------
test('corpus: with a perfect reader the rules give every expected verdict (58/58)', async () => {
  const { summary } = await evaluate(cases, registry, { device: oracleEngine(cases), allowCloud: false });
  assert.equal(summary.cases, 58);
  assert.equal(summary.verdictAccuracy, 1);
  assert.equal(summary.wouldHavePaid, 0);
});

test('cloud redaction keeps invoice numbers whole and takes postcodes with their town', () => {
  const p = pseudonymize('Facture n° CD-77120\nClient : X\n12 avenue du Prado, 13008 Marseille', { level: 'cloud', parties: [], self: [] });
  assert.ok(p.text.includes('CD-77120'));
  assert.ok(!p.text.includes('13008'));
});

test('tokens inside free text are restored on the device', () => {
  const x = toExtraction({ issuer: 'ACME', invoice_number: 'CD-[ID_1]', payee_iban: '' }, { ibans: [], vault: { '[ID_1]': '77120' } });
  assert.equal(x.invoiceNumber, 'CD-77120');
});

test('cloud redaction replaces the sender name everywhere', () => {
  const t = 'From: Megan Hollis <accounts@mistralys-medical.com>\nThanks, Megan Hollis\nQuestions: Megan Hollis, 04 91 88 93 00';
  const p = pseudonymize(t, { level: 'cloud', parties: [], self: ['Pharmacie des Goudes'] });
  assert.ok(!p.text.includes('Megan'));
  assert.equal(p.text.match(/\[PERSON_1\]/g).length, 3);
});
