import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient } from '../lib/descript-client';
import { costMeter } from '../lib/cost-meter';
import { env } from '../../lib/env';

export const agentEdit = createTool({
  id: 'agentEdit',
  description: 'Edit a Descript project (or create a new one) using a natural language prompt. Underlord AI handles the actual editing. Use this for tasks like "remove filler words", "add captions", "create a 60-second highlight reel", etc. Polls until the edit job completes. COST: spends AI credits — this is the ONLY tool that invokes Underlord (Descript\'s AI). Credits scale with the model and the amount of work; keep prompts tight.',
  inputSchema: z.object({
    prompt: z.string().min(1).describe('Natural language editing instruction'),
    project_id: z.string().uuid().optional().describe('UUID of an existing project to edit (mutually exclusive with project_name)'),
    project_name: z.string().optional().describe('Name for a new project (mutually exclusive with project_id; useful for "Write a script about X" prompts)'),
    composition_id: z.string().optional().describe('UUID, 5-char short ID, or project URL of a specific composition (requires project_id)'),
    model: z
      .string()
      .default('haiku-4.5-underlord')
      .describe(
        'Underlord model. Defaults to haiku-4.5-underlord — the cheapest (≈2 AI credits for a trivial edit, verified). Valid values: haiku-4.5-underlord, sonnet-4.6-underlord, opus-4.6-underlord, automatic (Descript\'s default, most expensive), opus-4.6, opus-4.7, opus-4.8, fable-5. Override with a stronger model only for complex edits.',
      ),
    callback_url: z
      .string()
      .url()
      .optional()
      .describe('Optional webhook. If set, Descript POSTs the full job result here on completion and the tool returns IMMEDIATELY without polling (best for long edits). If omitted, the tool polls to completion (default).'),
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
    // Guardrail: abort before spending if this session already hit DESCRIPT_CREDIT_CAP.
    costMeter.assertCreditCap();
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    const job = await client.agentEdit(context);
    if (context.callback_url) {
      // Webhook mode: don't poll — Descript will POST the full job result to callback_url.
      return { job_id: job.job_id, project_id: job.project_id, project_url: job.project_url, status: undefined, ai_credits_used: undefined, agent_response: undefined, project_changed: undefined, error: undefined };
    }
    const final = await client.pollJob(job.job_id);
    const result = final.result ?? {};
    const apiStatus = result.status as 'success' | 'partial' | 'failed' | undefined;
    const aiCredits = typeof result.ai_credits_used === 'number' ? result.ai_credits_used : undefined;
    const projectChanged = typeof result.project_changed === 'boolean' ? result.project_changed : undefined;
    costMeter.addCredits(aiCredits);
    // nhk.5: Underlord can report success while project_changed=false — it stalled at the
    // creative-brief/plan-approval step and built nothing. Surface that as a distinct non-success.
    const stalled = apiStatus !== 'failed' && projectChanged === false;
    return {
      job_id: job.job_id,
      project_id: job.project_id,
      project_url: job.project_url,
      status: stalled ? 'partial' : apiStatus,
      ai_credits_used: aiCredits,
      agent_response: typeof result.agent_response === 'string' ? result.agent_response : undefined,
      project_changed: projectChanged,
      error:
        apiStatus === 'failed'
          ? String(result.error ?? 'Agent edit failed')
          : stalled
            ? 'Underlord returned success but project_changed=false — the edit did NOT execute (it likely stalled awaiting creative-brief/plan approval). Re-run with a more explicit, directive prompt.'
            : undefined,
    };
  },
});
