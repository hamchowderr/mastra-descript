import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient } from '../lib/descript-client';
import { env } from '../../lib/env';

export const listProjects = createTool({
  id: 'listProjects',
  description: 'List Descript projects accessible to the current API token. Supports filtering by name, creator, and date range, plus sorting and pagination.',
  inputSchema: z.object({
    name: z.string().optional().describe('Substring filter on project name (case-insensitive)'),
    created_by: z.string().optional().describe('UUID of creator, or "me" for the current user'),
    created_after: z.string().optional().describe('ISO 8601 datetime'),
    created_before: z.string().optional().describe('ISO 8601 datetime'),
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
    })),
    next_cursor: z.string().optional(),
  }),
  execute: async (context) => {
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    const result = await client.listProjects(context);
    return { projects: result.data, next_cursor: result.pagination?.next_cursor };
  },
});

export const getProject = createTool({
  id: 'getProject',
  description: 'Get full details for a specific Descript project, including its media files and compositions.',
  inputSchema: z.object({
    project_id: z.string().uuid(),
  }),
  outputSchema: z.object({
    id: z.string(),
    name: z.string(),
    drive_id: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    media_files: z.record(z.string(), z.object({ type: z.string(), duration: z.number() })),
    compositions: z.array(z.object({
      id: z.string(),
      name: z.string(),
      duration: z.number(),
      media_type: z.string(),
    })),
  }),
  execute: async (context) => {
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    return client.getProject(context.project_id);
  },
});
