import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// env.ts reads WORKSPACE_ROOT at import time, so the temp workspace must exist before the
// tool module loads. `outside` sits next to it and holds a file the agent must never upload.
const base = await mkdtemp(path.join(tmpdir(), 'import-media-test-'));
const workspace = path.join(base, 'workspace');
const outside = path.join(base, 'outside');
await mkdir(path.join(workspace, 'uploads'), { recursive: true });
await mkdir(outside, { recursive: true });
process.env.WORKSPACE_ROOT = workspace;

const clip = Buffer.alloc(4096, 7);
await writeFile(path.join(workspace, 'uploads', 'clip.mp3'), clip);
await writeFile(path.join(workspace, 'uploads', 'notes.txt'), 'not media');
await writeFile(path.join(workspace, 'uploads', 'empty.mp3'), '');
await writeFile(path.join(outside, 'secret.mp3'), 'SECRET');
// 'junction' needs no admin rights on Windows; other platforms ignore the type and make a dir symlink.
await symlink(outside, path.join(workspace, 'uploads', 'escape'), 'junction');

const { buildImportPayload, checkImportOptions, importMediaInput, resolveUploadFile, runImportMedia } = await import('./import-media');

const SIGNED_URL = 'https://uploads.descript.test/signed/clip?sig=abc';
const JOB_ID = 'job-123';

type Call = { url: string; method: string; headers: Headers; body?: Uint8Array };

/** Stub fetch with a tiny fake Descript. `uploadStatus` controls the signed-URL PUT response. */
function fakeDescript({ uploadStatus = 200 } = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const body = init.body instanceof ReadableStream
      ? new Uint8Array(await new Response(init.body).arrayBuffer())
      : typeof init.body === 'string' ? new TextEncoder().encode(init.body) : undefined;
    calls.push({ url, method, headers: new Headers(init.headers), body });

    if (url.endsWith('/jobs/import/project_media') && method === 'POST') {
      const payload = JSON.parse(new TextDecoder().decode(body));
      const upload_urls = Object.fromEntries(
        Object.entries(payload.add_media as Record<string, { content_type?: string }>)
          .filter(([, m]) => m.content_type)
          .map(([key]) => [key, { upload_url: SIGNED_URL, asset_id: 'a1', artifact_id: 'r1' }]),
      );
      return Response.json({ job_id: JOB_ID, drive_id: 'd1', project_id: 'p1', project_url: 'https://web.descript.com/p1', upload_urls });
    }
    if (url === SIGNED_URL && method === 'PUT') return new Response(uploadStatus === 200 ? '' : 'denied', { status: uploadStatus });
    if (url.endsWith(`/jobs/${JOB_ID}`) && method === 'GET') {
      return Response.json({ job_id: JOB_ID, job_state: 'stopped', result: { status: 'success', media_seconds_used: 3 } });
    }
    if (url.endsWith(`/jobs/${JOB_ID}`) && method === 'DELETE') return new Response(null, { status: 204 });
    return new Response('unexpected request', { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

const input = (overrides: Record<string, unknown>) =>
  importMediaInput.parse({ project_name: 'Test', skip_url_validation: true, ...overrides });

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('checkImportOptions', () => {
  it('accepts a plain import', () => {
    expect(checkImportOptions({})).toBeUndefined();
    expect(checkImportOptions({ width: 1080, height: 1920, workspace_name: 'General', team_access: 'edit' })).toBeUndefined();
  });

  it('rejects combinations Descript would refuse', () => {
    expect(checkImportOptions({ width: 1080 })).toMatch(/both width and height/);
    expect(checkImportOptions({ workspace_name: 'General', project_id: 'x' })).toMatch(/only applies when creating/);
    expect(checkImportOptions({ workspace_name: 'Personal', team_access: 'edit' })).toMatch(/Personal workspace/);
    expect(checkImportOptions({ workspace_name: 'Client Work', team_access: 'none' })).toMatch(/is shared/);
  });
});

describe('buildImportPayload', () => {
  it('keys media clip1..N and puts every clip in one composition, in order', () => {
    const payload = buildImportPayload({
      project_name: 'P',
      width: 1080,
      height: 1920,
      media: [
        { url: 'https://cdn.test/a.mp4' },
        { upload: { content_type: 'audio/mpeg', file_size: 10 }, mute: true },
      ],
    });
    expect(payload.add_media).toEqual({
      clip1: { url: 'https://cdn.test/a.mp4', language: 'en' },
      clip2: { content_type: 'audio/mpeg', file_size: 10, language: 'en' },
    });
    expect(payload.add_compositions).toEqual([
      { name: 'Main', width: 1080, height: 1920, clips: [{ media: 'clip1' }, { media: 'clip2', mute: true }] },
    ]);
  });
});

describe('resolveUploadFile', () => {
  it('resolves a media file inside the workspace', async () => {
    const file = await resolveUploadFile('uploads/clip.mp3', workspace);
    expect(file).toMatchObject({ content_type: 'audio/mpeg', file_size: clip.length });
  });

  it.each([
    ['a ../ escape', '../outside/secret.mp3', /only files inside the agent workspace/],
    ['an absolute path outside', path.join(outside, 'secret.mp3'), /only files inside the agent workspace/],
    ['a link that points outside', 'uploads/escape/secret.mp3', /only files inside the agent workspace/],
    ['an unsupported type', 'uploads/notes.txt', /Unsupported file type/],
    ['an empty file', 'uploads/empty.mp3', /is empty/],
    ['a missing file', 'uploads/nope.mp3', /File not found/],
  ])('rejects %s', async (_label, filePath, message) => {
    await expect(resolveUploadFile(filePath, workspace)).rejects.toThrow(message);
  });
});

describe('runImportMedia', () => {
  it('uploads a local file to the signed URL without the Descript token', async () => {
    const { calls } = fakeDescript();
    const out = await runImportMedia(input({ media: [{ file_path: 'uploads/clip.mp3' }] }));

    expect(out).toMatchObject({ job_id: JOB_ID, status: 'success', media_seconds_used: 3, media_count: 1 });
    const submit = calls.find((c) => c.method === 'POST')!;
    expect(JSON.parse(new TextDecoder().decode(submit.body)).add_media.clip1).toEqual({
      content_type: 'audio/mpeg',
      file_size: clip.length,
      language: 'en',
    });
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe(SIGNED_URL);
    expect(put.headers.get('authorization')).toBeNull();
    expect(put.headers.get('content-length')).toBe(String(clip.length));
    expect(Buffer.from(put.body!).equals(clip)).toBe(true);
  });

  it('mixes a URL and a local file in one import', async () => {
    const { calls } = fakeDescript();
    await runImportMedia(input({ media: [{ url: 'https://cdn.test/a.mp4' }, { file_path: 'uploads/clip.mp3' }] }));

    const submit = calls.find((c) => c.method === 'POST')!;
    const { add_media } = JSON.parse(new TextDecoder().decode(submit.body));
    expect(add_media.clip1).toEqual({ url: 'https://cdn.test/a.mp4', language: 'en' });
    expect(add_media.clip2.content_type).toBe('audio/mpeg');
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it.each([
    ['a path outside the workspace', [{ file_path: '../outside/secret.mp3' }]],
    ['both url and file_path', [{ url: 'https://cdn.test/a.mp4', file_path: 'uploads/clip.mp3' }]],
    ['neither url nor file_path', [{}]],
  ])('rejects %s before sending any request', async (_label, media) => {
    const { fetchMock } = fakeDescript();
    await expect(runImportMedia(input({ media }))).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels the import job when the upload fails', async () => {
    const { calls } = fakeDescript({ uploadStatus: 403 });
    await expect(runImportMedia(input({ media: [{ file_path: 'uploads/clip.mp3' }] }))).rejects.toThrow(
      new RegExp(`import job ${JOB_ID} cancelled`),
    );
    const deletes = calls.filter((c) => c.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].url).toMatch(new RegExp(`/jobs/${JOB_ID}$`));
    expect(calls.some((c) => c.method === 'GET')).toBe(false);
  });
});
