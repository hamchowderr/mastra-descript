import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient, JOB_OUTCOMES, jobOutcome, uploadToSignedUrl } from '../lib/descript-client';
import { costMeter } from '../lib/cost-meter';
import { env } from '../../lib/env';
import { resolveCallbackUrl } from '../lib/descript-webhook';

const mediaItem = z.object({
  url: z.string().url().optional().describe('Publicly accessible URL to the media file (MP4, MOV, WAV, FLAC, AAC, MP3). Provide exactly one of url or file_path.'),
  file_path: z
    .string()
    .optional()
    .describe('A local file to upload directly (no public URL needed), relative to the agent workspace folder (WORKSPACE_ROOT, default ./agent-workspace), e.g. "uploads/interview.mp4". Files outside that folder are rejected. Formats: mp4, mov, wav, flac, aac, m4a, mp3. Provide exactly one of url or file_path.'),
  name: z
    .string()
    .optional()
    .describe('Display name for this media in the Descript project, optionally with a folder path (e.g. "Interviews/guest.mp4"). Defaults to the file or URL file name. Names are made unique automatically.'),
  language: z.string().optional().describe('ISO 639-1 language code for transcription (e.g. "en", "es"). Omit to let Descript auto-detect the language.'),
  mute: z
    .boolean()
    .optional()
    .describe('CAUTION: on a normal clip Descript mutes the composition\'s whole script layer — this silences EVERY clip in the composition, not just this one. Only set true when the whole composition should be silent (e.g. a b-roll-only cut).'),
});

/**
 * Pure: turn the tool input into the DescriptClient.importMedia payload — a keyed
 * `add_media` map (clip1..clipN) plus one composition whose clips reference every
 * media key, in array order. Kept separate from `execute` so it's unit-testable
 * without hitting the API (a real import consumes media minutes).
 */
/**
 * File types Descript documents as supported, by extension, with the MIME type sent as content_type.
 * Source: help.descript.com/add-and-manage-media/supported-file-types (checked 2026-10-09).
 * Unsupported there: OGG, WMA, MTS, OGV, AVI, WMV and documents (DOCX, TXT, RTF). Max size is 1-50 GB by plan.
 */
export const UPLOAD_CONTENT_TYPES: Record<string, string> = {
  // audio
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.aac': 'audio/aac',
  // video
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mxf': 'application/mxf',
  // image
  '.bmp': 'image/bmp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  // other
  '.pdf': 'application/pdf',
};

/** The display name a media item gets by default: its own `name`, else the file or URL file name. */
export function defaultMediaName(m: { name?: string; url?: string; file_path?: string }, index: number): string {
  if (m.name?.trim()) return m.name.trim();
  if (m.file_path) return path.basename(m.file_path);
  if (m.url) {
    try {
      const base = decodeURIComponent(new URL(m.url).pathname.split('/').filter(Boolean).pop() ?? '');
      if (base) return base;
    } catch {
      // fall through to the generic name
    }
  }
  return `media-${index + 1}`;
}

/**
 * Pure: make display names unique against each other and against names already in the project
 * (spec: importing into an existing project fails with 400 if a media filename conflicts).
 * Clashes get " (2)", " (3)"… before the extension. Comparison is case-insensitive.
 */
export function uniqueMediaNames(names: string[], existing: Iterable<string> = []): string[] {
  const taken = new Set([...existing].map((n) => n.toLowerCase()));
  return names.map((name) => {
    const ext = path.extname(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * Resolve a model-supplied file path to a real file INSIDE `root`, or throw. The agent picks
 * the path, so this is the guard against a prompt steering it into uploading e.g. `.env`:
 * resolves symlinks on both sides, rejects anything that lands outside root, non-files,
 * empty files and unsupported extensions.
 */
export async function resolveUploadFile(filePath: string, root: string): Promise<{ absPath: string; content_type: string; file_size: number }> {
  const realRoot = await realpath(root).catch(() => {
    throw new Error(`Upload folder ${root} does not exist — create it and put the file there (WORKSPACE_ROOT).`);
  });
  const candidate = path.resolve(realRoot, filePath);
  const absPath = await realpath(candidate).catch(() => {
    throw new Error(`File not found in the agent workspace: ${filePath}`);
  });
  if (absPath !== realRoot && !absPath.startsWith(realRoot + path.sep)) {
    throw new Error(`Refusing to upload ${filePath}: only files inside the agent workspace folder can be uploaded.`);
  }
  const info = await stat(absPath);
  if (!info.isFile()) throw new Error(`${filePath} is not a file.`);
  if (info.size === 0) throw new Error(`${filePath} is empty.`);
  const content_type = UPLOAD_CONTENT_TYPES[path.extname(absPath).toLowerCase()];
  if (!content_type) {
    throw new Error(`Unsupported file type for ${filePath} — use one of: ${Object.keys(UPLOAD_CONTENT_TYPES).join(', ')}`);
  }
  return { absPath, content_type, file_size: info.size };
}

/** A Multitrack Sequence: media items (by 1-based position in `media`) played together, each with an optional sync offset. */
export type MultitrackInput = { name?: string; tracks: Array<{ media: number; offset?: number }> };

/**
 * Pure: reject multitrack input Descript can't use, before any job is submitted. Each track must point
 * at an existing media item, a media item can belong to only one multitrack, and media inside a
 * multitrack are not composition clips, so `mute` can't apply to them.
 */
export function checkMultitrack(media: Array<{ mute?: boolean }>, multitrack: MultitrackInput[] = []): string | undefined {
  const used = new Map<number, number>();
  for (const [s, seq] of multitrack.entries()) {
    for (const t of seq.tracks) {
      if (!Number.isInteger(t.media) || t.media < 1 || t.media > media.length) {
        return `Multitrack ${s + 1}: track media ${t.media} does not exist (media has ${media.length} item(s), numbered from 1).`;
      }
      if (used.has(t.media)) return `Media item ${t.media} is used in more than one multitrack track; each media item can be one track only.`;
      used.set(t.media, s);
      if (media[t.media - 1].mute) return `Media item ${t.media} is a multitrack track, so it is not a composition clip and cannot be muted.`;
    }
  }
  return undefined;
}

export function buildImportPayload(input: {
  media: Array<{ key: string; url?: string; upload?: { content_type: string; file_size: number }; language?: string; mute?: boolean }>;
  /** Already-validated multitracks with their final display-name keys. */
  multitrack?: Array<{ key: string; tracks: Array<{ media: number; offset?: number }> }>;
  project_name?: string;
  project_id?: string;
  team_access?: 'edit' | 'comment' | 'view' | 'none';
  folder_name?: string;
  workspace_name?: string;
  composition_name?: string;
  width?: number;
  height?: number;
}) {
  type MediaEntry = { url?: string; content_type?: string; file_size?: number; language?: string } | { tracks: Array<{ media: string; offset?: number }> };
  const add_media: Record<string, MediaEntry> = {};
  const clips: Array<{ media: string; mute?: boolean }> = [];
  // A multitrack replaces its tracks in the clip list, at the position of its first track.
  const sequenceAt = new Map<number, string>();
  const inSequence = new Set<number>();
  for (const seq of input.multitrack ?? []) {
    const positions = seq.tracks.map((t) => t.media);
    positions.forEach((p) => inSequence.add(p));
    sequenceAt.set(Math.min(...positions), seq.key);
  }
  input.media.forEach((m, i) => {
    const language = m.language ? { language: m.language } : {};
    add_media[m.key] = m.upload
      ? { content_type: m.upload.content_type, file_size: m.upload.file_size, ...language }
      : { url: m.url, ...language };
    const position = i + 1;
    const sequenceKey = sequenceAt.get(position);
    if (sequenceKey) clips.push({ media: sequenceKey });
    else if (!inSequence.has(position)) clips.push(m.mute ? { media: m.key, mute: true } : { media: m.key });
  });
  for (const seq of input.multitrack ?? []) {
    add_media[seq.key] = {
      tracks: seq.tracks.map((t) => (t.offset != null ? { media: input.media[t.media - 1].key, offset: t.offset } : { media: input.media[t.media - 1].key })),
    };
  }
  const size = input.width != null && input.height != null ? { width: input.width, height: input.height } : {};
  return {
    project_name: input.project_name,
    project_id: input.project_id,
    team_access: input.team_access,
    folder_name: input.folder_name,
    workspace_name: input.workspace_name,
    add_media,
    add_compositions: [{ name: input.composition_name ?? 'Main', ...size, clips }],
  };
}

/**
 * Pure: reject option combinations Descript would 400/404 on, before any job is submitted.
 * Rules from the v1.2 spec: workspace_name only applies to NEW projects; `Personal` requires
 * team_access none/omitted; `General` or a custom workspace rejects team_access `none`.
 * width/height must come together (Descript defaults each one separately to 1920×1080,
 * so a lone value silently produces an odd shape).
 */
export function checkImportOptions(input: {
  project_id?: string;
  workspace_name?: string;
  team_access?: 'edit' | 'comment' | 'view' | 'none';
  width?: number;
  height?: number;
}): string | undefined {
  if ((input.width == null) !== (input.height == null)) {
    return 'Provide both width and height (e.g. 1080 × 1920 for vertical), or neither for the default 1920 × 1080.';
  }
  const ws = input.workspace_name?.trim();
  if (!ws) return undefined;
  if (input.project_id) return 'workspace_name only applies when creating a new project (project_name), not when adding to project_id.';
  if (ws.toLowerCase() === 'personal') {
    if (input.team_access && input.team_access !== 'none') return 'The Personal workspace only allows team_access "none" (or omit it).';
  } else if (input.team_access === 'none') {
    return `Workspace "${ws}" is shared, so team_access must be edit, comment or view (omit it for view).`;
  }
  return undefined;
}

/**
 * Pre-flight a media URL the way Descript's importer does (aakrokr's analysis: HEAD + GET Range:0-0)
 * so a bad URL fails INSTANTLY here instead of burning a Descript import job + media minutes.
 * The fetch hits the media host (1 byte), never Descript — zero Descript cost. Returns ok or a reason.
 */
export async function validateMediaUrl(url: string, timeoutMs = 10000): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: ac.signal });
  } catch (e) {
    return { ok: false, reason: `unreachable or timed out (${e instanceof Error ? e.message : String(e)})` };
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: `not publicly accessible (HTTP ${res.status}); Descript needs a public or pre-signed URL` };
  if (res.status === 404) return { ok: false, reason: 'not found (HTTP 404)' };
  if (res.status !== 206 && !res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  const acceptRanges = res.headers.get('accept-ranges');
  if (res.status !== 206 && acceptRanges !== 'bytes') {
    return { ok: false, reason: `no HTTP Range support (status ${res.status}, Accept-Ranges: ${acceptRanges ?? 'none'}); Descript requires range requests` };
  }
  const ct = (res.headers.get('content-type') ?? '').toLowerCase().split(';')[0].trim();
  const okType = ct === '' || /^(video|audio)\//.test(ct) || ct === 'application/octet-stream';
  if (!okType) return { ok: false, reason: `unexpected Content-Type "${ct}" (expected video/* or audio/*) — is this a real media file?` };
  return { ok: true };
}

export const importMediaInput = z.object({
  media: z
    .array(mediaItem)
    .min(1)
    .describe('One or more media files to import. Each becomes a clip in the composition (in order). Pass a single-element array to import one file.'),
  project_name: z.string().optional().describe('Name for a new project (mutually exclusive with project_id)'),
  project_id: z.string().uuid().optional().describe('UUID of an existing project (mutually exclusive with project_name)'),
  composition_name: z.string().default('Main').describe('Name of the composition that the media is added to'),
  folder_name: z
    .string()
    .optional()
    .describe('Optional folder for a NEW project; nested paths supported with "/" (e.g. "Client Work/Q3"). Ignored when adding to an existing project_id.'),
  team_access: z.enum(['edit', 'comment', 'view', 'none']).optional().describe('Access level for new projects only'),
  workspace_name: z
    .string()
    .optional()
    .describe('Workspace for a NEW project: "Personal" (private), "General" (shared drive), or an existing custom workspace by name (case-insensitive; unknown names fail). Personal requires team_access none/omitted; shared workspaces need edit/comment/view (defaults to view).'),
  width: z
    .number()
    .int()
    .min(16)
    .max(7680)
    .optional()
    .describe('Composition width in pixels. Pass together with height. Vertical (Shorts/Reels/TikTok) = 1080 × 1920; square = 1080 × 1080. Omit both for 1920 × 1080.'),
  height: z.number().int().min(16).max(7680).optional().describe('Composition height in pixels. Pass together with width.'),
  multitrack: z
    .array(
      z.object({
        name: z.string().optional().describe('Display name for the multitrack in the project (default "Multitrack 1", "Multitrack 2"…).'),
        tracks: z
          .array(
            z.object({
              media: z.number().int().min(1).describe('Which media item is this track: its 1-based position in `media`.'),
              offset: z.number().optional().describe('Seconds to shift this track to sync it with the others (default 0).'),
            }),
          )
          .min(1),
      }),
    )
    .optional()
    .describe(
      'Optional Multitrack Sequences: media items played TOGETHER as synced tracks (e.g. two camera angles, or host + guest mics recorded separately), instead of one after another. Each media item can be in one multitrack; the multitrack takes the place of its tracks in the composition, at the position of its first track.',
    ),
  skip_url_validation: z
    .boolean()
    .default(false)
    .describe('Skip the pre-flight URL reachability/Range check (only set true if a valid URL is being wrongly rejected)'),
  callback_url: z
    .string()
    .url()
    .optional()
    .describe('Optional webhook. If set, Descript POSTs the full job result here on completion and the tool returns IMMEDIATELY without polling (best for long imports). If omitted, the tool polls to completion (default).'),
  webhook: z
    .boolean()
    .optional()
    .describe('Return immediately and let the built-in receiver on this server record the result (spend included) when Descript finishes. Needs PUBLIC_BASE_URL and DESCRIPT_WEBHOOK_SECRET on the server. Use for long jobs; check later with getJob.'),
});

export const importMediaOutput = z.object({
  job_id: z.string(),
  project_id: z.string(),
  project_url: z.string(),
  media_count: z.number(),
  media_seconds_used: z.number().optional().describe('Media-seconds consumed (transcription). No AI credits — import never invokes Underlord.'),
  status: z.enum(JOB_OUTCOMES).optional().describe('success | partial (some files failed) | error | cancelled. Absent in webhook mode.'),
  media_status: z
    .record(z.string(), z.object({ status: z.string(), duration_seconds: z.number().optional(), error_message: z.string().optional() }))
    .optional()
    .describe('Per-file result keyed by display name: on a partial import this says which file failed and why.'),
  created_compositions: z
    .array(z.object({ id: z.string().optional(), name: z.string().optional() }))
    .optional()
    .describe('Compositions the import created (ids usable as composition_id).'),
  error: z.string().optional(),
});

export async function runImportMedia(context: z.infer<typeof importMediaInput>): Promise<z.infer<typeof importMediaOutput>> {
  if (Boolean(context.project_name) === Boolean(context.project_id)) {
    throw new Error('Provide exactly one of project_name (new project) or project_id (existing project).');
  }
  const optionError = checkImportOptions(context);
  if (optionError) throw new Error(optionError);
  const badItem = context.media.findIndex((m) => Boolean(m.url) === Boolean(m.file_path));
  if (badItem !== -1) throw new Error(`Media item ${badItem + 1}: provide exactly one of url or file_path.`);
  const multitrackError = checkMultitrack(context.media, context.multitrack);
  if (multitrackError) throw new Error(multitrackError);
  if (!context.skip_url_validation) {
    const urls = context.media.flatMap((m) => (m.url ? [m.url] : []));
    const checks = await Promise.all(urls.map(async (url) => ({ url, result: await validateMediaUrl(url) })));
    const bad = checks.filter((c) => !c.result.ok);
    if (bad.length > 0) {
      throw new Error(
        `URL pre-validation failed for ${bad.length} of ${urls.length} media URL(s) — not submitting (saves media minutes):\n` +
          bad.map((b) => `  • ${b.url} — ${(b.result as { reason: string }).reason}`).join('\n') +
          '\nFix the URL(s), or pass skip_url_validation: true to bypass.',
      );
    }
  }
  // Resolve every local file BEFORE submitting, so a bad path costs nothing.
  const resolved = await Promise.all(
    context.media.map(async (m) => (m.file_path ? { ...m, file: await resolveUploadFile(m.file_path, env.WORKSPACE_ROOT) } : { ...m, file: undefined })),
  );
  const callbackUrl = resolveCallbackUrl(context);
  const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
  // Adding to an existing project: read it (free) so new media, multitrack and composition names don't
  // clash with what is there. Descript stores multitracks under "Sequences/<name>", and every import
  // creates a new composition (there is no "append to an existing composition"), so a second import
  // would otherwise add another composition with the same name, e.g. a second "Main".
  const project = context.project_id ? await client.getProject(context.project_id) : undefined;
  const existingMedia = Object.keys(project?.media_files ?? {});
  const existing = [...existingMedia, ...existingMedia.filter((k) => k.startsWith('Sequences/')).map((k) => k.slice('Sequences/'.length))];
  const compositionName = project
    ? uniqueMediaNames([context.composition_name], project.compositions.map((c) => c.name))[0]
    : context.composition_name;
  const multitrack = context.multitrack ?? [];
  const names = uniqueMediaNames(
    [...context.media.map((m, i) => defaultMediaName(m, i)), ...multitrack.map((seq, i) => seq.name?.trim() || `Multitrack ${i + 1}`)],
    existing,
  );
  const keys = names.slice(0, context.media.length);
  const sequenceKeys = names.slice(context.media.length);
  const job = await client.importMedia({
    ...buildImportPayload({
      ...context,
      composition_name: compositionName,
      media: resolved.map((m, i) => ({
        key: keys[i],
        url: m.url,
        upload: m.file ? { content_type: m.file.content_type, file_size: m.file.file_size } : undefined,
        language: m.language,
        mute: m.mute,
      })),
      multitrack: multitrack.map((seq, i) => ({ key: sequenceKeys[i], tracks: seq.tracks })),
    }),
    callback_url: callbackUrl,
  });
  // Direct uploads: PUT each file to its signed URL. The job processes them automatically
  // once the bytes land. On any failure, cancel the job so it doesn't sit waiting for files.
  for (const [i, m] of resolved.entries()) {
    if (!m.file) continue;
    const target = job.upload_urls?.[keys[i]]?.upload_url;
    try {
      if (!target) throw new Error(`Descript returned no upload URL for ${m.file_path}`);
      await uploadToSignedUrl(target, m.file.absPath, m.file.file_size);
    } catch (e) {
      await client.cancelJob(job.job_id).catch(() => undefined);
      throw new Error(`Upload of ${m.file_path} failed, import job ${job.job_id} cancelled: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (callbackUrl) {
    // Webhook mode: don't poll — Descript will POST the full job result to callback_url.
    return { job_id: job.job_id, project_id: job.project_id, project_url: job.project_url, media_count: context.media.length, media_seconds_used: undefined, status: undefined, media_status: undefined, created_compositions: undefined, error: undefined };
  }
  const final = await client.pollJob(job.job_id);
  const { status, error } = jobOutcome(final);
  const mediaSeconds = typeof final.result?.media_seconds_used === 'number' ? final.result.media_seconds_used : undefined;
  costMeter.addMediaSeconds(mediaSeconds);
  return {
    job_id: job.job_id,
    project_id: job.project_id,
    project_url: job.project_url,
    media_count: context.media.length,
    media_seconds_used: mediaSeconds,
    status,
    media_status: final.result?.media_status as z.infer<typeof importMediaOutput>['media_status'],
    created_compositions: Array.isArray(final.result?.created_compositions)
      ? (final.result.created_compositions as Array<{ id?: string; name?: string }>)
      : undefined,
    error,
  };
}

export const importMedia = createTool({
  id: 'importMedia',
  description:
    'Import one or more media files into a Descript project — from publicly-accessible URLs, or uploaded directly from local files in the agent workspace (file_path). Creates a new project if project_name is provided, or adds to an existing project if project_id is provided. All media are added as clips of a single composition, in the order given, unless grouped into a multitrack (synced tracks played together, e.g. camera angles or separate mics); set width/height for vertical (1080×1920) or square compositions, and workspace_name/folder_name to place a new project. Polls until the import job completes. Returns the project_id, project_url, media_count, and final job status. COST: spends media minutes (transcription of the imported media); does NOT invoke Underlord or spend AI credits.',
  inputSchema: importMediaInput,
  outputSchema: importMediaOutput,
  execute: (context) => runImportMedia(context),
});
