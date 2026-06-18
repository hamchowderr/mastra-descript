import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient } from '../lib/descript-client';
import { costMeter } from '../lib/cost-meter';
import { env } from '../../lib/env';

export const publish = createTool({
  id: 'publish',
  description: 'Publish a Descript composition as a shareable video or audio link. Returns share_url and download_url once the render completes. Polls until the publish job completes. COST: spends render/processing time; does NOT invoke Underlord or spend AI credits.',
  inputSchema: z.object({
    project_id: z.string().uuid(),
    composition_id: z.string().optional().describe('Optional composition UUID. Defaults to the primary composition if omitted.'),
    media_type: z.enum(['Video', 'Audio']).default('Video'),
    resolution: z.enum(['480p', '720p', '1080p', '1440p', '4K']).default('1080p').describe('Resolution — Video only. Ignored for Audio.'),
    access_level: z.enum(['public', 'unlisted', 'drive', 'private']).optional().describe('Access level. Defaults to drive settings. May return 403 if requested level is not permitted.'),
    callback_url: z
      .string()
      .url()
      .optional()
      .describe('Optional webhook. If set, Descript POSTs the full job result here on completion and the tool returns IMMEDIATELY without polling (best for long renders). If omitted, the tool polls to completion (default).'),
  }),
  outputSchema: z.object({
    job_id: z.string(),
    project_id: z.string(),
    project_url: z.string(),
    status: z.enum(['success', 'partial', 'failed']).optional(),
    share_url: z.string().optional(),
    download_url: z.string().optional(),
    download_url_expires_at: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (context) => {
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    const job = await client.publish({
      project_id: context.project_id,
      composition_id: context.composition_id,
      media_type: context.media_type,
      resolution: context.media_type === 'Video' ? context.resolution : undefined,
      access_level: context.access_level,
      callback_url: context.callback_url,
    });
    if (context.callback_url) {
      // Webhook mode: don't poll — Descript will POST the full job result to callback_url.
      return { job_id: job.job_id, project_id: job.project_id, project_url: job.project_url, status: undefined, share_url: undefined, download_url: undefined, download_url_expires_at: undefined, error: undefined };
    }
    const final = await client.pollJob(job.job_id);
    const result = final.result ?? {};
    const status = result.status as 'success' | 'partial' | 'failed' | undefined;
    costMeter.addMediaSeconds(typeof result.media_seconds_used === 'number' ? result.media_seconds_used : undefined);
    return {
      job_id: job.job_id,
      project_id: job.project_id,
      project_url: job.project_url,
      status,
      share_url: typeof result.share_url === 'string' ? result.share_url : undefined,
      download_url: typeof result.download_url === 'string' ? result.download_url : undefined,
      download_url_expires_at: typeof result.download_url_expires_at === 'string' ? result.download_url_expires_at : undefined,
      error: status === 'failed' ? String(result.error ?? 'Publish failed') : undefined,
    };
  },
});
