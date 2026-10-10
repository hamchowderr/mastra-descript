import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DescriptJob, DescriptApiError } from './descript-client';
import { costMeter } from './cost-meter';
import { handleDescriptCallback } from './descript-webhook';

const SECRET = 's'.repeat(40);

const stopped = (id: string, result: DescriptJob['result']): DescriptJob => ({
  job_id: id,
  job_type: 'agent',
  job_state: 'stopped',
  created_at: '',
  drive_id: 'd1',
  result,
});

/** A Descript client whose getJob returns `job`, so tests can check the receiver re-reads the job. */
const clientReturning = (job: DescriptJob) => ({ getJob: vi.fn(async () => job) });

afterEach(() => {
  costMeter.reset();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('handleDescriptCallback', () => {
  it('rejects a wrong token without reading the job', async () => {
    const client = clientReturning(stopped('job-a', { status: 'success' }));
    const r = await handleDescriptCallback('wrong', { job_id: 'job-a' }, { secret: SECRET, client });
    expect(r.status).toBe(401);
    expect(client.getJob).not.toHaveBeenCalled();
  });

  it('is disabled (404) when no secret is configured', async () => {
    expect((await handleDescriptCallback(SECRET, { job_id: 'x' }, { secret: '' })).status).toBe(404);
  });

  it('rejects a payload with no job_id', async () => {
    expect((await handleDescriptCallback(SECRET, { nope: 1 }, { secret: SECRET, client: clientReturning(stopped('x', {})) })).status).toBe(400);
  });

  it('trusts GET /jobs, not the payload, and records spend once per job', async () => {
    const client = clientReturning(stopped('job-b', { status: 'success', ai_credits_used: 7, media_seconds_used: 30 }));
    // The forged payload claims a different outcome; the receiver ignores it and re-reads the job.
    const first = await handleDescriptCallback(SECRET, { job_id: 'job-b', result: { status: 'error', ai_credits_used: 999 } }, { secret: SECRET, client });
    expect(first).toEqual({ status: 200, body: { job_id: 'job-b', job_type: 'agent', status: 'success', error: undefined, recorded: true } });
    expect(client.getJob).toHaveBeenCalledWith('job-b');

    const replay = await handleDescriptCallback(SECRET, { job_id: 'job-b' }, { secret: SECRET, client });
    expect(replay.body.recorded).toBe(false);
    expect(costMeter.totals()).toMatchObject({ ai_credits_used: 7, media_seconds_used: 30 });
  });

  it('reports a failed job with its error message', async () => {
    const client = clientReturning(stopped('job-c', { status: 'error', error_message: 'Out of AI credits' }));
    const r = await handleDescriptCallback(SECRET, { job_id: 'job-c' }, { secret: SECRET, client });
    expect(r.body).toMatchObject({ status: 'error', error: 'Out of AI credits' });
  });

  it('accepts but does not record a job that has not finished', async () => {
    const client = clientReturning({ ...stopped('job-d', undefined), job_state: 'running' });
    const r = await handleDescriptCallback(SECRET, { job_id: 'job-d' }, { secret: SECRET, client });
    expect(r).toMatchObject({ status: 202, body: { recorded: false } });
  });
});

describe('handleDescriptCallback errors', () => {
  it('answers 404 for a job the token cannot see, instead of crashing', async () => {
    const client = { getJob: vi.fn(async () => { throw new DescriptApiError(403, "You don't have access to this job"); }) };
    expect(await handleDescriptCallback(SECRET, { job_id: 'gone' }, { secret: SECRET, client })).toMatchObject({ status: 404 });
  });

  it('answers 502 when Descript itself fails, so the sender can retry', async () => {
    const client = { getJob: vi.fn(async () => { throw new DescriptApiError(503, 'Service Unavailable'); }) };
    expect(await handleDescriptCallback(SECRET, { job_id: 'x' }, { secret: SECRET, client })).toMatchObject({ status: 502 });
  });
});

describe('webhook: true', () => {
  it('builds the callback URL on the server', async () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://agent.example.com/');
    vi.stubEnv('DESCRIPT_WEBHOOK_SECRET', SECRET);
    const { resolveCallbackUrl } = await import('./descript-webhook');
    expect(resolveCallbackUrl({ webhook: true })).toBe(`https://agent.example.com/webhooks/descript/${SECRET}`);
    expect(resolveCallbackUrl({ webhook: true, callback_url: 'https://mine.test/hook' })).toBe('https://mine.test/hook');
    expect(resolveCallbackUrl({})).toBeUndefined();
  });

  it('explains what is missing when the receiver is not configured', async () => {
    const { resolveCallbackUrl } = await import('./descript-webhook');
    expect(() => resolveCallbackUrl({ webhook: true })).toThrow(/PUBLIC_BASE_URL and DESCRIPT_WEBHOOK_SECRET/);
  });
});
