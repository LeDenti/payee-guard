// What we ask the model, and how its answer is checked before the rules see it.
// The model only reads language: who is writing, which account token is the one
// to pay, whether the text announces new bank details or pushes for haste.
// It never sees an account number, and nothing it says is trusted unchecked.

export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    issuer: { type: 'string', description: 'Company that issued the invoice or wrote the message, exactly as written (may be a token like [PARTY_1]). Empty if unknown.' },
    invoice_number: { type: 'string', description: 'Invoice number as written. Empty if none.' },
    total: { type: 'number', description: 'Total amount to pay, as a plain number. 0 if none.' },
    currency: { type: 'string', description: 'ISO currency code such as EUR, GBP or USD. Empty if none.' },
    payee_iban: { type: 'string', description: 'The token of the bank account the reader is asked to pay, like IBAN_2. Empty if none.' },
    claims_bank_change: { type: 'boolean', description: 'True if the text says bank details, account, or bank have changed or that a new or different account must be used from now on.' },
    pressure: { type: 'boolean', description: 'True if the text pushes to pay urgently, today, before a deadline with a threat, or asks for secrecy or to avoid the usual contact.' },
  },
  required: ['issuer', 'invoice_number', 'total', 'currency', 'payee_iban', 'claims_bank_change', 'pressure'],
};

export const INSTRUCTIONS = `You read supplier invoices and payment e-mails for a small business, in English or French.
Bank accounts were replaced by tokens like [IBAN_1]; names may be tokens like [PARTY_1] or [CLIENT_1]. Keep tokens exactly as written.
[CLIENT_*] is the reader's own business, never the issuer.
Answer with JSON only, following the schema. Do not guess: use an empty string, 0 or false when the text does not say.
- issuer: the company that sends the invoice or the message.
- payee_iban: the token of the account the reader must pay now. If the text says an old account must no longer be used, give the new one.
- claims_bank_change: true for any statement that the bank details, the bank or the account changed, or that payments must go to a new or different account.
- pressure: true for urgency (today, immediately, final notice with a threat), or requests for discretion or to avoid the usual contact.`;

export function buildPrompt(pseudoText) {
  return `${INSTRUCTIONS}\n\nDocument:\n"""\n${pseudoText}\n"""`;
}

/** Pull the first JSON object out of a model answer (models sometimes wrap it in fences). */
export function parseJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  const s = String(raw || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object in model answer');
  return JSON.parse(s.slice(a, b + 1));
}

const TOKEN = /\[?([A-Z]+_\d+)\]?/;

/**
 * Check and normalize the model answer, and map tokens back on the device.
 * @param {object|string} raw
 * @param {{ ibans: {token:string}[], vault: Record<string,string> }} ctx
 */
export function toExtraction(raw, ctx) {
  const j = parseJson(raw);
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  let issuer = str(j.issuer);
  let issuerPartyId = null;
  const t = issuer.match(TOKEN);
  if (t && ctx.vault[`[${t[1]}]`] !== undefined) {
    const kind = t[1].split('_')[0];
    if (kind === 'PARTY') issuerPartyId = ctx.vault[`[${t[1]}]`];
    if (kind === 'CLIENT') issuer = ''; // the model named the reader as issuer: ignore
    else issuer = issuer.replace(TOKEN, '').trim() || issuer;
  }
  let payeeIbanToken = null;
  const p = str(j.payee_iban).match(/IBAN_\d+/);
  if (p && ctx.ibans.some((i) => i.token === p[0])) payeeIbanToken = p[0];
  const total = typeof j.total === 'number' && Number.isFinite(j.total) && j.total > 0 ? j.total
    : (typeof j.total === 'string' && Number.isFinite(parseFloat(j.total)) ? parseFloat(j.total) : null);
  // put back any value the redactor replaced inside free text (an invoice number, a name)
  const restore = (v) => v.replace(/\[([A-Z]+)_(\d+)\]/g, (m, kind) => (kind !== 'PARTY' && kind !== 'CLIENT' && ctx.vault[m] !== undefined ? ctx.vault[m] : m));
  return {
    issuer: issuerPartyId ? '' : restore(issuer),
    issuerPartyId,
    invoiceNumber: restore(str(j.invoice_number)) || null,
    total,
    currency: str(j.currency).toUpperCase() || null,
    payeeIbanToken,
    claimsBankChange: j.claims_bank_change === true || j.claims_bank_change === 'true',
    pressure: j.pressure === true || j.pressure === 'true',
  };
}
