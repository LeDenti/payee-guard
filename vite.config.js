import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

// Dev only: the measurement bench posts each run here, so results land in results/ as files.
const saveResults = {
  name: 'save-results',
  configureServer(server) {
    server.middlewares.use('/__save-result', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
      req.on('end', () => {
        const run = JSON.parse(body);
        const name = `${run.summary.engine}-${run.summary.at.replace(/[:.]/g, '-')}.json`.replace(/[^\w.-]/g, '_');
        mkdirSync('results', { recursive: true });
        writeFileSync(`results/${name}`, JSON.stringify(run, null, 1));
        res.end(name);
      });
    });
  },
};

export default defineConfig({
  plugins: [saveResults],
  build: {
    rollupOptions: { input: { main: 'index.html', measure: 'measure.html' } },
  },
});
