import { reserveAllowance } from './allowance.js';

// Provider chain: Workers AI binding -> Gemini REST (secret) -> 501.
export async function runModel(env, system, user) {
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
