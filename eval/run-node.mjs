// node eval/run-node.mjs [oracle|keywords]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { evaluate, oracleEngine } from './evaluate.js';
import { baselineEngine } from '../src/core/baseline.js';

const cases = JSON.parse(readFileSync(new URL('../corpus/cases.json', import.meta.url)));
const registry = JSON.parse(readFileSync(new URL('../corpus/registry.json', import.meta.url)));
const which = process.argv[2] || 'keywords';
const engine = which === 'oracle' ? oracleEngine(cases) : baselineEngine;
const { rows, summary } = await evaluate(cases, registry, { device: engine, allowCloud: false });
for (const r of rows.filter((r) => r.got !== r.expected)) console.log('MISS', r.id, r.kind, 'expected', r.expected, 'got', r.got, r.reasons.join(','), r.error || '');
console.log(JSON.stringify(summary, null, 2));
summary.engine = which; summary.at = new Date().toISOString();
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../results/${which}-${summary.at.replace(/[:.]/g, '-')}.json`, import.meta.url),
  JSON.stringify({ summary, rows: rows.map(({ id, kind, lang, expected, got, status, route, source, ms, reasons, fields, error }) => ({ id, kind, lang, expected, got, status, route, source, ms, reasons, fields, error })) }, null, 1));
