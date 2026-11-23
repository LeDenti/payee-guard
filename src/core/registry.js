// The supplier registry: who you pay, from which domains they write, and the
// bank accounts you have already verified. It lives on the device.

import { normalizeIban } from './iban.js';

const LEGAL = /\b(sas|sasu|sarl|sa|eurl|sci|selarl|ltd|limited|llc|inc|gmbh|bv|srl|spa|plc|co|company|group|groupe)\b/g;

export function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(LEGAL, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Registrable part of a domain: "billing.calanque-pharma.fr" -> "calanque-pharma.fr". */
export function baseDomain(d) {
  const parts = String(d || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length >= 3 && ['co', 'com', 'org', 'gov', 'ac'].includes(parts[parts.length - 2])) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

export function senderDomain(sender) {
  const m = String(sender || '').match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  return m ? m[1].toLowerCase() : null;
}

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent swaps). */
export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const HOMOGLYPHS = [[/rn/g, 'm'], [/vv/g, 'w'], [/0/g, 'o'], [/1/g, 'l'], [/l/g, 'i'], [/5/g, 's']];
const skeleton = (s) => HOMOGLYPHS.reduce((x, [re, r]) => x.replace(re, r), s);
const label = (d) => d.split('.')[0];

/**
 * Is `domain` dressed up as one of `known`? Returns the imitated domain or null.
 * Catches one- or two-letter edits, swapped letters, rn/m and 0/o tricks, the same
 * name under another extension, and the real name with a word bolted on.
 */
export function lookalikeOf(domain, known) {
  const d = baseDomain(domain);
  for (const k0 of known) {
    const k = baseDomain(k0);
    if (d === k) return null; // genuine
  }
  for (const k0 of known) {
    const k = baseDomain(k0);
    const dl = label(d), kl = label(k);
    if (dl === kl) return k; // same name, other extension
    if (skeleton(dl) === skeleton(kl)) return k;
    if (kl.length >= 5 && editDistance(dl, kl) <= (kl.length >= 10 ? 2 : 1)) return k;
    if (kl.length >= 6 && dl.includes(kl)) return k; // calanque-pharma-billing.com
  }
  return null;
}

/** Find the supplier by name (or pseudonym id) and by sender domain. */
export function matchSupplier(registry, { issuer, partyId, domain }) {
  const sup = registry.suppliers || [];
  if (partyId) {
    const s = sup.find((x) => x.id === partyId);
    if (s) return { supplier: s, by: 'name' };
  }
  const n = normName(issuer);
  if (n.length >= 3) {
    for (const s of sup) {
      for (const name of s.names) {
        const m = normName(name);
        if (m === n || (m.length >= 5 && n.includes(m)) || (n.length >= 5 && m.includes(n))) return { supplier: s, by: 'name' };
      }
    }
  }
  if (domain) {
    const b = baseDomain(domain);
    const s = sup.find((x) => (x.domains || []).some((k) => baseDomain(k) === b));
    if (s) return { supplier: s, by: 'domain' };
  }
  return { supplier: null, by: null };
}

export function ibanOnFile(supplier, iban) {
  const n = normalizeIban(iban);
  return (supplier?.ibans || []).some((x) => normalizeIban(x) === n);
}

/** Every name the user keeps on file: what the cloud must not see. */
export function partiesForRedaction(registry) {
  return (registry.suppliers || []).map((s) => ({ id: s.id, names: s.names }));
}

/** Every sensitive literal in the registry, to assert nothing leaks. */
export function sensitiveLiterals(registry) {
  const out = [];
  for (const s of registry.suppliers || []) out.push(...(s.ibans || []), ...(s.names || []), ...(s.domains || []));
  out.push(...(registry.self?.names || []));
  return out;
}
