import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient } from '../lib/descript-client';
import { env } from '../../lib/env';

const resultType = z.enum(['project', 'video', 'image', 'audio', 'project_folder', 'media_library_folder', 'layout_pack']);

export const searchDrive = createTool({
  id: 'searchDrive',
  description:
    'Full-text search across the Descript drive: project, folder, media-file, and layout-pack NAMES plus transcript and composition CONTENT (i.e. "find the project where we talked about pricing"). Returns up to 100 ranked hits with project_id/asset_id and a Descript URL. Prefer this over listProjects when matching on what was said, or across media/folders. COST: free — read-only.',
  inputSchema: z.object({
    query: z.string().min(1).describe('Search term, matched against names and contents'),
    type: z.array(resultType).optional().describe('Restrict to these result types (default: all)'),
    match: z
      .array(z.enum(['name', 'content']))
      .optional()
      .describe('"name" = names only, "content" = transcripts/composition text only (default: both)'),
    owner: z.array(z.string().uuid()).optional().describe('Only items owned by these user UUIDs'),
    updated_after: z.string().optional().describe('ISO 8601 date or timestamp (UTC if no offset)'),
    updated_before: z.string().optional().describe('ISO 8601 date or timestamp (UTC if no offset)'),
    sort: z.enum(['relevance', 'newest', 'oldest']).default('relevance'),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        type: resultType,
        name: z.string(),
        url: z.string(),
        updated_at: z.string(),
        project_id: z.string().optional(),
        asset_id: z.string().optional(),
        folder_id: z.string().optional(),
        location: z.string().optional(),
        duration: z.number().optional(),
        owner_name: z.string().optional(),
      }),
    ),
  }),
  execute: async (context) => {
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    const r = await client.search(context);
    return {
      results: r.results.map((h) => ({
        type: h.type,
        name: h.name,
        url: h.url,
        updated_at: h.updated_at,
        project_id: h.project_id,
        asset_id: h.asset_id,
        folder_id: h.folder_id,
        location: h.location,
        duration: h.duration,
        owner_name: h.owner?.name,
      })),
    };
  },
});
