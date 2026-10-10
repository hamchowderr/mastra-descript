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

const { buildImportPayload, checkImportOptions, checkMultitrack, defaultMediaName, importMediaInput, resolveUploadFile, runImportMedia, uniqueMediaNames } = await import('./import-media');

const SIGNED_URL = 'https://uploads.descript.test/signed/clip?sig=abc';
const JOB_ID = 'job-123';
const EXISTING_PROJECT = '9f36ee32-5a2c-47e7-b1a3-94991d3e3ddb';

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
    if (url.endsWith(`/projects/${EXISTING_PROJECT}`) && method === 'GET') {
      return Response.json({ id: EXISTING_PROJECT, name: 'Existing', media_files: { 'clip.mp3': { type: 'audio', duration: 3 } }, compositions: [] });
    }
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
  it('keys media by display name and puts every clip in one composition, in order', () => {
    const payload = buildImportPayload({
      project_name: 'P',
      width: 1080,
      height: 1920,
      media: [
        { key: 'a.mp4', url: 'https://cdn.test/a.mp4', language: 'es' },
        { key: 'Audio/b.mp3', upload: { content_type: 'audio/mpeg', file_size: 10 }, mute: true },
      ],
    });
    expect(payload.add_media).toEqual({
      'a.mp4': { url: 'https://cdn.test/a.mp4', language: 'es' },
      'Audio/b.mp3': { content_type: 'audio/mpeg', file_size: 10 },
    });
    expect(payload.add_compositions).toEqual([
      { name: 'Main', width: 1080, height: 1920, clips: [{ media: 'a.mp4' }, { media: 'Audio/b.mp3', mute: true }] },
    ]);
  });

  it('omits language so Descript auto-detects it', () => {
    const payload = buildImportPayload({ project_name: 'P', media: [{ key: 'a.mp4', url: 'https://cdn.test/a.mp4' }] });
    expect(payload.add_media['a.mp4']).not.toHaveProperty('language');
  });
});

describe('multitrack', () => {
  it('builds the spec v1.2 multitrack_sequence example', () => {
    const payload = buildImportPayload({
      project_name: 'Interview Edit',
      composition_name: 'Rough Cut',
      width: 1920,
      height: 1080,
      media: [
        { key: 'Misc/intro.mp4', url: 'https://example.com/intro.mp4' },
        { key: 'Recordings/camera1.mp4', url: 'https://example.com/camera1.mp4' },
        { key: 'Recordings/camera2.mp4', url: 'https://example.com/camera2.mp4' },
      ],
      multitrack: [{ key: 'Multicam_Track', tracks: [{ media: 2, offset: 0 }, { media: 3, offset: 50 }] }],
    });
    // Same structure as the spec's example request for POST /jobs/import/project_media.
    expect(payload.add_media).toEqual({
      'Misc/intro.mp4': { url: 'https://example.com/intro.mp4' },
      'Recordings/camera1.mp4': { url: 'https://example.com/camera1.mp4' },
      'Recordings/camera2.mp4': { url: 'https://example.com/camera2.mp4' },
      Multicam_Track: { tracks: [{ media: 'Recordings/camera1.mp4', offset: 0 }, { media: 'Recordings/camera2.mp4', offset: 50 }] },
    });
    expect(payload.add_compositions).toEqual([
      { name: 'Rough Cut', width: 1920, height: 1080, clips: [{ media: 'Misc/intro.mp4' }, { media: 'Multicam_Track' }] },
    ]);
  });

  it('places the multitrack where its first track was, and omits unset offsets', () => {
    const payload = buildImportPayload({
      project_name: 'P',
      media: [{ key: 'host.wav', url: 'https://x/h.wav' }, { key: 'outro.mp3', url: 'https://x/o.mp3' }, { key: 'guest.wav', url: 'https://x/g.wav' }],
      multitrack: [{ key: 'Episode', tracks: [{ media: 1 }, { media: 3, offset: 1.5 }] }],
    });
    expect(payload.add_compositions[0].clips).toEqual([{ media: 'Episode' }, { media: 'outro.mp3' }]);
    expect(payload.add_media.Episode).toEqual({ tracks: [{ media: 'host.wav' }, { media: 'guest.wav', offset: 1.5 }] });
  });

  it('rejects tracks that point nowhere, reuse media, or are muted', () => {
    const media = [{}, {}, { mute: true }];
    expect(checkMultitrack(media, [{ tracks: [{ media: 1 }, { media: 2 }] }])).toBeUndefined();
    expect(checkMultitrack(media, [{ tracks: [{ media: 4 }] }])).toMatch(/does not exist/);
    expect(checkMultitrack(media, [{ tracks: [{ media: 1 }] }, { tracks: [{ media: 1 }] }])).toMatch(/more than one/);
    expect(checkMultitrack(media, [{ tracks: [{ media: 3 }] }])).toMatch(/cannot be muted/);
  });

  it('sends a multitrack import with default names and no request on bad input', async () => {
    const { calls, fetchMock } = fakeDescript();
    await runImportMedia(
      input({
        media: [{ url: 'https://cdn.test/cam1.mp4' }, { url: 'https://cdn.test/cam2.mp4' }],
        multitrack: [{ tracks: [{ media: 1 }, { media: 2, offset: 2 }] }],
      }),
    );
    const { add_media, add_compositions } = JSON.parse(new TextDecoder().decode(calls.find((c) => c.method === 'POST')!.body));
    expect(add_media['Multitrack 1']).toEqual({ tracks: [{ media: 'cam1.mp4' }, { media: 'cam2.mp4', offset: 2 }] });
    expect(add_compositions[0].clips).toEqual([{ media: 'Multitrack 1' }]);

    fetchMock.mockClear();
    await expect(runImportMedia(input({ media: [{ url: 'https://cdn.test/a.mp4' }], multitrack: [{ tracks: [{ media: 2 }] }] }))).rejects.toThrow(/does not exist/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('media display names', () => {
  it('defaults to the name given, else the file or URL file name', () => {
    expect(defaultMediaName({ name: ' Interviews/guest.mp4 ' }, 0)).toBe('Interviews/guest.mp4');
    expect(defaultMediaName({ file_path: 'uploads/clip.mp3' }, 0)).toBe('clip.mp3');
    expect(defaultMediaName({ url: 'https://cdn.test/media/My%20Talk.mp4?sig=1' }, 0)).toBe('My Talk.mp4');
    expect(defaultMediaName({ url: 'https://cdn.test/' }, 2)).toBe('media-3');
  });

  it('makes names unique against each other and existing project media', () => {
    expect(uniqueMediaNames(['a.mp4', 'A.mp4', 'b'], ['a (2).mp4'])).toEqual(['a.mp4', 'A (3).mp4', 'b']);
    expect(uniqueMediaNames(['clip.mp3'], ['clip.mp3'])).toEqual(['clip (2).mp3']);
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
    expect(JSON.parse(new TextDecoder().decode(submit.body)).add_media['clip.mp3']).toEqual({
      content_type: 'audio/mpeg',
      file_size: clip.length,
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
    expect(add_media['a.mp4']).toEqual({ url: 'https://cdn.test/a.mp4' });
    expect(add_media['clip.mp3'].content_type).toBe('audio/mpeg');
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('renames media that would conflict with files already in the project', async () => {
    const { calls } = fakeDescript();
    await runImportMedia(input({ project_name: undefined, project_id: EXISTING_PROJECT, media: [{ file_path: 'uploads/clip.mp3' }] }));

    const submit = calls.find((c) => c.method === 'POST')!;
    expect(Object.keys(JSON.parse(new TextDecoder().decode(submit.body)).add_media)).toEqual(['clip (2).mp3']);
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
