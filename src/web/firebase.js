// Firebase AI Logic, hybrid inference. Two models from the same SDK:
//   device : InferenceMode.ONLY_ON_DEVICE  (Gemini Nano in Chrome)
//   cloud  : InferenceMode.ONLY_IN_CLOUD   (Gemini Developer API)
// The fallback between them is routed by src/core/pipeline.js, so that the
// cloud only ever receives the fully redacted prompt.
//
// Configuration comes from .env.local (never committed), see .env.example.

import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'firebase/ai';
import { EXTRACTION_SCHEMA } from '../core/extract.js';

// Each variable is read by its full name: Vite then inlines only the public ones used here.
// (Aliasing import.meta.env would inline every VITE_ variable, debug token included.)
export const CLOUD_MODEL = import.meta.env.VITE_CLOUD_MODEL || 'gemini-3.5-flash-lite';
const CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

export function firebaseConfigured() {
  return Boolean(CONFIG.apiKey && CONFIG.projectId && CONFIG.appId);
}

let cached = null;

export async function firebaseEngines() {
  if (cached) return cached;
  if (!firebaseConfigured()) throw new Error('Firebase is not configured: copy .env.example to .env.local and fill it in.');
  const app = initializeApp(CONFIG);
  // App Check is required by Firebase AI Logic. On localhost (dev server only) a registered
  // debug token is used; this branch, and the token, are removed from production builds.
  if (import.meta.env.DEV) self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
  // With the debug flag set, the SDK swaps in its debug provider and the site key is not used.
  if (RECAPTCHA_SITE_KEY || self.FIREBASE_APPCHECK_DEBUG_TOKEN) {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY || 'debug-only'), isTokenAutoRefreshEnabled: true });
  }
  const ai = getAI(app, { backend: new GoogleAIBackend() });

  const deviceModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: { expectedInputs: [{ type: 'text', languages: ['en', 'fr'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] },
      promptOptions: { responseConstraint: EXTRACTION_SCHEMA },
    },
  });
  const cloudModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: CLOUD_MODEL,
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: EXTRACTION_SCHEMA, temperature: 0 },
    },
  });

  const call = (model) => async (prompt) => {
    let r;
    for (let attempt = 0; ; attempt++) {
      try { r = await model.generateContent(prompt); break; } catch (e) {
        // free tier: 15 requests per minute. Wait as long as the API asks, twice at most.
        const msg = String(e?.message || '');
        const m = msg.match(/\[429[^\]]*\][\s\S]*?retry in ([\d.]+)s/i);
        const busy = /\[(500|503)\b/.test(msg); // "model is currently experiencing high demand"
        if ((!m && !busy) || attempt >= 2) throw e;
        await new Promise((res) => setTimeout(res, m ? Math.ceil(parseFloat(m[1]) * 1000) + 500 : 3000 * (attempt + 1)));
      }
    }
    const src = r.response.inferenceSource;
    return { text: r.response.text(), source: src === 'on_device' ? 'ON_DEVICE' : src === 'in_cloud' ? 'IN_CLOUD' : String(src || '') };
  };

  cached = {
    /** Call from a click: may start the model download in Chrome. */
    prepareDevice: (onProgress) => deviceModel.initializeDeviceModel?.(onProgress),
    device: {
      name: 'firebase-on-device',
      available: async () => {
        if (!('LanguageModel' in self)) return false;
        try { return (await self.LanguageModel.availability({ expectedInputs: [{ type: 'text', languages: ['en', 'fr'] }] })) === 'available'; } catch { return false; }
      },
      run: call(deviceModel),
    },
    cloud: { name: 'firebase-in-cloud', run: call(cloudModel) },
  };
  return cached;
}
