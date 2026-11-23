// Runs the labelled cases through the full pipeline with a given engine and
// scores it. Works in Node and in the browser (no Node imports).

import { analyze } from '../src/core/pipeline.js';
import { normalizeIban } from '../src/core/iban.js';

/** A reader that answers exactly what the label says: tests the rules, not a model. */
export function oracleEngine(cases) {
  const byText = new Map(cases.map((c) => [c.text, c]));
  return {
    name: 'oracle',
    run: async (prompt) => {
      // find the case whose pseudonymized text is in the prompt, through the vault-free fields
      const c = [...byText.values()].find((k) => prompt.includes(k.text.split('\n')[1] ?? '\u0000') && prompt.includes(k.text.slice(-12)));
      if (!c) throw new Error('oracle: case not found');
      const tokens = [...prompt.matchAll(/\[(IBAN_\d+)\]/g)].map((m) => m[1]);
      const order = [...new Set(tokens)];
      // IBAN tokens are numbered in order of appearance; map the expected payee to its token
      const ibansInText = [...c.text.matchAll(/[A-Z]{2}\d{2}(?:[ ][A-Z0-9]{1,4}){2,8}/g)].map((m) => normalizeIban(m[0]));
      const uniq = [...new Set(ibansInText)];
      const idx = c.expect.payee ? uniq.indexOf(normalizeIban(c.expect.payee)) : -1;
      return {
        text: JSON.stringify({
          issuer: c.expect.issuerName || '',
          invoice_number: c.expect.invoiceNumber || '',
          total: c.expect.total || 0,
          currency: '',
          payee_iban: idx >= 0 && order[idx] ? order[idx] : '',
          claims_bank_change: c.expect.claim,
          pressure: c.expect.pressure,
        }),
        source: 'ORACLE',
      };
    },
  };
}

const FRAUD = (c) => c.expect.verdict === 'stop';

/**
 * @param {object[]} cases
 * @param {object} registry
 * @param {object} engines  passed to analyze()
 * @param {(i:number, n:number, r:object)=>void} [onProgress]
 */
export async function evaluate(cases, registry, engines, onProgress) {
  const rows = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    let r;
    if (engines.beforeEach) await engines.beforeEach();
    try { r = await analyze({ text: c.text }, registry, engines); } catch (e) { r = { status: 'error', error: String(e?.message || e) }; }
    const got = r.decision?.verdict ?? 'error';
    const row = {
      id: c.id, kind: c.kind, lang: c.lang, expected: c.expect.verdict, got, status: r.status, route: r.route, source: r.source, ms: r.ms,
      reasons: r.decision?.reasons.map((x) => x.code) || [],
      fields: r.extraction ? {
        supplier: (r.decision.supplierId || null) === (c.expect.supplierId || null),
        payee: (r.decision.payeeIban || null) === (c.expect.payee ? normalizeIban(c.expect.payee) : null) || (!c.expect.payee && !r.decision.payeeIban),
        claim: r.extraction.claimsBankChange === c.expect.claim,
        pressure: r.extraction.pressure === c.expect.pressure,
      } : null,
      error: r.error || (r.status !== 'ok' ? r.status : undefined),
    };
    rows.push(row);
    onProgress?.(i + 1, cases.length, row);
  }
  return { rows, summary: summarize(rows, cases) };
}

export function summarize(rows, cases) {
  const n = rows.length;
  const ok = rows.filter((r) => r.got === r.expected).length;
  const frauds = rows.filter((r, i) => FRAUD(cases[i]));
  const legit = rows.filter((r) => r.expected === 'clear');
  const unsafe = rows.filter((r) => r.expected !== 'clear' && r.got === 'clear'); // would have paid
  const field = (k) => { const f = rows.filter((r) => r.fields); return f.length ? f.filter((r) => r.fields[k]).length / f.length : null; };
  const ms = rows.map((r) => r.ms).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  const sources = rows.reduce((m, r) => ((m[r.source || r.status] = (m[r.source || r.status] || 0) + 1), m), {});
  return {
    cases: n,
    verdictAccuracy: ok / n,
    fraudsStopped: frauds.filter((r) => r.got === 'stop').length + '/' + frauds.length,
    wouldHavePaid: unsafe.length,
    wouldHavePaidIds: unsafe.map((r) => r.id),
    legitCleared: legit.filter((r) => r.got === 'clear').length + '/' + legit.length,
    fieldAccuracy: { supplier: field('supplier'), payee: field('payee'), claim: field('claim'), pressure: field('pressure') },
    medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : null,
    sources,
    errors: rows.filter((r) => r.error).length,
  };
}
