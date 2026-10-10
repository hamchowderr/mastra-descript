import { afterEach, describe, expect, it, vi } from 'vitest';
import { DescriptClient } from './descript-client';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Fake fetch that always answers with `status` and counts calls. */
function alwaysStatus(status: number, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn(async () => Response.json({ error: 'x', message: `HTTP ${status}` }, { status, headers }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// retries: 2 so a repeatable request makes 3 attempts in total.
const client = () => new DescriptClient('t', { retries: 2 });

describe('retry safety', () => {
  it('never retries a job-creating POST on 5xx, and says the job may exist', async () => {
    const fetchMock = alwaysStatus(502);
    await expect(client().agentEdit({ project_id: 'p', prompt: 'x', model: 'claude-haiku' })).rejects.toThrow(/check listJobs before retrying/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a GET on 5xx up to the retry budget', async () => {
    vi.useFakeTimers();
    const fetchMock = alwaysStatus(503);
    const done = expect(client().getJob('job-1')).rejects.toThrow();
    await vi.runAllTimersAsync();
    await done;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops retrying 429s after the cap', async () => {
    vi.useFakeTimers();
    const fetchMock = alwaysStatus(429, { 'Retry-After': '1' });
    const done = expect(client().importMedia({ project_name: 'P', add_media: {} })).rejects.toThrow();
    await vi.runAllTimersAsync();
    await done;
    expect(fetchMock).toHaveBeenCalledTimes(6); // first attempt + 5 retries
  });
});
