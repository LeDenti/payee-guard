// Reversible pseudonymization. The text that reaches a model carries tokens
// ([IBAN_1], [PARTY_2], ...); the vault that maps tokens back stays in this
// process and is never sent anywhere.
//
// Two levels:
//   device : bank numbers only. The on-device model does not need digits, so it
//            never sees them either.
//   cloud  : bank numbers, BIC, e-mail addresses, web domains, phone numbers,
//            company and VAT numbers, postcodes, and every name the user has on
//            file (their suppliers, their own business).

import { findIbans } from './iban.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} text
 * @param {{ level: 'device'|'cloud', parties?: {id:string,names:string[]}[], self?: string[] }} opts
 * @returns {{ text: string, vault: Record<string,string>, ibans: {token:string, iban:string, valid:boolean}[], counts: Record<string,number> }}
 */
export function pseudonymize(text, opts) {
  const level = opts.level;
  const vault = {};
  const counts = {};
  const seen = new Map(); // original -> token, so a repeated value gets the same token
  const tok = (kind, original) => {
    const key = kind + '\u0000' + original;
    if (seen.has(key)) return seen.get(key);
    counts[kind] = (counts[kind] || 0) + 1;
    const t = `[${kind}_${counts[kind]}]`;
    seen.set(key, t);
    vault[t] = original;
    return t;
  };

  // 1. IBANs, always. Replace from the end so offsets stay right.
  const found = findIbans(text);
  const ibans = [];
  let out = text;
  const byIban = new Map();
  for (const f of found) {
    if (!byIban.has(f.iban)) byIban.set(f.iban, tok('IBAN', f.iban));
  }
  for (const f of [...found].reverse()) out = out.slice(0, f.start) + byIban.get(f.iban) + out.slice(f.end);
  for (const f of found) {
    const token = byIban.get(f.iban).slice(1, -1);
    if (!ibans.some((x) => x.token === token)) ibans.push({ token, iban: f.iban, valid: f.valid });
  }

  if (level === 'cloud') {
    // 2. e-mail addresses, then bare web domains
    out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => tok('EMAIL', m));
    out = out.replace(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|fr|eu|net|org|io|de|it|es|lt|co\.uk|uk|be|nl|pt|ie|lu|ch)\b(?:\/\S*)?/gi,
      (m) => tok('WEB', m));
    // 3. BIC / SWIFT (8 or 11 characters, after the word BIC or SWIFT)
    out = out.replace(/\b(BIC|SWIFT)(\s*(?:code)?\s*[:：]?\s*)([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/g,
      (_, w, sep, code) => w + sep + tok('BIC', code));
    // 4. company and VAT numbers
    out = out.replace(/\b[A-Z]{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{3}\b/g, (m) => tok('ID', m)); // FR VAT
    out = out.replace(/\b\d{3}\s?\d{3}\s?\d{3}(?:\s?\d{5})?\b/g, (m) => tok('ID', m)); // SIREN / SIRET
    // 5. phone numbers: + or 0, then 9 to 14 digits with separators
    out = out.replace(/(?<![\w\d])(?:\+\d{1,3}[\s.-]?)?(?:\(0\)\s?)?0?\d(?:[\s.-]?\d{2}){4,5}(?![\w\d])/g,
      (m) => (m.replace(/\D/g, '').length >= 9 ? tok('PHONE', m.trim()) : m));
    // 6a. the sender's own name, read from the From: line, wherever it appears (signature, contact line)
    const from = text.match(/^\s*(?:From|De|Expéditeur)\s*:\s*([^<\n]+?)\s*</im);
    const person = from ? from[1].replace(/["']/g, '').trim() : '';
    const isOwnName = (opts.self || []).some((n) => person.toLowerCase().includes(n.toLowerCase()));
    if (person.split(/\s+/).length >= 2 && person.length >= 5 && !isOwnName) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(person)}(?![\\p{L}\\p{N}])`, 'giu');
      out = out.replace(re, () => tok('PERSON', person));
    }
    // 6b. names on file, longest first so "Calanque Pharma Distribution" wins over "Calanque"
    const names = [];
    for (const p of opts.parties || []) for (const n of p.names) names.push({ n, kind: 'PARTY', id: p.id });
    for (const n of opts.self || []) names.push({ n, kind: 'CLIENT', id: 'self' });
    names.sort((a, b) => b.n.length - a.n.length);
    for (const { n, kind, id } of names) {
      if (n.length < 3) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'giu');
      out = out.replace(re, () => {
        const t = tok(kind, id);
        return t;
      });
    }
    // 7. postcodes (FR five digits, UK outward + inward)
    // a postcode stands alone and is followed by a town on the same line ("13008 Marseille"),
    // never glued to a dash or letters as in an invoice number like CD-77120
    out = out.replace(/(?<![\p{L}\p{N}\-\/])\d{5}(?![\p{N}\-\/])(?=[ \t]+[A-ZÀ-Ý][a-zà-ÿ])/gu, (m) => tok('POSTCODE', m));
    out = out.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g, (m) => tok('POSTCODE', m));
  }

  return { text: out, vault, ibans, counts };
}

/** Values that must never appear in a payload bound for the cloud. */
export function leakedValues(payload, sensitive) {
  const flat = payload.replace(/[\s -]/g, '').toUpperCase();
  return sensitive.filter((v) => v && flat.includes(String(v).replace(/[\s -]/g, '').toUpperCase()));
}
