import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient } from '../lib/descript-client';
import { env } from '../../lib/env';

export const importMedia = createTool({
  id: 'importMedia',
  description: 'Import media from a publicly-accessible URL into a Descript project. Creates a new project if project_name is provided, adds to an existing project if project_id is provided. Polls until the import job completes. Returns the project_id, project_url, and final job status.',
  inputSchema: z.object({
    media_url: z.string().url().describe('Publicly accessible URL to the media file (MP4, MOV, WAV, FLAC, AAC, MP3)'),
    project_name: z.string().optional().describe('Name for a new project (mutually exclusive with project_id)'),
    project_id: z.string().uuid().optional().describe('UUID of an existing project (mutually exclusive with project_name)'),
    composition_name: z.string().default('Main').describe('Name of the composition that the media is added to'),
    language: z.string().default('en').describe('ISO 639-1 language code of the audio/video for transcription'),
    team_access: z.enum(['edit', 'comment', 'view', 'none']).optional().describe('Access level for new projects only'),
  }),
  outputSchema: z.object({
    job_id: z.string(),
    project_id: z.string(),
    project_url: z.string(),
    status: z.enum(['success', 'partial', 'failed']).optional(),
    error: z.string().optional(),
  }),
  execute: async (context) => {
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    const job = await client.importMedia({
      project_name: context.project_name,
      project_id: context.project_id,
      team_access: context.team_access,
      add_media: { clip1: { url: context.media_url, language: context.language } },
      add_compositions: [{ name: context.composition_name ?? 'Main', clips: [{ media: 'clip1' }] }],
    });
    const final = await client.pollJob(job.job_id);
    const status = final.result?.status as 'success' | 'partial' | 'failed' | undefined;
    return {
      job_id: job.job_id,
      project_id: job.project_id,
      project_url: job.project_url,
      status,
      error: status === 'failed' ? String(final.result?.error ?? 'Import failed') : undefined,
    };
  },
});
