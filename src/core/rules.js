// The decision. The model reads; this code decides; a person confirms.
// Every reason carries a severity, and the verdict is the worst one:
//   clear  : pay, to the account already on file
//   verify : call the supplier on a number you already had, then decide
//   stop   : do not pay this document as it stands

import { maskIban, normalizeIban } from './iban.js';
import { matchSupplier, lookalikeOf, senderDomain, ibanOnFile, baseDomain, normName } from './registry.js';

const RANK = { clear: 0, verify: 1, stop: 2 };

/**
 * @param {object} p
 * @param {object} p.extraction  model output, tokens already restored
 *   { issuer, issuerPartyId, invoiceNumber, total, currency, payeeIbanToken,
 *     claimsBankChange, pressure }
 * @param {{token:string, iban:string, valid:boolean}[]} p.ibans  found by code in the document
 * @param {string|null} p.sender  From: line, if the document is an e-mail
 * @param {object} p.registry
 */
export function decide({ extraction: x, ibans, sender, registry }) {
  const reasons = [];
  const add = (code, severity, text) => reasons.push({ code, severity, text });

  const domain = senderDomain(sender);
  const { supplier, by } = matchSupplier(registry, { issuer: x.issuer, partyId: x.issuerPartyId, domain });

  // Which account does the document ask to be paid on?
  const valid = ibans.filter((i) => i.valid);
  let payee = null;
  if (x.payeeIbanToken) payee = ibans.find((i) => i.token === x.payeeIbanToken) || null;
  if (!payee && valid.length === 1) payee = valid[0];

  // R0 someone writing under the reader's own name, from an address that is not theirs
  if (sender && domain) {
    const display = normName(sender.replace(/<[^>]*>/, ''));
    const own = (registry.self?.domains || []).some((k) => baseDomain(k) === baseDomain(domain));
    if (!own && (registry.self?.names || []).some((n) => normName(n).length >= 5 && display.includes(normName(n)))) {
      add('impersonates_you', 'stop', `The message uses your own business name but comes from ${domain}, an address that is not yours.`);
    }
  }

  // R1 a bank number that fails its own checksum
  for (const i of ibans.filter((i) => !i.valid)) {
    add('iban_checksum', 'stop', `A bank number in this document (${maskIban(i.iban)}) fails the IBAN checksum: a typo or a doctored number.`);
  }

  // R2 who is this?
  if (!supplier) {
    add('supplier_unknown', 'verify', `"${x.issuer || 'This sender'}" is not in your supplier list. Check the company before a first payment.`);
  }

  // R3 sender domain
  if (domain) {
    const known = supplier ? supplier.domains || [] : (registry.suppliers || []).flatMap((s) => s.domains || []);
    const imitated = lookalikeOf(domain, known);
    if (imitated) {
      add('lookalike_domain', 'stop', `The e-mail comes from ${domain}, which imitates ${imitated}.`);
    } else if (supplier && !(supplier.domains || []).some((k) => baseDomain(k) === baseDomain(domain))) {
      add('sender_domain_new', 'verify', `${supplier.names[0]} usually writes from ${(supplier.domains || []).join(', ')}, not ${domain}.`);
    }
  }

  // R4 the account
  if (payee && payee.valid && supplier) {
    if (!ibanOnFile(supplier, payee.iban)) {
      add('iban_not_on_file', 'stop', `The account ${maskIban(payee.iban)} is not the one on file for ${supplier.names[0]}.`);
    }
    const country = normalizeIban(payee.iban).slice(0, 2);
    if (supplier.country && country !== supplier.country) {
      add('iban_country', 'verify', `${supplier.names[0]} is based in ${supplier.country}, the account is in ${country}.`);
    }
  }
  if (!payee && valid.length > 1) {
    add('payee_unclear', 'verify', 'Several bank accounts appear and it is not clear which one is to be paid.');
  }
  if (!payee && supplier && valid.length === 0) {
    add('pay_on_file', 'clear', `No bank details in the document: pay only to the account on file for ${supplier.names[0]}.`);
  }

  // R5 what the text claims (read by the model)
  if (x.claimsBankChange) {
    const changed = payee && payee.valid && supplier && !ibanOnFile(supplier, payee.iban);
    add('bank_change_claim', changed ? 'stop' : 'verify',
      'The document announces new bank details. Confirm by calling a number you already had, never one given in the message.');
  }
  if (x.pressure) {
    add('pressure', 'verify', 'The message pushes for speed or secrecy, a classic lever of payment fraud.');
  }

  // R6 amount and duplicates
  if (supplier && typeof x.total === 'number' && supplier.usualMax && x.total > supplier.usualMax * 2) {
    add('amount_unusual', 'verify', `${x.total} is more than twice the usual maximum (${supplier.usualMax}) for ${supplier.names[0]}.`);
  }
  if (supplier && x.invoiceNumber) {
    const inv = String(x.invoiceNumber).replace(/\s/g, '').toUpperCase();
    if ((registry.paid || []).some((p) => p.supplierId === supplier.id && p.invoiceNumber.replace(/\s/g, '').toUpperCase() === inv)) {
      add('already_paid', 'stop', `Invoice ${x.invoiceNumber} from ${supplier.names[0]} is already marked as paid.`);
    }
  }

  const verdict = reasons.reduce((v, r) => (RANK[r.severity] > RANK[v] ? r.severity : v), 'clear');
  return {
    verdict,
    reasons,
    supplierId: supplier?.id || null,
    matchedBy: by,
    payeeIban: payee?.iban || null,
  };
}
