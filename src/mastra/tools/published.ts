import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient } from '../lib/descript-client';
import { env } from '../../lib/env';

export const getPublishedSubtitles = createTool({
  id: 'getPublishedSubtitles',
  description:
    'Fetch WEBVTT subtitles (plus title/duration) for a PUBLISHED Descript project by its share-URL slug. Works POST-PUBLISH only — for captions on any project (no publish needed), prefer exportTranscript with format "srt" — the slug is the last path segment of a published share URL (e.g. "abc123" from web.descript.com/view/abc123). COST: free — read-only.',
  inputSchema: z.object({
    published_slug: z
      .string()
      .min(1)
      .describe('Slug from a published project share URL — the last path segment, e.g. "abc123" in https://web.descript.com/view/abc123'),
  }),
  outputSchema: z.object({
    subtitles: z.string().optional().describe('WEBVTT-format subtitles, when available'),
    title: z.string().optional(),
    duration_seconds: z.number().optional(),
    publish_type: z.string().optional(),
    download_url: z.string().optional(),
  }),
  execute: async (context) => {
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    const p = await client.getPublishedProject(context.published_slug);
    return {
      subtitles: p.subtitles,
      title: p.metadata?.title,
      duration_seconds: p.metadata?.duration_seconds,
      publish_type: p.publish_type,
      download_url: p.download_url,
    };
  },
});
