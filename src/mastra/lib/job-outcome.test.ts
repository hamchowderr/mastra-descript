import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DescriptJob, DescriptClient, jobOutcome } from './descript-client';
import { agentEditInput, runAgentEdit } from '../tools/agent-edit';
import { publishInput, runPublish } from '../tools/publish';
import { jobIdSchema } from '../tools/jobs';

// Job ids as the live API returns them (prefixed, not bare UUIDs).
const JOB_ID = 'project-agent-edit-7ad4058c-301b-450c-be80-4c99439cb44d';
const PROJECT_ID = '9f36ee32-5a2c-47e7-b1a3-94991d3e3ddb';

const job = (overrides: Partial<DescriptJob>): DescriptJob => ({
  job_id: JOB_ID,
  job_type: 'agent',
  job_state: 'stopped',
  created_at: '2026-10-09T00:00:00Z',
  drive_id: 'd1',
  project_id: PROJECT_ID,
  project_url: `https://web.descript.com/${PROJECT_ID}`,
  ...overrides,
});

/** Fake Descript: the job POST returns JOB_ID; each GET /jobs/{id} returns the next state in `states`. */
function fakeDescript(states: DescriptJob[]) {
  const gets: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if ((init.method ?? 'GET') === 'POST') {
      return Response.json({ job_id: JOB_ID, drive_id: 'd1', project_id: PROJECT_ID, project_url: `https://web.descript.com/${PROJECT_ID}` });
    }
    gets.push(url);
    return Response.json(states[Math.min(gets.length - 1, states.length - 1)]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { gets };
}

afterEach(() => vi.unstubAllGlobals());

describe('jobOutcome', () => {
  it('maps the spec result shapes', () => {
    expect(jobOutcome(job({ result: { status: 'success' } }))).toEqual({ status: 'success' });
    expect(jobOutcome(job({ result: { status: 'partial' } }))).toEqual({ status: 'partial' });
    expect(jobOutcome(job({ result: { status: 'error', error_message: 'Media URL returned 404', error_code: 'media_unreachable' } }))).toEqual({
      status: 'error',
      error: 'Media URL returned 404 (media_unreachable)',
    });
    expect(jobOutcome(job({ result: { status: 'error' } })).status).toBe('error');
    expect(jobOutcome(job({ job_state: 'cancelled' }))).toMatchObject({ status: 'cancelled' });
  });
});

describe('pollJob', () => {
  it('keeps polling through queued and running until stopped', async () => {
    const { gets } = fakeDescript([
      job({ job_state: 'queued' }),
      job({ job_state: 'running' }),
      job({ job_state: 'stopped', result: { status: 'success' } }),
    ]);
    const final = await new DescriptClient('t').pollJob(JOB_ID);
    expect(final.job_state).toBe('stopped');
    expect(gets).toHaveLength(3);
  });

  it('stops on cancelled', async () => {
    const { gets } = fakeDescript([job({ job_state: 'queued' }), job({ job_state: 'cancelled' })]);
    expect((await new DescriptClient('t').pollJob(JOB_ID)).job_state).toBe('cancelled');
    expect(gets).toHaveLength(2);
  });
});

describe('agentEdit results', () => {
  const run = () => runAgentEdit(agentEditInput.parse({ project_id: PROJECT_ID, prompt: 'remove filler words' }));

  it('reports a failed edit with Descript\'s error message', async () => {
    fakeDescript([job({ result: { status: 'error', error_message: 'Out of AI credits', error_code: 'insufficient_credits' } })]);
    expect(await run()).toMatchObject({ status: 'error', error: 'Out of AI credits (insufficient_credits)' });
  });

  it('reports success that changed nothing as a stalled partial', async () => {
    fakeDescript([job({ result: { status: 'success', agent_response: 'Here is my plan…', project_changed: false } })]);
    const out = await run();
    expect(out.status).toBe('partial');
    expect(out.error).toMatch(/did NOT execute/);
  });

  it('reports a real success', async () => {
    fakeDescript([job({ result: { status: 'success', agent_response: 'Done', project_changed: true, ai_credits_used: 4 } })]);
    expect(await run()).toMatchObject({ status: 'success', ai_credits_used: 4, error: undefined });
  });

  it('reports a cancelled edit', async () => {
    fakeDescript([job({ job_state: 'cancelled' })]);
    expect((await run()).status).toBe('cancelled');
  });
});

describe('publish results', () => {
  it('reports a failed publish with Descript\'s error message', async () => {
    fakeDescript([job({ job_type: 'publish', result: { status: 'error', error_message: 'Composition is empty' } })]);
    const out = await runPublish(publishInput.parse({ project_id: PROJECT_ID }));
    expect(out).toMatchObject({ status: 'error', error: 'Composition is empty' });
  });
});

describe('getJob', () => {
  it('accepts the prefixed job ids the live API returns', () => {
    expect(jobIdSchema.safeParse(JOB_ID).success).toBe(true);
    expect(jobIdSchema.safeParse('').success).toBe(false);
  });
});
