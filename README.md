# Payee Guard

**Check a supplier invoice before you pay it. The model reads it on your device; the rules decide; you confirm.**

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com) with **Firebase AI Logic hybrid inference** (Web / Chrome, Gemini Nano on device, Gemini in the cloud as fallback).

**Try it: https://payee-guard.web.app** in Chrome desktop. **Demo video (2:09): https://youtu.be/a9HkudmXrN0** With Gemini Nano available it reads on your device; otherwise it reads a redacted copy in the cloud (App Check with reCAPTCHA Enterprise protects the endpoint). Every company, person and account in the sample inbox is invented.

## The problem

A small business pays dozens of supplier invoices a month. The most expensive fraud against it is not a hack: it is an e-mail or an invoice that says *"our bank details have changed"*, from a mailbox that was broken into or from a domain one letter away from the real one. The money goes out by ordinary bank transfer, and it does not come back.

The documents that would reveal the trick are exactly the ones you should not paste into a chatbot: supplier names, bank accounts, amounts, the names of the people who write to you.

## The idea: hybrid, with the privacy line drawn in code

- **On the device first.** Gemini Nano, through Firebase AI Logic, reads the document in Chrome. It only reads language: who is writing, which account the text asks you to pay, whether it announces new bank details, whether it pushes for haste or secrecy.
- **The model never needs the digits.** Bank numbers carry their own checksum (ISO 13616, mod 97), so code finds them exactly and replaces them with tokens such as `[IBAN_1]` before any model sees the text. The mapping back stays in the page.
- **The cloud only gets a redacted copy.** When no on-device model is available (another browser, a machine without enough memory, a model still downloading), the app routes the request to Gemini in the cloud through the same SDK, but only after replacing on the device every account, every name you keep on file, e-mail addresses, web domains, phone numbers, company and VAT numbers, and postcodes. A last check refuses the call if any sensitive literal from your supplier list is still in the prompt.
- **The rules decide, not the model.** A short, readable rule set compares what was read with your supplier list (kept on the device): is the account the one on file, does the sender's domain imitate the real one, does the account number fail its checksum, was this invoice already paid, is the amount far above the usual, is someone writing under your own business name from a webmail address. Every verdict (*clear*, *verify*, *stop*) comes with its reasons in plain words.
- **You confirm.** Nothing is paid from the app. You mark the invoice paid or rejected, or, after calling the supplier on a number you already had, you add the new account to the list.

Why not the SDK's own `PREFER_ON_DEVICE` mode? It would fall back to the cloud with the same full prompt. Payee Guard uses two models from the same SDK, `ONLY_ON_DEVICE` and `ONLY_IN_CLOUD`, and routes between them itself, so that the fallback and the redaction are one decision.

## Measured

58 labelled documents (English and French; 26 frauds), every company, person and account invented: [`corpus/build.mjs`](corpus/build.mjs).

| Reader | Right verdict | Bad documents it would let you pay |
|---|---|---|
| Perfect reader (tests the rules alone) | 58 / 58 | 0 |
| Keyword reader, no model | 44 / 58 | 14 |
| Gemini Nano on device, Firebase AI Logic `ONLY_ON_DEVICE` | **58 / 58** | **0** |
| Gemini Nano on device, Chrome Prompt API called directly | **58 / 58** | **0** |
| Gemini 3.5 Flash-Lite in the cloud, redacted copy (Firebase AI Logic) | **58 / 58** | **0** |

On-device runs of 22 November 2026 (Chrome 157 on an Apple M5 laptop, 16 GB): 26 of 26 frauds stopped, 18 of 18 genuine invoices cleared, every answer reported by the SDK as `ON_DEVICE`, median 3.0 s per document. Supplier and account to pay were read right every time. Gemini Nano raised a few warning signs too many (a "bank change" or "pressure" flag on messages already suspicious for other reasons: 6 of 116 flags in the direct run, 8 in the SDK run) and missed none; the verdicts did not move.

Cloud run of 22 November 2026: 26 of 26 frauds stopped, 18 of 18 genuine invoices cleared, every field read right (supplier, account to pay, bank-change claim, pressure), median 1.9 s per document, every answer reported by the SDK as `IN_CLOUD`. Raw runs, without document text, are in [`results/`](results/).

The keyword reader misses reworded bank-change notices ("we have moved our banking to a new provider") and invoices that list the new account first and the old one last. That is the part a language model has to earn, and both Gemini models earn it on this set.

Reproduce: `npm test` (unit tests and the perfect-reader run), `npm run eval:keywords`, and `measure.html` in Chrome for the model runs.

## Run it

```bash
npm install
cp .env.example .env.local   # fill in your Firebase web app config and App Check site key
npx vite
```

Open http://localhost:5173 in Chrome desktop. If Gemini Nano is not on the machine yet, the first check starts its one-time download in the background (several GB; needs about 22 GB free disk space and 16 GB RAM or a GPU with more than 4 GB) and answers at once through the redacted cloud copy; checks move to the device when the model is ready. Without Firebase configured the app still reads on device through Chrome's Prompt API, so you can try it, but the cloud fallback needs the Firebase project.

## Layout

```
src/core/     pure logic, no dependency: iban, redact, registry, rules, extract, pipeline, baseline
src/web/      the app: Firebase AI Logic engines, Chrome Prompt API, UI
corpus/       the labelled test set and its generator
eval/         scoring, shared by Node and the browser bench
tests/        node --test
```

## Limits, honestly

- Redaction removes what can be recognised: account numbers, the names on your list, the sender's own name, e-mails, domains, phones, company numbers, postcodes. Another person named only inside the text (a colleague in a signature) stays in the cloud copy.
- The free Gemini Developer API tier allows 15 requests a minute; the app waits and retries when told to.
- The rules can only compare with what you have on file. A first invoice from a new supplier always comes back *verify*.
- The test set is synthetic, written to cover known fraud patterns; real invoices are messier.

## Prior work, disclosed

All code in this repository was written during the contest period (from 22 November 2026). The idea of a rule engine that refuses with a reason in plain words comes from the author's earlier projects (Ferret, Ngogo); no code was copied from them. The code was written with an AI coding assistant (Claude Code), on the author's instructions.

## License

Apache 2.0.
