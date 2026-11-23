// Builds the labelled test set: corpus/registry.json and corpus/cases.json.
// Every company, domain, person and account here is invented. Bank numbers have
// valid checksums so that only the rules, not a typo, can stop them (except in
// the cases built to carry a bad checksum).
//
//   node corpus/build.mjs

import { writeFileSync } from 'node:fs';
import { ibanCheckDigits } from '../src/core/iban.js';

let seed = 20261122;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const digits = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');
const letters = (n) => Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(rnd() * 26))).join('');
const group4 = (s) => s.replace(/(.{4})/g, '$1 ').trim();
const mk = (cc, bban) => cc + ibanCheckDigits(cc, bban) + bban;
const FR = () => mk('FR', digits(23));
const LT = () => mk('LT', digits(16));
const DE = () => mk('DE', digits(18));
const GB = () => mk('GB', letters(4) + digits(14));
const IE = () => mk('IE', letters(4) + digits(14));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const amount = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
const eur = (x) => x.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €';
const usd = (x, sym) => sym + x.toLocaleString('en-GB', { minimumFractionDigits: 2 });

const suppliers = [
  { id: 'calanquia', names: ['Calanquia Distribution'], domains: ['calanquia-distribution.fr'], country: 'FR', usualMax: 25000, lang: 'fr', cur: 'EUR' },
  { id: 'orvanne', names: ['Laboratoires Orvanne', 'Labo Orvanne'], domains: ['orvanne-labo.fr'], country: 'FR', usualMax: 8000, lang: 'fr', cur: 'EUR' },
  { id: 'mistralys', names: ['Mistralys Medical'], domains: ['mistralys-medical.com'], country: 'FR', usualMax: 3000, lang: 'en', cur: 'EUR' },
  { id: 'northgate', names: ['Northgate Packaging Ltd', 'Northgate Packaging'], domains: ['northgate-packaging.co.uk'], country: 'GB', usualMax: 1500, lang: 'en', cur: 'GBP' },
  { id: 'stlazrin', names: ['Blanchisserie Saint-Lazrin'], domains: ['blanchisserie-stlazrin.fr'], country: 'FR', usualMax: 600, lang: 'fr', cur: 'EUR' },
  { id: 'kestrel', names: ['Kestrelsoft Systems'], domains: ['kestrelsoft.ie'], country: 'IE', usualMax: 400, lang: 'en', cur: 'EUR' },
];
for (const s of suppliers) s.ibans = [s.country === 'GB' ? GB() : s.country === 'IE' ? IE() : FR()];

const self = { names: ['Pharmacie des Goudes'], domains: ['pharmacie-goudes.fr'] };
const paid = [{ supplierId: 'orvanne', invoiceNumber: 'ORV-2026-0418' }, { supplierId: 'calanquia', invoiceNumber: 'CD-77120' }];

const people = { fr: ['Claire Bastide', 'Hugo Ferracci', 'Nadia Oulmi', 'Paul Testanière'], en: ['Megan Hollis', 'Tom Ashdown', 'Priya Raman', 'Dan Whitcombe'] };
const phone = (s) => (s.country === 'GB' ? '+44 20 7946 ' + digits(4) : s.country === 'IE' ? '+353 1 555 ' + digits(4) : '04 91 ' + digits(2) + ' ' + digits(2) + ' ' + digits(2));
const money = (s, x) => (s.cur === 'GBP' ? usd(x, '£') : s.lang === 'fr' ? eur(x) : usd(x, '€'));

const cases = [];
let n = 0;
const add = (kind, s, text, expect) => cases.push({ id: `c${String(++n).padStart(3, '0')}`, kind, lang: s?.lang || 'en', text, expect: { ...expect, issuerName: s?.names?.[0] || '' } });

// ---------- documents ----------
function invoice(s, { num, total, iban, extra = '', from = s.domains[0] }) {
  const who = pick(people[s.lang]);
  if (s.lang === 'fr') {
    return `De : ${who} <compta@${from}>
Objet : Facture ${num}

${s.names[0]}
12 avenue du Prado, 13008 Marseille
SIRET 412 ${digits(3)} ${digits(3)} 00027 – TVA FR${digits(2)} 412${digits(6)}

Facture n° ${num}
Client : Pharmacie des Goudes
Date : 14/11/2026 – Échéance : 14/12/2026

Total TTC : ${money(s, total)}
${extra}${iban ? `Règlement par virement : IBAN ${group4(iban)} – BIC ${letters(4)}FRPP${letters(3)}\n` : 'Règlement par prélèvement SEPA selon le mandat en vigueur.\n'}
Contact : ${who}, ${phone(s)}`;
  }
  return `From: ${who} <accounts@${from}>
Subject: Invoice ${num}

${s.names[0]}
Unit 4, Harbour Road${s.country === 'GB' ? ', Bristol BS1 6' + letters(2) : ''}

INVOICE ${num}
Bill to: Pharmacie des Goudes
Issued 14 Nov 2026 – due 14 Dec 2026

Amount due: ${money(s, total)}
${extra}${iban ? `Pay by bank transfer to IBAN ${group4(iban)}, BIC ${letters(4)}${s.country}2${letters(1)}\n` : 'Payment will be collected by direct debit under the existing mandate.\n'}
Questions: ${who}, ${phone(s)}`;
}

const num = (s) => (s.id === 'calanquia' ? 'CD-' + digits(5) : s.id === 'orvanne' ? 'ORV-2026-' + digits(4) : s.id.slice(0, 3).toUpperCase() + '-' + digits(5));

// 1. legitimate, account on file (12)
for (const s of suppliers) for (let k = 0; k < 2; k++) {
  const total = amount(s.usualMax * 0.1, s.usualMax * 0.9);
  const nm = num(s);
  add('legit_on_file', s, invoice(s, { num: nm, total, iban: s.ibans[0] }), { verdict: 'clear', supplierId: s.id, payee: s.ibans[0], claim: false, pressure: false, invoiceNumber: nm, total });
}
// 2. legitimate, no bank details, direct debit (6)
for (const s of suppliers) {
  const total = amount(s.usualMax * 0.1, s.usualMax * 0.9); const nm = num(s);
  add('legit_no_iban', s, invoice(s, { num: nm, total, iban: null }), { verdict: 'clear', supplierId: s.id, payee: null, claim: false, pressure: false, invoiceNumber: nm, total });
}

// 3. bank change announced in plain words, new foreign account, genuine domain (compromised mailbox) (6)
const changeFr = [
  'Suite à un changement de banque, merci de noter nos nouvelles coordonnées bancaires ci-dessous.\n',
  'Important : nos coordonnées bancaires ont changé. Merci de mettre à jour votre fichier.\n',
];
const changeEn = [
  'Please note our bank details have changed. Kindly update your records and use the account below.\n',
  'We have recently changed our bank. Please use the new account below for this and all future payments.\n',
];
for (const s of suppliers) {
  const fake = pick([LT, DE])(); const total = amount(s.usualMax * 0.3, s.usualMax * 0.9); const nm = num(s);
  add('fraud_change_plain', s, invoice(s, { num: nm, total, iban: fake, extra: pick(s.lang === 'fr' ? changeFr : changeEn) }),
    { verdict: 'stop', supplierId: s.id, payee: fake, claim: true, pressure: false, invoiceNumber: nm, total });
}

// 4. same, but from a lookalike domain and with pressure (6)
const look = { 'calanquia-distribution.fr': 'calanquia-distribution.com', 'orvanne-labo.fr': 'orvanne-lab0.fr', 'mistralys-medical.com': 'mistralys-rnedical.com',
  'northgate-packaging.co.uk': 'northgate-packagings.co.uk', 'blanchisserie-stlazrin.fr': 'blanchisserie-stlazrin-factures.fr', 'kestrelsoft.ie': 'kestrelsfot.ie' };
const pressFr = 'Merci de procéder au règlement aujourd\'hui même pour éviter la suspension de vos livraisons. ';
const pressEn = 'Please process this payment today to avoid suspension of your account. ';
for (const s of suppliers) {
  const fake = pick([LT, DE, GB])(); const total = amount(s.usualMax * 0.3, s.usualMax * 0.9); const nm = num(s);
  add('fraud_lookalike', s, invoice(s, { num: nm, total, iban: fake, from: look[s.domains[0]], extra: (s.lang === 'fr' ? pressFr + changeFr[0] : pressEn + changeEn[1]) }),
    { verdict: 'stop', supplierId: s.id, payee: fake, claim: true, pressure: true, invoiceNumber: nm, total });
}

// 5. paraphrased change, two accounts, the NEW one named first and the old one last (6).
//    A reader that takes "the last account" pays the right-looking old one and misses the switch.
for (const s of suppliers) {
  const fake = pick([LT, DE])(); const total = amount(s.usualMax * 0.2, s.usualMax * 0.8); const nm = num(s);
  const extra = s.lang === 'fr'
    ? `Pour cette facture et les suivantes, le règlement doit être adressé au compte ${group4(fake)} ouvert auprès de notre partenaire financier. Le compte ${group4(s.ibans[0])} sera clôturé à la fin du mois et ne doit plus être crédité.\n`
    : `From this invoice onward, settlement goes to the account ${group4(fake)} held with our financing partner. The account ${group4(s.ibans[0])} closes at month end and should no longer be credited.\n`;
  add('fraud_two_accounts', s, invoice(s, { num: nm, total, iban: null, extra }).replace(/Règlement par prélèvement.*\n|Payment will be collected.*\n/, ''),
    { verdict: 'stop', supplierId: s.id, payee: fake, claim: true, pressure: false, invoiceNumber: nm, total });
}

// 6. paraphrased change, no account in the text ("details attached"), soft wording (6)
//    Nothing for the code to compare: only reading the sentence can raise the flag.
const softFr = [
  'Nous vous informons que nous travaillons désormais avec un nouvel établissement : vous trouverez le RIB à jour en pièce jointe, à utiliser dès ce règlement.\n',
  'Petite précision : merci de ne plus utiliser l\'ancien relevé d\'identité bancaire, celui joint à ce message le remplace.\n',
];
const softEn = [
  'Quick note: we have moved our banking to a new provider. The updated remittance details are attached; please use them starting with this payment.\n',
  'Please disregard the remittance details you hold for us; the attached letter carries the ones to use from now on.\n',
];
for (const s of suppliers) {
  const total = amount(s.usualMax * 0.2, s.usualMax * 0.8); const nm = num(s);
  add('fraud_soft_no_iban', s, invoice(s, { num: nm, total, iban: null, extra: pick(s.lang === 'fr' ? softFr : softEn) }).replace(/Règlement par prélèvement.*\n|Payment will be collected.*\n/, ''),
    { verdict: 'verify', supplierId: s.id, payee: null, claim: true, pressure: false, invoiceNumber: nm, total });
}

// 7. doctored account: right supplier, a single digit changed so the checksum fails (4)
for (const s of suppliers.slice(0, 4)) {
  const good = s.ibans[0]; const i = good.length - 3;
  const bad = good.slice(0, i) + String((Number(good[i]) + 1) % 10) + good.slice(i + 1);
  const total = amount(s.usualMax * 0.2, s.usualMax * 0.8); const nm = num(s);
  add('fraud_bad_checksum', s, invoice(s, { num: nm, total, iban: bad }), { verdict: 'stop', supplierId: s.id, payee: bad, claim: false, pressure: false, invoiceNumber: nm, total });
}

// 8. already paid invoice sent again (2)
{
  const s = suppliers[1]; add('duplicate', s, invoice(s, { num: 'ORV-2026-0418', total: 2380.4, iban: s.ibans[0] }), { verdict: 'stop', supplierId: 'orvanne', payee: s.ibans[0], claim: false, pressure: false, invoiceNumber: 'ORV-2026-0418', total: 2380.4 });
  const t = suppliers[0]; add('duplicate', t, invoice(t, { num: 'CD-77120', total: 11240, iban: t.ibans[0] }), { verdict: 'stop', supplierId: 'calanquia', payee: t.ibans[0], claim: false, pressure: false, invoiceNumber: 'CD-77120', total: 11240 });
}

// 9. amount far above the usual (3)
for (const s of [suppliers[2], suppliers[4], suppliers[5]]) {
  const total = Math.round(s.usualMax * 3.4); const nm = num(s);
  add('amount_unusual', s, invoice(s, { num: nm, total, iban: s.ibans[0] }), { verdict: 'verify', supplierId: s.id, payee: s.ibans[0], claim: false, pressure: false, invoiceNumber: nm, total });
}

// 10. unknown supplier, honest first invoice (3)
const newcos = [
  { id: null, names: ['Atelier Vauban Signalétique'], domains: ['vauban-signaletique.fr'], country: 'FR', lang: 'fr', cur: 'EUR', usualMax: 2000 },
  { id: null, names: ['Brightwell Cleaning Co'], domains: ['brightwell-cleaning.co.uk'], country: 'GB', lang: 'en', cur: 'GBP', usualMax: 500 },
  { id: null, names: ['Imprimerie du Canet'], domains: ['imprimerie-canet.fr'], country: 'FR', lang: 'fr', cur: 'EUR', usualMax: 900 },
];
for (const s of newcos) {
  const iban = s.country === 'GB' ? GB() : FR(); const total = amount(200, 1800); const nm = 'F' + digits(5);
  add('new_supplier', s, invoice(s, { num: nm, total, iban }), { verdict: 'verify', supplierId: null, payee: iban, claim: false, pressure: false, invoiceNumber: nm, total });
}

// 11. "boss" fraud: someone posing as the owner asks for an urgent, discreet transfer to a company not on file (4)
const boss = [
  ['fr', `De : Pharmacie des Goudes – Direction <direction.goudes@gmail.com>
Objet : Virement à traiter

Bonjour,
Je suis en rendez-vous toute la journée. Merci de faire aujourd'hui un virement de 9 850,00 € à la société Helvar Conseil pour l'acompte du rachat, IBAN ${group4(LT())}.
C'est confidentiel tant que l'opération n'est pas annoncée, merci de n'en parler à personne et de me répondre uniquement par mail.
Merci`],
  ['en', `From: Pharmacie des Goudes - Owner <owner.goudes@outlook.com>
Subject: quick favour

Are you at your desk? I need a transfer of €14,200.00 sent to Marlow Advisory before 3pm, it's for the acquisition deposit. Account ${group4(DE())}.
Keep this between us until it's announced, and don't call me, I'm in meetings. Reply here when done.`],
  ['fr', `De : Comptabilité <compta@cabinet-ferrand-audit.fr>
Objet : Régularisation urgente

Madame, Monsieur,
Suite à notre contrôle, un solde de 3 120,00 € reste dû à Ferrand Audit. Sans règlement immédiat sur le compte ${group4(DE())}, le dossier sera transmis au contentieux demain.`],
  ['en', `From: Billing <billing@quantrel-it.com>
Subject: FINAL NOTICE - invoice QIT-88213

Your domain and e-mail hosting renewal (€1,480.00) is overdue. Pay immediately to IBAN ${group4(LT())} to avoid service interruption tonight. Quantrel IT Services.`],
];
boss.forEach(([lang, text], k) => {
  const iban = (text.match(/[A-Z]{2}\d{2}(?: [A-Z0-9]{1,4})+/) || [''])[0].replace(/ /g, '');
  // the first two write under the reader's own name from a webmail address: stop
  add(k < 2 ? 'impersonates_owner' : 'pressure_unknown', { lang }, text, { verdict: k < 2 ? 'stop' : 'verify', supplierId: null, payee: iban, claim: false, pressure: true });
});

const registry = { self, suppliers: suppliers.map(({ lang, cur, ...s }) => s), paid };
writeFileSync(new URL('./registry.json', import.meta.url), JSON.stringify(registry, null, 2) + '\n');
writeFileSync(new URL('./cases.json', import.meta.url), JSON.stringify(cases, null, 2) + '\n');
const byKind = cases.reduce((m, c) => ((m[c.kind] = (m[c.kind] || 0) + 1), m), {});
console.log(`${cases.length} cases`, byKind);
