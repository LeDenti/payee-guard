// Gemini Nano through Chrome's built-in Prompt API, called directly.
// Used by the measurement page to read the same on-device model that
// Firebase AI Logic drives in hybrid mode, before any Firebase project exists.

import { EXTRACTION_SCHEMA } from '../core/extract.js';

const OPTS = {
  expectedInputs: [{ type: 'text', languages: ['en', 'fr'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

export async function nanoStatus() {
  if (!('LanguageModel' in self)) return 'no-api';
  try { return await self.LanguageModel.availability(OPTS); } catch (e) { return 'error: ' + (e?.message || e); }
}

/** Must be called from a user gesture the first time (it may download the model). */
export async function nanoWarmUp(onProgress) {
  const s = await self.LanguageModel.create({
    ...OPTS,
    monitor(m) { m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded)); },
  });
  s.destroy();
}

export const chromeNanoEngine = {
  name: 'chrome-nano',
  available: async () => (await nanoStatus()) === 'available',
  run: async (prompt) => {
    const s = await self.LanguageModel.create(OPTS);
    try {
      const text = await s.prompt(prompt, { responseConstraint: EXTRACTION_SCHEMA });
      return { text, source: 'ON_DEVICE' };
    } finally {
      s.destroy();
    }
  },
};
