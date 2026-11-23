// Fails the build if a value meant to stay on the developer's machine ended up in dist/.
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const PRIVATE = ['VITE_APPCHECK_DEBUG_TOKEN'];
const env = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '';
const secrets = PRIVATE.map((k) => (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]).filter((v) => v && v.length >= 8);
const files = readdirSync('dist/assets').map((f) => `dist/assets/${f}`).concat(['dist/index.html', 'dist/measure.html']);
const hits = files.filter((f) => existsSync(f) && secrets.some((s) => readFileSync(f, 'utf8').includes(s)));
if (hits.length) { console.error('Private value found in build output:', hits.join(', ')); process.exit(1); }
console.log(`check-build: ${files.length} files, no private value`);
