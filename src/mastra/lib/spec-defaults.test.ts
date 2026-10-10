import { afterEach, describe, expect, it, vi } from 'vitest';

const PROJECT_ID = '9f36ee32-5a2c-47e7-b1a3-94991d3e3ddb';

/** Fake Descript that records POST bodies and finishes every job successfully. */
function fakeDescript() {
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (init.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return Response.json({ job_id: 'job-1', drive_id: 'd1', project_id: PROJECT_ID, project_url: 'https://web.descript.com/p' });
      }
      return Response.json({
        job_id: 'job-1',
        job_type: 'x',
        job_state: 'stopped',
        created_at: '',
        drive_id: 'd1',
        result: { status: 'success', project_changed: true, share_url: 'https://share.descript.com/view/x' },
      });
    }),
  );
  return posts;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('env', () => {
  it('reads DESCRIPT_HEALTHCHECK_ON_BOOT=false as false', async () => {
    vi.stubEnv('DESCRIPT_HEALTHCHECK_ON_BOOT', 'false');
    const { env } = await import('../../lib/env');
    expect(env.DESCRIPT_HEALTHCHECK_ON_BOOT).toBe(false);
  });

  it('reads DESCRIPT_HEALTHCHECK_ON_BOOT=true as true', async () => {
    vi.stubEnv('DESCRIPT_HEALTHCHECK_ON_BOOT', 'true');
    const { env } = await import('../../lib/env');
    expect(env.DESCRIPT_HEALTHCHECK_ON_BOOT).toBe(true);
  });

  it('defaults the edit model to the claude-haiku alias', async () => {
    const { env } = await import('../../lib/env');
    expect(env.DESCRIPT_AGENT_MODEL).toBe('claude-haiku');
  });
});

describe('request defaults', () => {
  it('agentEdit sends the default model when none is given', async () => {
    const posts = fakeDescript();
    const { agentEditInput, runAgentEdit } = await import('../tools/agent-edit');
    await runAgentEdit(agentEditInput.parse({ project_id: PROJECT_ID, prompt: 'remove filler words' }));
    expect(posts[0].body.model).toBe('claude-haiku');
  });

  it('publish leaves media_type and resolution to Descript by default', async () => {
    const posts = fakeDescript();
    const { publishInput, runPublish } = await import('../tools/publish');
    await runPublish(publishInput.parse({ project_id: PROJECT_ID }));
    expect(posts[0].body).not.toHaveProperty('media_type');
    expect(posts[0].body).not.toHaveProperty('resolution');
  });

  it('publish never sends a resolution for Audio', async () => {
    const posts = fakeDescript();
    const { publishInput, runPublish } = await import('../tools/publish');
    await runPublish(publishInput.parse({ project_id: PROJECT_ID, media_type: 'Audio', resolution: '1080p' }));
    expect(posts[0].body).toMatchObject({ media_type: 'Audio' });
    expect(posts[0].body).not.toHaveProperty('resolution');
  });
});
