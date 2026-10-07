import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient } from '../lib/descript-client';
import { costMeter } from '../lib/cost-meter';
import { env } from '../../lib/env';

const mediaItem = z.object({
  url: z.string().url().describe('Publicly accessible URL to the media file (MP4, MOV, WAV, FLAC, AAC, MP3)'),
  language: z.string().default('en').describe('ISO 639-1 language code of the audio/video for transcription'),
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
export function buildImportPayload(input: {
  media: Array<{ url: string; language?: string; mute?: boolean }>;
  project_name?: string;
  project_id?: string;
  team_access?: 'edit' | 'comment' | 'view' | 'none';
  folder_name?: string;
  workspace_name?: string;
  composition_name?: string;
  width?: number;
  height?: number;
}) {
  const add_media: Record<string, { url: string; language: string }> = {};
  const clips: Array<{ media: string; mute?: boolean }> = [];
  input.media.forEach((m, i) => {
    const key = `clip${i + 1}`;
    add_media[key] = { url: m.url, language: m.language ?? 'en' };
    clips.push(m.mute ? { media: key, mute: true } : { media: key });
  });
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
  skip_url_validation: z
    .boolean()
    .default(false)
    .describe('Skip the pre-flight URL reachability/Range check (only set true if a valid URL is being wrongly rejected)'),
  callback_url: z
    .string()
    .url()
    .optional()
    .describe('Optional webhook. If set, Descript POSTs the full job result here on completion and the tool returns IMMEDIATELY without polling (best for long imports). If omitted, the tool polls to completion (default).'),
});

export const importMediaOutput = z.object({
  job_id: z.string(),
  project_id: z.string(),
  project_url: z.string(),
  media_count: z.number(),
  media_seconds_used: z.number().optional().describe('Media-seconds consumed (transcription). No AI credits — import never invokes Underlord.'),
  status: z.enum(['success', 'partial', 'failed']).optional(),
  error: z.string().optional(),
});

export async function runImportMedia(context: z.infer<typeof importMediaInput>): Promise<z.infer<typeof importMediaOutput>> {
  if (Boolean(context.project_name) === Boolean(context.project_id)) {
    throw new Error('Provide exactly one of project_name (new project) or project_id (existing project).');
  }
  const optionError = checkImportOptions(context);
  if (optionError) throw new Error(optionError);
  if (!context.skip_url_validation) {
    const checks = await Promise.all(
      context.media.map(async (m) => ({ url: m.url, result: await validateMediaUrl(m.url) })),
    );
    const bad = checks.filter((c) => !c.result.ok);
    if (bad.length > 0) {
      throw new Error(
        `URL pre-validation failed for ${bad.length} of ${context.media.length} media file(s) — not submitting (saves media minutes):\n` +
          bad.map((b) => `  • ${b.url} — ${(b.result as { reason: string }).reason}`).join('\n') +
          '\nFix the URL(s), or pass skip_url_validation: true to bypass.',
      );
    }
  }
  const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
  const job = await client.importMedia({ ...buildImportPayload(context), callback_url: context.callback_url });
  if (context.callback_url) {
    // Webhook mode: don't poll — Descript will POST the full job result to callback_url.
    return { job_id: job.job_id, project_id: job.project_id, project_url: job.project_url, media_count: context.media.length, media_seconds_used: undefined, status: undefined, error: undefined };
  }
  const final = await client.pollJob(job.job_id);
  const status = final.result?.status as 'success' | 'partial' | 'failed' | undefined;
  const mediaSeconds = typeof final.result?.media_seconds_used === 'number' ? final.result.media_seconds_used : undefined;
  costMeter.addMediaSeconds(mediaSeconds);
  return {
    job_id: job.job_id,
    project_id: job.project_id,
    project_url: job.project_url,
    media_count: context.media.length,
    media_seconds_used: mediaSeconds,
    status,
    error: status === 'failed' ? String(final.result?.error ?? 'Import failed') : undefined,
  };
}

export const importMedia = createTool({
  id: 'importMedia',
  description:
    'Import one or more media files from publicly-accessible URLs into a Descript project. Creates a new project if project_name is provided, or adds to an existing project if project_id is provided. All media are added as clips of a single composition, in the order given; set width/height for vertical (1080×1920) or square compositions, and workspace_name/folder_name to place a new project. Polls until the import job completes. Returns the project_id, project_url, media_count, and final job status. COST: spends media minutes (transcription of the imported media); does NOT invoke Underlord or spend AI credits.',
  inputSchema: importMediaInput,
  outputSchema: importMediaOutput,
  execute: (context) => runImportMedia(context),
});
