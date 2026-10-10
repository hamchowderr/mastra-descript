import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient, type DescriptJob } from '../lib/descript-client';

// Spec v1.2 says job_id is a UUID, but the live API returns prefixed ids such as
// "project-media-import-<uuid>" (observed 2026-10-09), so accept any non-empty id.
export const jobIdSchema = z.string().min(1).describe('Job id as returned by importMedia, agentEdit, publish or listJobs (e.g. "project-media-import-…")');
const jobState = z.enum(['queued', 'running', 'stopped', 'cancelled']);
const resultStatus = z.enum(['success', 'partial', 'error']);

const resultError = (job: DescriptJob) =>
  job.result?.status === 'error' ? (typeof job.result.error_message === 'string' ? job.result.error_message : 'Job failed') : undefined;
import { env } from '../../lib/env';

export const getJob = createTool({
  id: 'getJob',
  description: 'Get the current status of a specific Descript job. Returns job_state (queued/running/stopped/cancelled), and once stopped, result_status (success/partial/error) with error_message on failure. COST: free — read-only, no AI credits or media minutes.',
  inputSchema: z.object({
    job_id: jobIdSchema,
  }),
  outputSchema: z.object({
    job_id: z.string(),
    job_type: z.string(),
    job_state: jobState,
    project_id: z.string().optional(),
    project_url: z.string().optional(),
    created_at: z.string(),
    stopped_at: z.string().optional(),
    result_status: resultStatus.optional(),
    error_message: z.string().optional(),
    progress_label: z.string().optional(),
    progress_percent: z.number().optional(),
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
      result_status: job.result?.status,
      error_message: resultError(job),
      progress_label: job.progress?.label,
      progress_percent: job.progress?.percent,
    };
  },
});

export const cancelJob = createTool({
  id: 'cancelJob',
  description:
    'Cancel a queued or running Descript job (import, agent edit, or publish) via DELETE /jobs/{job_id}. A job that has already stopped or been cancelled cannot be cancelled. Returns confirmation; surfaces an error if the job is not found or already finished. COST: free.',
  inputSchema: z.object({
    job_id: jobIdSchema,
  }),
  outputSchema: z.object({
    job_id: z.string(),
    cancelled: z.boolean(),
  }),
  execute: async (context) => {
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    await client.cancelJob(context.job_id);
    return { job_id: context.job_id, cancelled: true };
  },
});

export const listJobs = createTool({
  id: 'listJobs',
  description: 'List recent Descript jobs, optionally filtered by project_id, type, or date range. Use this when you need to find a recent job whose ID was lost. COST: free — read-only, no AI credits or media minutes.',
  inputSchema: z.object({
    project_id: z.string().uuid().optional(),
    type: z.enum(['import/project_media', 'agent']).optional().describe('Filter by job type (the API filters import and agent jobs only)'),
    created_after: z.string().optional().describe('ISO 8601 datetime. Default: 7 days ago; the API keeps at most 30 days.'),
    created_before: z.string().optional().describe('ISO 8601 datetime'),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  outputSchema: z.object({
    jobs: z.array(z.object({
      job_id: z.string(),
      job_type: z.string(),
      job_state: jobState,
      project_id: z.string().optional(),
      created_at: z.string(),
      stopped_at: z.string().optional(),
      result_status: resultStatus.optional(),
      error_message: z.string().optional(),
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
        result_status: j.result?.status,
        error_message: resultError(j),
      })),
      next_cursor: result.pagination?.next_cursor,
    };
  },
});
