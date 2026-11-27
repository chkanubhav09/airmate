// Public runtime allowance: every model attempt (any provider, any mode,
// every retry/fallback) reserves one unit from a D1-backed counter BEFORE the
// call. The conditional UPDATE ... RETURNING is atomic in D1, persists across
// isolates and restarts, and refuses at the cap. Failed calls still consume
// their unit, so the cap bounds total provider calls, not just successes.
// Without a DB binding plus ALLOWANCE_CAP and ALLOWANCE_UNTIL, the model
// refuses to run: no silent unbudgeted usage.
export const ALLOWANCE_COPY = {
  EXHAUSTED: 'The public AI allowance for this deployment is used up.',
  EXPIRED: 'The public AI allowance period for this deployment has ended.',
  NOT_CONFIGURED: 'The AI allowance is not configured on this deployment.',
};

export async function reserveAllowance(env) {
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
