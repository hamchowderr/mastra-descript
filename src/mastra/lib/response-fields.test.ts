import { afterEach, describe, expect, it, vi } from 'vitest';
import { DescriptClient } from './descript-client';
import { agentEditInput, runAgentEdit } from '../tools/agent-edit';
import { importMediaInput, runImportMedia } from '../tools/import-media';
import { publishInput, runPublish } from '../tools/publish';
import { getProjectOutput } from '../tools/projects';

const PROJECT_ID = '9f36ee32-5a2c-47e7-b1a3-94991d3e3ddb';

/** Fake Descript: POST answers with `post`, GET /jobs answers with a stopped job carrying `result`. */
function fakeDescript(post: Record<string, unknown>, result: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: string | URL, init: RequestInit = {}) =>
      init.method === 'POST'
        ? Response.json({ job_id: 'job-1', drive_id: 'd1', project_id: PROJECT_ID, project_url: 'https://web.descript.com/p', ...post })
        : Response.json({ job_id: 'job-1', job_type: 'x', job_state: 'stopped', created_at: '', drive_id: 'd1', result }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('importMedia', () => {
  it('says which file failed on a partial import, and returns created compositions', async () => {
    fakeDescript({}, {
      status: 'partial',
      media_seconds_used: 60,
      media_status: { 'a.mp4': { status: 'success', duration_seconds: 60 }, 'b.mp4': { status: 'failed', error_message: 'Unsupported codec' } },
      created_compositions: [{ id: 'c1', name: 'Main' }],
    });
    const out = await runImportMedia(
      importMediaInput.parse({ project_name: 'P', skip_url_validation: true, media: [{ url: 'https://cdn.test/a.mp4' }, { url: 'https://cdn.test/b.mp4' }] }),
    );
    expect(out.status).toBe('partial');
    expect(out.media_status?.['b.mp4']).toEqual({ status: 'failed', error_message: 'Unsupported codec' });
    expect(out.created_compositions).toEqual([{ id: 'c1', name: 'Main' }]);
  });
});

describe('agentEdit in webhook mode', () => {
  it('returns conversation_id and resolved_model from the POST without polling', async () => {
    fakeDescript({ conversation_id: 'conv-1', resolved_model: 'claude-haiku-5.5' });
    const out = await runAgentEdit(agentEditInput.parse({ project_id: PROJECT_ID, prompt: 'x', callback_url: 'https://hooks.test/descript' }));
    expect(out).toMatchObject({ conversation_id: 'conv-1', resolved_model: 'claude-haiku-5.5', status: undefined });
  });
});

describe('publish', () => {
  it('returns the composition and the media type Descript actually published', async () => {
    fakeDescript({}, { status: 'success', composition_id: 'comp-1', media_type: 'Audio', share_url: 'https://share.descript.com/view/x' });
    const out = await runPublish(publishInput.parse({ project_id: PROJECT_ID }));
    expect(out).toMatchObject({ status: 'success', composition_id: 'comp-1', media_type: 'Audio' });
  });
});

describe('getProject output', () => {
  it('accepts images, empty compositions and existing publishes', () => {
    const parsed = getProjectOutput.safeParse({
      id: PROJECT_ID,
      name: 'P',
      drive_id: 'd1',
      created_at: '',
      updated_at: '',
      folder_path: 'Clients/Acme',
      media_files: { 'logo.png': { type: 'image' }, 'talk.mp4': { type: 'video', duration: 90 } },
      compositions: [{ id: 'c1', name: 'Empty' }],
      publishes: [
        { share_url: 'https://share.descript.com/view/x', composition_id: 'c1', access_level: 'unlisted', media_type: 'video', published_at: '', updated_at: '', name: 'Cut' },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('published project 409', () => {
  it('includes the processing state in the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'conflict', message: 'Published project is not ready', state: 'processing' }, { status: 409 })));
    await expect(new DescriptClient('t').getPublishedProject('slug')).rejects.toThrow('Published project is not ready (state: processing)');
  });
});
