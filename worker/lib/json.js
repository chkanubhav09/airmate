// JSON helpers: tolerant extraction from model replies and response builders.

// Pull the first {...} block out of a model reply, tolerating chatter/fences.
export function extractJson(text) {
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

export const safeJson = (v) => JSON.stringify(v ?? {}).slice(0, 2000);
export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
