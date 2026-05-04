import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient } from '../lib/descript-client';
import { env } from '../../lib/env';

export const getJob = createTool({
  id: 'getJob',
  description: 'Get the current status of a specific Descript job. Returns the full job object including job_state (running/stopped) and result.status (success/partial/failed) when complete.',
  inputSchema: z.object({
    job_id: z.string().uuid(),
  }),
  outputSchema: z.object({
    job_id: z.string(),
    job_type: z.string(),
    job_state: z.enum(['running', 'stopped']),
    project_id: z.string().optional(),
    project_url: z.string().optional(),
    created_at: z.string(),
    stopped_at: z.string().optional(),
    result_status: z.enum(['success', 'partial', 'failed']).optional(),
    progress_label: z.string().optional(),
  }),
  execute: async (context) => {
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    const job = await client.getJob(context.job_id);
    return {
      job_id: job.job_id,
      job_type: job.job_type,
      job_state: job.job_state,
      project_id: job.project_id,
      project_url: job.project_url,
      created_at: job.created_at,
      stopped_at: job.stopped_at,
      result_status: job.result?.status as 'success' | 'partial' | 'failed' | undefined,
      progress_label: job.progress?.label,
    };
  },
});

export const listJobs = createTool({
  id: 'listJobs',
  description: 'List recent Descript jobs, optionally filtered by project_id, type, or date range. Use this when you need to find a recent job whose ID was lost.',
  inputSchema: z.object({
    project_id: z.string().uuid().optional(),
    type: z.string().optional().describe('Filter by job type, e.g. "import/project_media" or "agent"'),
    created_after: z.string().optional().describe('ISO 8601 datetime'),
    created_before: z.string().optional().describe('ISO 8601 datetime'),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  outputSchema: z.object({
    jobs: z.array(z.object({
      job_id: z.string(),
      job_type: z.string(),
      job_state: z.enum(['running', 'stopped']),
      project_id: z.string().optional(),
      created_at: z.string(),
      stopped_at: z.string().optional(),
      result_status: z.enum(['success', 'partial', 'failed']).optional(),
    })),
    next_cursor: z.string().optional(),
  }),
  execute: async (context) => {
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    const result = await client.listJobs(context);
    return {
      jobs: result.data.map((j) => ({
        job_id: j.job_id,
        job_type: j.job_type,
        job_state: j.job_state,
        project_id: j.project_id,
        created_at: j.created_at,
        stopped_at: j.stopped_at,
        result_status: j.result?.status as 'success' | 'partial' | 'failed' | undefined,
      })),
      next_cursor: result.pagination?.next_cursor,
    };
  },
});
