// A keyword reader with no model at all, kept as the yardstick: the language
// model has to beat this to earn its place.

const CHANGE = [
  /new (bank|banking|account|iban)/i, /bank (details|account|information) (have |has )?(changed|been updated)/i,
  /changed? (our|its) bank/i, /updated? (our )?(bank|banking) details/i,
  /nouvel(le)?s? (coordonn[ée]es bancaires|rib|iban|compte)/i, /changement de (banque|rib|coordonn[ée]es)/i,
  /coordonn[ée]es bancaires ont (chang[ée]|[ée]t[ée] modifi[ée]es)/i,
];
const PRESSURE = [
  /\burgent(ly)?\b/i, /\bimmediately\b/i, /\btoday\b/i, /\bconfidential\b/i, /do not (call|contact)/i,
  /\burgence\b/i, /\bimm[ée]diatement\b/i, /aujourd'hui/i, /\bconfidentiel(le)?\b/i, /ne (pas )?(nous )?(appeler|contacter)/i,
];

export function baselineExtract(pseudoText) {
  const issuerLine = (pseudoText.match(/^\s*(?:From|De)\s*:\s*([^<\n]+)/im) || [])[1]
    || pseudoText.split('\n').map((l) => l.trim()).find((l) => l.length > 2) || '';
  const inv = (pseudoText.match(/(?:invoice|facture)\s*(?:no\.?|n[°o]\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{3,})/i) || [])[1] || '';
  const tot = (pseudoText.match(/(?:total|amount due|montant|net à payer|total ttc)[^\d\n]{0,20}([\d\s.,]+)/i) || [])[1] || '';
  const total = tot ? parseFloat(tot.replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) : 0;
  const tokens = [...pseudoText.matchAll(/\[(IBAN_\d+)\]/g)].map((m) => m[1]);
  return {
    issuer: issuerLine.trim(),
    invoice_number: inv,
    total: Number.isFinite(total) ? total : 0,
    currency: /€|EUR/.test(pseudoText) ? 'EUR' : /£|GBP/.test(pseudoText) ? 'GBP' : '',
    payee_iban: tokens.length ? tokens[tokens.length - 1] : '',
    claims_bank_change: CHANGE.some((r) => r.test(pseudoText)),
    pressure: PRESSURE.some((r) => r.test(pseudoText)),
  };
}

/** Same interface as a model engine. */
export const baselineEngine = {
  name: 'keywords',
  available: async () => true,
  run: async (prompt) => {
    const doc = prompt.split('Document:\n"""\n')[1]?.replace(/\n"""$/, '') ?? prompt;
    return { text: JSON.stringify(baselineExtract(doc)), source: 'KEYWORDS' };
  },
};
