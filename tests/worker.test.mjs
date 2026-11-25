// Mocked end-to-end tests for the AirMate worker's /api/ai handler.
// No network: global fetch is stubbed, so these never touch the Gemini API
// and never consume test budget.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const realFetch = globalThis.fetch;
let calls;

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function geminiOk(text) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function stubFetch(responder) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return responder(url, init);
  };
}

// Minimal in-test D1 stand-in for the allowance counter: honors the
// conditional UPDATE semantics (atomic in real D1) and lets a test inspect
// how many units were consumed.
function fakeDb(usedInit = 0) {
  const state = { used: usedInit };
  return {
    state,
    prepare(sql) {
      return {
        _cap: 0,
        bind(cap) { this._cap = cap; return this; },
        async first() {
          if (sql.startsWith('UPDATE')) {
            if (state.used < this._cap) { state.used += 1; return { used: state.used }; }
            return null;
          }
          return { used: state.used };
        },
      };
    },
  };
}

const env = {
  GEMINI_API_KEY: 'test-key-not-real',
  ASSETS: { fetch: async () => new Response('static-ok') },
  DB: fakeDb(),
  ALLOWANCE_CAP: '200',
  ALLOWANCE_UNTIL: '2099-01-01T00:00:00Z',
};

function aiRequest(body) {
  return new Request('https://local.test/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const chatBody = {
  mode: 'chat',
  payload: { messages: [{ role: 'user', content: 'Is the air okay for a walk?' }] },
  airContext: { place: 'Kolkata', us_aqi: 152, band: 'Unhealthy for Sensitive Groups', pm25: 58.2, pm10: 71.0, updated: 't0' },
};

test('chat mode returns model text and calls Gemini free-tier REST shape', async () => {
  stubFetch(() => geminiOk('Wear a mask; AQI is elevated.'));
  const res = await worker.fetch(aiRequest(chatBody), env);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.text, 'Wear a mask; AQI is elevated.');
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.match(url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent/);
  assert.equal(init.headers['x-goog-api-key'], 'test-key-not-real');
  const sent = JSON.parse(init.body);
  assert.ok(sent.systemInstruction.parts[0].text.includes('CAMS model estimate'));
  assert.match(sent.contents[0].parts[0].text, /User: Is the air okay/);
});

test('routine mode extracts suggestions JSON from model text', async () => {
  stubFetch(() => geminiOk('Here you go:\n{"suggestions": [{"title": "Run 06:00-08:00", "detail": "Lowest PM of the day", "impact": "cuts exposure"}]}'));
  const res = await worker.fetch(
    aiRequest({ mode: 'routine', payload: { profile: { commute: '07:30' } }, airContext: chatBody.airContext }),
    env
  );
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.suggestions[0].title, 'Run 06:00-08:00');
});

test('indoor mode extracts hacks JSON from model text', async () => {
  stubFetch(() => geminiOk('```json\n{"hacks": [{"title": "Kitchen exhaust", "detail": "run exhaust while cooking"}]}\n```'));
  const res = await worker.fetch(
    aiRequest({ mode: 'indoor', payload: { home: { cooking: 'gas' } }, airContext: chatBody.airContext }),
    env
  );
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.hacks[0].detail, 'run exhaust while cooking');
});

test('Gemini upstream error maps to 502 model_failed', async () => {
  stubFetch(() => new Response('quota', { status: 429 }));
  const res = await worker.fetch(aiRequest(chatBody), env);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'model_failed');
});

test('no provider configured returns 501 backend_not_configured', async () => {
  stubFetch(() => { throw new Error('fetch should not be called'); });
  const res = await worker.fetch(aiRequest(chatBody), { ASSETS: env.ASSETS });
  assert.equal(res.status, 501);
  assert.equal((await res.json()).error, 'backend_not_configured');
  assert.equal(calls.length, 0);
});

test('unknown mode and empty messages are rejected before any model call', async () => {
  stubFetch(() => { throw new Error('fetch should not be called'); });
  const r1 = await worker.fetch(aiRequest({ mode: 'nope' }), env);
  assert.equal(r1.status, 400);
  assert.equal((await r1.json()).error, 'unknown_mode');
  const r2 = await worker.fetch(aiRequest({ mode: 'chat', payload: { messages: [] } }), env);
  assert.equal(r2.status, 400);
  assert.equal((await r2.json()).error, 'empty_messages');
  assert.equal(calls.length, 0);
});

test('non-API paths fall through to static assets', async () => {
  const res = await worker.fetch(new Request('https://local.test/'), env);
  assert.equal(await res.text(), 'static-ok');
});

test('allowance exhausted returns 429 before any provider call', async () => {
  const db = fakeDb(200);
  stubFetch(() => { throw new Error('fetch should not be called'); });
  const res = await worker.fetch(aiRequest(chatBody), { ...env, DB: db });
  assert.equal(res.status, 429);
  const j = await res.json();
  assert.equal(j.error, 'ai_budget_exhausted');
  assert.match(j.text, /allowance/);
  assert.equal(calls.length, 0);
});

test('expired allowance returns 429 before any provider call', async () => {
  stubFetch(() => { throw new Error('fetch should not be called'); });
  const res = await worker.fetch(aiRequest(chatBody), { ...env, ALLOWANCE_UNTIL: '2020-01-01T00:00:00Z' });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'ai_budget_expired');
  assert.equal(calls.length, 0);
});

test('missing allowance configuration refuses the model call', async () => {
  stubFetch(() => { throw new Error('fetch should not be called'); });
  const res = await worker.fetch(aiRequest(chatBody), { GEMINI_API_KEY: 'k', ASSETS: env.ASSETS });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'ai_budget_not_configured');
  assert.equal(calls.length, 0);
});

test('a failed provider call still consumes its allowance unit', async () => {
  const db = fakeDb();
  stubFetch(() => new Response('boom', { status: 500 }));
  const res = await worker.fetch(aiRequest(chatBody), { ...env, DB: db });
  assert.equal(res.status, 502);
  assert.equal(db.state.used, 1);
});

test('status probe reports remaining allowance and blocks when spent', async () => {
  const db = fakeDb(7);
  const okRes = await worker.fetch(new Request('https://local.test/api/ai'), { ...env, DB: db });
  assert.equal(okRes.status, 200);
  const okJ = await okRes.json();
  assert.equal(okJ.status, 'ready');
  assert.deepEqual(okJ.allowance, { used: 7, cap: 200 });
  assert.equal(db.state.used, 7, 'probe must not consume a unit');
  const spentRes = await worker.fetch(new Request('https://local.test/api/ai'), { ...env, DB: fakeDb(200) });
  assert.equal(spentRes.status, 429);
  assert.equal((await spentRes.json()).status, 'allowance_exhausted');
});

test('oversized bodies are rejected before parsing', async () => {
  stubFetch(() => { throw new Error('fetch should not be called'); });
  const big = new Request('https://local.test/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '20000' },
    body: JSON.stringify(chatBody),
  });
  const res = await worker.fetch(big, env);
  assert.equal(res.status, 413);
});
