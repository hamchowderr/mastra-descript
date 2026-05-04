import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient } from '../lib/descript-client';
import { env } from '../../lib/env';

export const agentEdit = createTool({
  id: 'agentEdit',
  description: 'Edit a Descript project (or create a new one) using a natural language prompt. Underlord AI handles the actual editing. Use this for tasks like "remove filler words", "add captions", "create a 60-second highlight reel", etc. Polls until the edit job completes.',
  inputSchema: z.object({
    prompt: z.string().min(1).describe('Natural language editing instruction'),
    project_id: z.string().uuid().optional().describe('UUID of an existing project to edit (mutually exclusive with project_name)'),
    project_name: z.string().optional().describe('Name for a new project (mutually exclusive with project_id; useful for "Write a script about X" prompts)'),
    composition_id: z.string().optional().describe('UUID, 5-char short ID, or project URL of a specific composition (requires project_id)'),
    model: z.string().optional().describe('Override the default Underlord model'),
  }),
  outputSchema: z.object({
    job_id: z.string(),
    project_id: z.string(),
    project_url: z.string(),
    status: z.enum(['success', 'partial', 'failed']).optional(),
    ai_credits_used: z.number().optional(),
    agent_response: z.string().optional(),
    project_changed: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (context) => {
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    const job = await client.agentEdit(context);
    const final = await client.pollJob(job.job_id);
    const result = final.result ?? {};
    const status = result.status as 'success' | 'partial' | 'failed' | undefined;
    return {
      job_id: job.job_id,
      project_id: job.project_id,
      project_url: job.project_url,
      status,
      ai_credits_used: typeof result.ai_credits_used === 'number' ? result.ai_credits_used : undefined,
      agent_response: typeof result.agent_response === 'string' ? result.agent_response : undefined,
      project_changed: typeof result.project_changed === 'boolean' ? result.project_changed : undefined,
      error: status === 'failed' ? String(result.error ?? 'Agent edit failed') : undefined,
    };
  },
});
