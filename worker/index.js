// AirMate backend (Cloudflare Worker).
// Serves the static app and proxies /api/ai so no AI key reaches the browser.
// Keeps AI keys server-side, injects live air context, enforces strict JSON
// for structured modes. No personal data is stored: every request is stateless.
// Logic lives in ./lib: prompts, allowance (D1 call budget), providers, json.

import { systemPrompt, ROUTINE_PROMPT, INDOOR_PROMPT } from './lib/prompts.js';
import { ALLOWANCE_COPY } from './lib/allowance.js';
import { runModel } from './lib/providers.js';
import { extractJson, safeJson, json } from './lib/json.js';

const MAX_BODY_BYTES = 16384;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/ai' && request.method === 'GET') {
      // Status probe so the UI can show an honest state before use: provider
      // configured AND public allowance configured, live and not exhausted.
      const ready = Boolean(env.AI || env.GEMINI_API_KEY);
      if (!ready) return json({ status: 'no_provider' }, 501);
      const cap = parseInt(env.ALLOWANCE_CAP || '', 10);
      if (!cap || !env.DB) return json({ status: 'allowance_not_configured' }, 501);
      const until = Date.parse(env.ALLOWANCE_UNTIL || '');
      if (!until || Date.now() > until) return json({ status: 'allowance_expired' }, 429);
      const row = await env.DB.prepare('SELECT used FROM allowance WHERE id = 1').first();
      if (!row || row.used >= cap) return json({ status: 'allowance_exhausted', allowance: { used: row ? row.used : cap, cap } }, 429);
      return json({ status: 'ready', allowance: { used: row.used, cap } });
    }
    if (url.pathname === '/api/ai' && request.method === 'POST') {
      return handleAI(request, env);
    }
    if (url.pathname === '/api/ai') {
      return json({ error: 'method_not_allowed' }, 405);
    }
    // Everything else: static assets (wrangler [assets] binding).
    return env.ASSETS.fetch(request);
  },
};

// Returns the body as text, or null if it is larger than maxBytes.
async function readBodyCapped(request, maxBytes) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(all);
}

async function handleAI(request, env) {
  if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    return json({ error: 'unsupported_media_type' }, 415);
  }
  const len = parseInt(request.headers.get('content-length') || '0', 10);
  if (len > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
  // The header can be absent or wrong (chunked uploads): read the stream with a
  // hard byte cap and stop as soon as it is exceeded, so memory stays bounded.
  const raw = await readBodyCapped(request, MAX_BODY_BYTES);
  if (raw === null) return json({ error: 'payload_too_large' }, 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const { mode, payload, airContext } = body || {};
  if (!['chat', 'routine', 'indoor'].includes(mode)) {
    return json({ error: 'unknown_mode' }, 400);
  }

  const sys = systemPrompt(airContext || {});
  let userContent;
  if (mode === 'chat') {
    const msgs = Array.isArray(payload?.messages) ? payload.messages.slice(-12) : [];
    if (!msgs.length) return json({ error: 'empty_messages' }, 400);
    userContent = msgs
      .filter((m) => typeof m.content === 'string')
      .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content.slice(0, 500)}`)
      .join('\n');
  } else if (mode === 'routine') {
    userContent = ROUTINE_PROMPT + '\n\nRoutine profile: ' + safeJson(payload?.profile);
  } else {
    userContent = INDOOR_PROMPT + '\n\nHome profile: ' + safeJson(payload?.home);
  }

  try {
    const text = await runModel(env, sys, userContent);
    if (mode === 'chat') return json({ text });
    return json(extractJson(text) || { [mode === 'routine' ? 'suggestions' : 'hacks']: [] });
  } catch (e) {
    if (e.message === 'NO_PROVIDER') return json({ error: 'backend_not_configured' }, 501);
    if (e.message.startsWith('ALLOWANCE_')) {
      const key = e.message.slice('ALLOWANCE_'.length);
      return json({ error: 'ai_budget_' + key.toLowerCase(), text: ALLOWANCE_COPY[key] || ALLOWANCE_COPY.NOT_CONFIGURED }, 429);
    }
    return json({ error: 'model_failed' }, 502);
  }
}
