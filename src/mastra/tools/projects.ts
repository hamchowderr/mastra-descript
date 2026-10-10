import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient } from '../lib/descript-client';
import { env } from '../../lib/env';

export const listProjects = createTool({
  id: 'listProjects',
  description: 'List Descript projects accessible to the current API token. Supports filtering by name, folder, creator, and date range, plus sorting and pagination. COST: free — read-only, no AI credits or media minutes.',
  inputSchema: z.object({
    name: z.string().optional().describe('Substring filter on project name (case-insensitive)'),
    folder_path: z.string().optional().describe('Only projects directly inside this folder, e.g. "Clients/Acme/Videos" ("/" separates nested folders)'),
    created_by: z.string().optional().describe('UUID of creator, or "me" for the current user'),
    created_after: z.string().optional().describe('ISO 8601 datetime'),
    created_before: z.string().optional().describe('ISO 8601 datetime'),
    updated_after: z.string().optional().describe('ISO 8601 datetime: only projects changed after this'),
    updated_before: z.string().optional().describe('ISO 8601 datetime: only projects changed before this'),
    sort: z.enum(['name', 'created_at', 'updated_at', 'last_viewed_at']).default('created_at'),
    direction: z.enum(['asc', 'desc']).default('desc'),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  outputSchema: z.object({
    projects: z.array(z.object({
      id: z.string(),
      name: z.string(),
      created_at: z.string(),
      updated_at: z.string(),
      folder_path: z.string().optional(),
    })),
    next_cursor: z.string().optional(),
  }),
  execute: async (context) => {
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    const result = await client.listProjects(context);
    return { projects: result.data, next_cursor: result.pagination?.next_cursor };
  },
});

export const getProjectOutput = z.object({
  id: z.string(),
  name: z.string(),
  drive_id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  folder_path: z.string().optional(),
  media_files: z
    .record(z.string(), z.object({ type: z.string(), duration: z.number().optional().describe('Seconds; absent for images') }))
    .describe('Keyed by display path (the names media got on import)'),
  compositions: z.array(z.object({
    id: z.string(),
    name: z.string(),
    duration: z.number().optional(),
    media_type: z.string().optional(),
  })),
  publishes: z
    .array(
      z.object({
        share_url: z.string(),
        composition_id: z.string(),
        access_level: z.string(),
        media_type: z.string(),
        published_at: z.string(),
        updated_at: z.string(),
        name: z.string(),
      }),
    )
    .optional()
    .describe('Existing publishes of this project. Reuse a share_url instead of publishing again.'),
});

export const getProject = createTool({
  id: 'getProject',
  description: 'Get full details for a specific Descript project: its folder, media files, compositions, and existing publishes (share URLs you can reuse without republishing). COST: free — read-only, no AI credits or media minutes.',
  inputSchema: z.object({
    project_id: z.string().uuid(),
  }),
  outputSchema: getProjectOutput,
  execute: async (context) => {
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    return client.getProject(context.project_id);
  },
});
