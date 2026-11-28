// AirMate backend proxy (Cloudflare Worker).
// Keeps AI keys server-side, injects live air context, enforces strict JSON
// for structured modes. No personal data is stored — every request is stateless.

const SYSTEM_BASE = `You are AirMate, an Urban Air Quality Assistant for Indian families and communities facing winter smog.
Your job: suggest low-emission daily routines, indoor air quality hacks, and sustainable alternatives tailored to the user's location and lifestyle, and ALWAYS explain the direct impact of each suggestion in plain words.
Rules:
- Ground every answer in the live air context provided (place, US AQI, PM2.5, PM10).
- The AQI shown is a CAMS model estimate, not a ground-station reading. Say so when it matters.
- Follow US EPA AQI health-band guidance for activity advice. Never diagnose or give medical advice; suggest consulting a doctor for health conditions.
- Never invent precise health statistics or emission numbers. Rough, clearly-hedged estimates are fine.
- Keep answers concise: short paragraphs and bullet lists. Use **bold** for key actions.`;

function systemPrompt(ctx) {
  return SYSTEM_BASE + `\n\nLive air context (CAMS model estimate via Open-Meteo): place=${ctx.place || 'unknown'}, US AQI=${ctx.us_aqi ?? 'unknown'} (${ctx.band || 'unknown'}), PM2.5=${round1(ctx.pm25)} µg/m³, PM10=${round1(ctx.pm10)} µg/m³, updated=${ctx.updated || 'unknown'}.`;
}

const round1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : 'unknown');

const ROUTINE_PROMPT = `The user shared their daily routine. Suggest 3-4 cleaner swaps (low-emission routines, timing changes using the AQI forecast context, sustainable alternatives).
Respond with ONLY valid JSON, no markdown fences:
{"suggestions":[{"title":"short title","detail":"1-2 sentence explanation","impact":"one short quantified or hedged impact statement, e.g. '≈2 kg CO2/week avoided' or 'cuts your peak-hour PM2.5 exposure'"}]}`;

const INDOOR_PROMPT = `The user described their home. Suggest 3-5 indoor air quality hacks matched to their home and the current smog level.
Respond with ONLY valid JSON, no markdown fences:
{"hacks":[{"title":"short title","detail":"1-2 sentence explanation","impact":"one short direct-impact statement"}]}`;

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

async function handleAI(request, env) {
  const len = parseInt(request.headers.get('content-length') || '0', 10);
  if (len > 16384) return json({ error: 'payload_too_large' }, 413);
  let body;
  try {
    body = await request.json();
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

// Public runtime allowance: every model attempt (any provider, any mode,
// every retry/fallback) reserves one unit from a D1-backed counter BEFORE the
// call. The conditional UPDATE ... RETURNING is atomic in D1, persists across
// isolates and restarts, and refuses at the cap. Failed calls still consume
// their unit, so the cap bounds total provider calls, not just successes.
// Without a DB binding plus ALLOWANCE_CAP and ALLOWANCE_UNTIL, the model
// refuses to run: no silent unbudgeted usage.
const ALLOWANCE_COPY = {
  EXHAUSTED: 'The public AI allowance for this deployment is used up.',
  EXPIRED: 'The public AI allowance period for this deployment has ended.',
  NOT_CONFIGURED: 'The AI allowance is not configured on this deployment.',
};

async function reserveAllowance(env) {
  const cap = parseInt(env.ALLOWANCE_CAP || '', 10);
  if (!cap || !env.DB) throw new Error('ALLOWANCE_NOT_CONFIGURED');
  const until = Date.parse(env.ALLOWANCE_UNTIL || '');
  if (!until || Date.now() > until) throw new Error('ALLOWANCE_EXPIRED');
  const row = await env.DB
    .prepare('UPDATE allowance SET used = used + 1 WHERE id = 1 AND used < ? RETURNING used')
    .bind(cap)
    .first();
  if (!row) throw new Error('ALLOWANCE_EXHAUSTED');
}

// Provider chain: Workers AI binding -> Gemini REST (secret) -> 501.
async function runModel(env, system, user) {
  if (env.AI) {
    await reserveAllowance(env);
    try {
      const r = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 700,
      });
      if (r?.response) return r.response;
    } catch { /* fall through; each attempt reserves its own unit */ }
    await reserveAllowance(env);
    const r2 = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 700,
    });
    if (r2?.response) return r2.response;
    throw new Error('MODEL_EMPTY');
  }

  if (env.GEMINI_API_KEY) {
    await reserveAllowance(env);
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: 700, temperature: 0.6 },
        }),
      }
    );
    if (!res.ok) throw new Error('GEMINI_' + res.status);
    const j = await res.json();
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    if (text) return text;
    throw new Error('MODEL_EMPTY');
  }

  throw new Error('NO_PROVIDER');
}

// Pull the first {...} block out of a model reply, tolerating chatter/fences.
function extractJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const list = j.suggestions || j.hacks;
    if (!Array.isArray(list)) return null;
    const clean = list
      .filter((s) => s && typeof s.title === 'string' && typeof s.detail === 'string')
      .slice(0, 6)
      .map((s) => ({
        title: s.title.slice(0, 120),
        detail: s.detail.slice(0, 600),
        impact: typeof s.impact === 'string' ? s.impact.slice(0, 160) : null,
      }));
    return j.suggestions ? { suggestions: clean } : { hacks: clean };
  } catch {
    return null;
  }
}

const safeJson = (v) => JSON.stringify(v ?? {}).slice(0, 2000);
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
