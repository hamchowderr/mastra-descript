import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient } from '../lib/descript-client';
import { env } from '../../lib/env';

const mediaItem = z.object({
  url: z.string().url().describe('Publicly accessible URL to the media file (MP4, MOV, WAV, FLAC, AAC, MP3)'),
  language: z.string().default('en').describe('ISO 639-1 language code of the audio/video for transcription'),
});

/**
 * Pure: turn the tool input into the DescriptClient.importMedia payload — a keyed
 * `add_media` map (clip1..clipN) plus one composition whose clips reference every
 * media key, in array order. Kept separate from `execute` so it's unit-testable
 * without hitting the API (a real import consumes media minutes).
 */
export function buildImportPayload(input: {
  media: Array<{ url: string; language?: string }>;
  project_name?: string;
  project_id?: string;
  team_access?: 'edit' | 'comment' | 'view' | 'none';
  folder_name?: string;
  composition_name?: string;
}) {
  const add_media: Record<string, { url: string; language: string }> = {};
  const clips: Array<{ media: string }> = [];
  input.media.forEach((m, i) => {
    const key = `clip${i + 1}`;
    add_media[key] = { url: m.url, language: m.language ?? 'en' };
    clips.push({ media: key });
  });
  return {
    project_name: input.project_name,
    project_id: input.project_id,
    team_access: input.team_access,
    folder_name: input.folder_name,
    add_media,
    add_compositions: [{ name: input.composition_name ?? 'Main', clips }],
  };
}

export const importMedia = createTool({
  id: 'importMedia',
  description:
    'Import one or more media files from publicly-accessible URLs into a Descript project. Creates a new project if project_name is provided, or adds to an existing project if project_id is provided. All media are added as clips of a single composition, in the order given. Polls until the import job completes. Returns the project_id, project_url, media_count, and final job status.',
  inputSchema: z.object({
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
  }),
  outputSchema: z.object({
    job_id: z.string(),
    project_id: z.string(),
    project_url: z.string(),
    media_count: z.number(),
    status: z.enum(['success', 'partial', 'failed']).optional(),
    error: z.string().optional(),
  }),
  execute: async (context) => {
    if (Boolean(context.project_name) === Boolean(context.project_id)) {
      throw new Error('Provide exactly one of project_name (new project) or project_id (existing project).');
    }
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    const job = await client.importMedia(buildImportPayload(context));
    const final = await client.pollJob(job.job_id);
    const status = final.result?.status as 'success' | 'partial' | 'failed' | undefined;
    return {
      job_id: job.job_id,
      project_id: job.project_id,
      project_url: job.project_url,
      media_count: context.media.length,
      status,
      error: status === 'failed' ? String(final.result?.error ?? 'Import failed') : undefined,
    };
  },
});
