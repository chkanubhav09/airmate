import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, safeJson } from '../worker/lib/json.js';
import { systemPrompt, round1 } from '../worker/lib/prompts.js';

test('extractJson tolerates fences and chatter around the JSON', () => {
  const out = extractJson('Sure!\n```json\n{"suggestions":[{"title":"Walk","detail":"Go early","impact":"less PM2.5"}]}\n```');
  assert.deepEqual(out, { suggestions: [{ title: 'Walk', detail: 'Go early', impact: 'less PM2.5' }] });
});

test('extractJson returns hacks for the indoor shape and drops malformed items', () => {
  const out = extractJson('{"hacks":[{"title":"Seal gaps","detail":"Use tape"},{"title":5}]}');
  assert.deepEqual(out, { hacks: [{ title: 'Seal gaps', detail: 'Use tape', impact: null }] });
});

test('extractJson returns null for non-JSON or wrong shape', () => {
  assert.equal(extractJson('no json here'), null);
  assert.equal(extractJson('{"other":1}'), null);
  assert.equal(extractJson('{broken'), null);
});

test('extractJson caps list length and field sizes', () => {
  const items = Array.from({ length: 10 }, () => ({ title: 'x'.repeat(500), detail: 'y'.repeat(900) }));
  const out = extractJson(JSON.stringify({ suggestions: items }));
  assert.equal(out.suggestions.length, 6);
  assert.equal(out.suggestions[0].title.length, 120);
  assert.equal(out.suggestions[0].detail.length, 600);
});

test('safeJson bounds the size of user-supplied profiles', () => {
  assert.ok(safeJson({ a: 'z'.repeat(5000) }).length <= 2000);
  assert.equal(safeJson(undefined), '{}');
});

test('systemPrompt falls back to "unknown" for missing context', () => {
  const p = systemPrompt({});
  assert.match(p, /place=unknown/);
  assert.match(p, /US AQI=unknown/);
  assert.equal(round1(12.34), 12.3);
  assert.equal(round1(undefined), 'unknown');
});
