import { timingSafeEqual } from 'node:crypto';
import { type DescriptJob, DescriptApiError, DescriptClient, jobOutcome } from './descript-client';
import { costMeter } from './cost-meter';
import { env } from '../../lib/env';

/** Path of the built-in receiver. The last segment is DESCRIPT_WEBHOOK_SECRET. */
export const WEBHOOK_PATH = '/webhooks/descript/:token';

/**
 * The callback_url for the built-in receiver, built server-side so the secret never enters
 * the agent's context (and so never lands in traces). Throws if the receiver isn't configured.
 */
export function selfCallbackUrl(): string {
  if (!env.PUBLIC_BASE_URL || !env.DESCRIPT_WEBHOOK_SECRET) {
    throw new Error('webhook: true needs PUBLIC_BASE_URL and DESCRIPT_WEBHOOK_SECRET set on the server. Poll instead (omit webhook), or pass your own callback_url.');
  }
  return `${env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/webhooks/descript/${env.DESCRIPT_WEBHOOK_SECRET}`;
}

/** Resolve the callback a tool should send: an explicit callback_url wins; webhook: true uses the built-in receiver. */
export function resolveCallbackUrl(input: { callback_url?: string; webhook?: boolean }): string | undefined {
  return input.callback_url ?? (input.webhook ? selfCallbackUrl() : undefined);
}

function tokenMatches(token: string, secret: string): boolean {
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Descript may deliver the same callback more than once; count each job's spend once.
const recorded = new Set<string>();

export type CallbackResult = { status: 200 | 202 | 400 | 401 | 404 | 502; body: Record<string, unknown> };

/**
 * Handle a Descript job callback. Descript documents no webhook signing, so the payload is never
 * trusted: the token in the URL must match DESCRIPT_WEBHOOK_SECRET, and the job is re-read from
 * GET /jobs/{job_id} before anything is recorded. Spend from webhook-mode jobs (which the tools
 * can't see, because they return without polling) is added to the session cost meter here.
 */
export async function handleDescriptCallback(
  token: string,
  payload: unknown,
  deps: { secret?: string; client?: Pick<DescriptClient, 'getJob'> } = {},
): Promise<CallbackResult> {
  const secret = deps.secret ?? env.DESCRIPT_WEBHOOK_SECRET;
  if (!secret) return { status: 404, body: { error: 'webhook receiver not configured' } };
  if (!tokenMatches(token, secret)) return { status: 401, body: { error: 'invalid token' } };
  const jobId = (payload as { job_id?: unknown } | null)?.job_id;
  if (typeof jobId !== 'string' || !jobId) return { status: 400, body: { error: 'payload has no job_id' } };

  const client = deps.client ?? new DescriptClient(env.DESCRIPT_API_TOKEN);
  let job: DescriptJob;
  try {
    job = await client.getJob(jobId);
  } catch (e) {
    // A job this token can't see (unknown id, deleted project, other drive) is a permanent 404.
    // Anything else is treated as transient (502) so the sender may retry.
    if (e instanceof DescriptApiError && (e.status === 403 || e.status === 404)) {
      return { status: 404, body: { job_id: jobId, error: 'job not found or not accessible with this token' } };
    }
    return { status: 502, body: { job_id: jobId, error: `could not read the job from Descript: ${e instanceof Error ? e.message : String(e)}` } };
  }
  if (job.job_state !== 'stopped' && job.job_state !== 'cancelled') {
    return { status: 202, body: { job_id: jobId, job_state: job.job_state, recorded: false } };
  }
  const { status, error } = jobOutcome(job);
  const firstDelivery = !recorded.has(jobId);
  if (firstDelivery) {
    recorded.add(jobId);
    const r = job.result ?? {};
    costMeter.addCredits(typeof r.ai_credits_used === 'number' ? r.ai_credits_used : undefined);
    costMeter.addMediaSeconds(typeof r.media_seconds_used === 'number' ? r.media_seconds_used : undefined);
  }
  return { status: 200, body: { job_id: jobId, job_type: job.job_type, status, error, recorded: firstDelivery } };
}
