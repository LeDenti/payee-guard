// One document in, one decision out. The routing is the point:
//   1. try the model on this device, with bank numbers tokenized;
//   2. only if no local model is available, and the user allows it, go to the
//      cloud with names, e-mails, phones, company numbers and postcodes
//      tokenized as well, after checking that no sensitive literal is left;
//   3. the rules decide; the person confirms.
// The SDK's own PREFER_ON_DEVICE mode would send the same full prompt to the
// cloud on fallback; that is why the fallback is routed here instead.

import { pseudonymize, leakedValues } from './redact.js';
import { buildPrompt, toExtraction } from './extract.js';
import { decide } from './rules.js';
import { partiesForRedaction, sensitiveLiterals } from './registry.js';

export function splitSender(text) {
  const m = String(text).match(/^\s*(?:From|De|Expéditeur)\s*:\s*(.+)$/im);
  return m ? m[1].trim() : null;
}

/**
 * @param {{ text: string }} doc
 * @param {object} registry
 * @param {{ device?: Engine, cloud?: Engine, allowCloud?: boolean }} engines
 *   Engine = { available?: () => Promise<boolean>, run: (prompt) => Promise<{ text: string, source?: string }> }
 */
export async function analyze(doc, registry, engines) {
  const text = doc.text;
  const sender = splitSender(text);
  const t0 = Date.now();
  let route = null, sent = null, raw = null, ctx = null, source = null, deviceError = null;

  if (engines.device) {
    const ok = engines.device.available ? await engines.device.available() : true;
    if (ok) {
      ctx = pseudonymize(text, { level: 'device' });
      sent = buildPrompt(ctx.text);
      try {
        const r = await engines.device.run(sent);
        raw = r.text; source = r.source || 'ON_DEVICE'; route = 'device';
      } catch (e) {
        deviceError = String(e?.message || e);
      }
    }
  }

  if (route === null) {
    if (!engines.cloud || engines.allowCloud === false) {
      return { status: 'no_engine', deviceError, ms: Date.now() - t0 };
    }
    ctx = pseudonymize(text, { level: 'cloud', parties: partiesForRedaction(registry), self: registry.self?.names || [] });
    sent = buildPrompt(ctx.text);
    const secrets = [
      ...sensitiveLiterals(registry),
      ...Object.entries(ctx.vault).filter(([t]) => /^\[(IBAN|EMAIL|PHONE|ID|BIC|WEB|PERSON)_/.test(t)).map(([, v]) => v),
    ];
    const leaks = leakedValues(sent, secrets.filter((s) => String(s).length >= 4));
    if (leaks.length) return { status: 'refused_leak', leaks: leaks.length, ms: Date.now() - t0 };
    const r = await engines.cloud.run(sent);
    raw = r.text; source = r.source || 'IN_CLOUD'; route = 'cloud';
  }

  let extraction;
  try {
    extraction = toExtraction(raw, ctx);
  } catch (e) {
    return { status: 'bad_model_answer', route, source, raw, ms: Date.now() - t0 };
  }
  const decision = decide({ extraction, ibans: ctx.ibans, sender, registry });
  return { status: 'ok', route, source, sent, raw, extraction, decision, deviceError, ms: Date.now() - t0 };
}
