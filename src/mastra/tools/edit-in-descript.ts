import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient } from '../lib/descript-client';
import { env } from '../../lib/env';

export const createEditInDescriptUrl = createTool({
  id: 'createEditInDescriptUrl',
  description:
    'Partner API: build a one-time "Edit in Descript" import link from remote media URLs. A human opens the link to import the files into a NEW project in their own Descript account — nothing is imported until they click it. Link expires after 3 hours and works once. Requires a drive with Edit-in-Descript partner permissions (403 otherwise) and hosts on Descript\'s allow-list. Use importMedia instead when the agent should import directly. COST: free.',
  inputSchema: z.object({
    files: z
      .array(
        z.object({
          uri: z.string().url().describe('Public or pre-signed URL (keep valid ≥48h). Audio: WAV/FLAC/AAC/MP3; video: h264/HEVC in MOV/MP4.'),
          name: z.string().optional(),
          start_offset_seconds: z.number().min(0).optional().describe('Where on the timeline this file starts'),
        }),
      )
      .min(1),
    source_id: z.string().optional().describe('Your external ID, echoed on Descript export pages'),
    partner_drive_id: z
      .string()
      .uuid()
      .optional()
      .describe("Drive ID tied to the API token. Omit to look it up automatically via GET /status."),
  }),
  outputSchema: z.object({
    url: z.string().describe('One-time import URL to hand to the user (expires in 3 hours)'),
  }),
  execute: async (context) => {
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    const driveId = context.partner_drive_id ?? (await client.healthcheck()).drive_id;
    if (!driveId) throw new Error('Could not determine partner_drive_id from GET /status - pass it explicitly.');
    return client.createEditInDescriptUrl({
      partner_drive_id: driveId,
      project_schema: {
        schema_version: '1.0.0',
        source_id: context.source_id,
        files: context.files.map((f) => ({
          uri: f.uri,
          name: f.name,
          start_offset: f.start_offset_seconds != null ? { seconds: f.start_offset_seconds } : undefined,
        })),
      },
    });
  },
});
