import { env } from '../../lib/env';

/**
 * Session-cumulative cost meter (descript-nhk.3).
 *
 * Descript exposes NO credits-remaining endpoint (verified — 8 candidate paths 404),
 * so the only way to give users spend visibility is to accumulate what job results
 * report: `ai_credits_used` (agentEdit/Underlord) and `media_seconds_used` (import).
 * This is a process-lifetime singleton — a running total for the server session.
 */
let aiCredits = 0;
let mediaSeconds = 0;

export const costMeter = {
  addCredits(n?: number): void {
    if (typeof n === 'number' && Number.isFinite(n)) aiCredits += n;
  },
  addMediaSeconds(n?: number): void {
    if (typeof n === 'number' && Number.isFinite(n)) mediaSeconds += n;
  },
  totals(): { ai_credits_used: number; media_seconds_used: number; credit_cap?: number } {
    return { ai_credits_used: aiCredits, media_seconds_used: mediaSeconds, credit_cap: env.DESCRIPT_CREDIT_CAP };
  },
  reset(): void {
    aiCredits = 0;
    mediaSeconds = 0;
  },
  /**
   * Guardrail: throw BEFORE an AI-credit-spending submit if this session has already
   * hit DESCRIPT_CREDIT_CAP. (Pre-submit cost can't be known — no estimate endpoint —
   * so the cap acts on cumulative spend to stop runaway pipelines, per Dave C's ~100cr/job cap.)
   */
  assertCreditCap(): void {
    const cap = env.DESCRIPT_CREDIT_CAP;
    if (cap && aiCredits >= cap) {
      throw new Error(
        `Descript credit cap reached: ${aiCredits} AI credits used this session ≥ cap ${cap}. ` +
          'Refusing to submit another agentEdit. Raise or unset DESCRIPT_CREDIT_CAP to continue.',
      );
    }
  },
};
