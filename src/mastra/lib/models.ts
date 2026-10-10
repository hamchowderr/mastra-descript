import { env } from '../../lib/env';

/**
 * LLM model strings for the agent and the eval judges.
 *
 * Calls go through the Vercel AI Gateway (`vercel/<gateway model id>`, authenticated with
 * AI_GATEWAY_API_KEY), so one key covers every provider and switching models is a string change.
 * Under AIMock (USE_AIMOCK=true, the free CI eval) the direct Anthropic id is used instead, because
 * AIMock fakes Anthropic's API at ANTHROPIC_BASE_URL, which the gateway provider never calls.
 * Gateway ids use dots (claude-sonnet-5.5); Anthropic's direct ids use dashes (claude-sonnet-5-5).
 */
const SONNET = env.USE_AIMOCK ? 'anthropic/claude-sonnet-5-5' : 'vercel/anthropic/claude-sonnet-5.5';

/** The descript agent's model. */
export const AGENT_MODEL = SONNET;

/** Model for LLM-judged scorers. */
export const JUDGE_MODEL = SONNET;
