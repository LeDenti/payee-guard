// IBAN detection, validation and masking. Pure code, no model involved:
// an IBAN carries its own checksum (ISO 13616, mod 97), so a machine can
// read it exactly. The language model never needs to see the digits.

/** Expected IBAN length per country (ISO 13616 registry, SEPA area and a few more). */
export const IBAN_LENGTHS = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20,
  ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26,
  IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28,
  PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27, VA: 22, AE: 23, TR: 26, UA: 29,
};

/** Remove spaces and dashes, upper-case. */
export function normalizeIban(s) {
  return String(s).replace(/[\s  -]/g, '').toUpperCase();
}

/** ISO 7064 mod 97-10 check on a normalized IBAN. */
export function ibanChecksumOk(iban) {
  const s = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

/** True when the country is known and the length matches. */
export function ibanLengthOk(iban) {
  const s = normalizeIban(iban);
  const len = IBAN_LENGTHS[s.slice(0, 2)];
  return len !== undefined && s.length === len;
}

export function isValidIban(iban) {
  return ibanLengthOk(iban) && ibanChecksumOk(iban);
}

/** Two check digits that make `country + ?? + bban` valid. Used to build test data. */
export function ibanCheckDigits(country, bban) {
  const moved = normalizeIban(bban) + country.toUpperCase() + '00';
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return String(98 - rem).padStart(2, '0');
}

const SEP = /[   -]/;
const ALNUM = /[A-Za-z0-9]/;

/**
 * Find IBAN-like strings in free text.
 * Returns [{ start, end, raw, iban, valid }]: `valid` is false for a string that
 * looks like an IBAN of a known country and length but fails the checksum
 * (a typo, or a doctored number: both must stop a payment).
 */
export function findIbans(text) {
  const out = [];
  const re = /(?<![A-Za-z0-9])([A-Z]{2})[  ]?(\d{2})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const country = m[1];
    const len = IBAN_LENGTHS[country];
    if (!len) continue;
    let i = m.index + m[0].length;
    let got = country + m[2];
    let lastEnd = i;
    while (got.length < len && i < text.length) {
      const ch = text[i];
      if (ALNUM.test(ch)) { got += ch.toUpperCase(); i++; lastEnd = i; continue; }
      // one separator allowed between groups
      if (SEP.test(ch) && i + 1 < text.length && ALNUM.test(text[i + 1]) && !SEP.test(text[i - 1])) { i++; continue; }
      break;
    }
    if (got.length !== len) continue;
    // the IBAN must end at a word boundary: no letter or digit glued after it
    if (lastEnd < text.length && ALNUM.test(text[lastEnd])) continue;
    out.push({ start: m.index, end: lastEnd, raw: text.slice(m.index, lastEnd), iban: got, valid: ibanChecksumOk(got) });
    re.lastIndex = lastEnd;
  }
  return out;
}

/** FR76 •••• … 0189 : country, check digits and the last four. */
export function maskIban(iban) {
  const s = normalizeIban(iban);
  return `${s.slice(0, 4)} •••• ${s.slice(-4)}`;
}
