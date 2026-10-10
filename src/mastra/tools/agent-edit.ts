import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient, JOB_OUTCOMES, jobOutcome } from '../lib/descript-client';
import { costMeter } from '../lib/cost-meter';
import { env } from '../../lib/env';

export const agentEditInput = z.object({
  prompt: z.string().min(1).describe('Natural language editing instruction'),
  project_id: z.string().uuid().optional().describe('UUID of an existing project to edit (mutually exclusive with project_name)'),
  project_name: z.string().optional().describe('Name for a new project (mutually exclusive with project_id; useful for "Write a script about X" prompts)'),
  composition_id: z.string().optional().describe('UUID, 5-char short ID, or project URL of a specific composition (requires project_id)'),
  model: z
    .string()
    .optional()
    .describe(
      'Underlord model id or alias (e.g. "claude-haiku", "claude-sonnet", "claude-haiku-5.5"). Aliases track the current stable Descript model. Omit to use the configured default (DESCRIPT_AGENT_MODEL, the claude-haiku alias — the low-cost tier). The catalog changes as models launch and retire: call listAgentModels for live ids/aliases and cost tiers. Override with a stronger model only for complex edits.',
    ),
  callback_url: z
    .string()
    .url()
    .optional()
    .describe('Optional webhook. If set, Descript POSTs the full job result here on completion and the tool returns IMMEDIATELY without polling (best for long edits). If omitted, the tool polls to completion (default).'),
  conversation_id: z
    .string()
    .optional()
    .describe('Continue a prior Underlord session (multi-turn — Underlord retains context across turns). Pass the conversation_id returned by a previous agentEdit, along with the same project_id, to iterate on an edit.'),
});

export const agentEditOutput = z.object({
  job_id: z.string(),
  project_id: z.string(),
  project_url: z.string(),
  status: z.enum(JOB_OUTCOMES).optional().describe('success | partial (ran but changed nothing — stalled) | error | cancelled. Absent in webhook mode.'),
  ai_credits_used: z.number().optional(),
  agent_response: z.string().optional(),
  project_changed: z.boolean().optional(),
  conversation_id: z.string().optional().describe('Pass this back as conversation_id on the next agentEdit to continue this Underlord session.'),
  resolved_model: z.string().optional().describe('Canonical model id that actually ran (reports "auto" for auto requests).'),
  media_seconds_used: z.number().optional().describe('Media-seconds consumed by the edit (e.g. generated audio/video), if any.'),
  error: z.string().optional(),
});

export async function runAgentEdit(context: z.infer<typeof agentEditInput>): Promise<z.infer<typeof agentEditOutput>> {
  // Guardrail: abort before spending if this session already hit DESCRIPT_CREDIT_CAP.
  costMeter.assertCreditCap();
  const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
  const job = await client.agentEdit({ ...context, model: context.model ?? env.DESCRIPT_AGENT_MODEL });
  if (context.callback_url) {
    // Webhook mode: don't poll — Descript will POST the full job result to callback_url.
    // The POST already returns conversation_id and resolved_model, so pass them back even without polling.
    return { job_id: job.job_id, project_id: job.project_id, project_url: job.project_url, status: undefined, ai_credits_used: undefined, agent_response: undefined, project_changed: undefined, conversation_id: job.conversation_id, resolved_model: job.resolved_model, media_seconds_used: undefined, error: undefined };
  }
  const final = await client.pollJob(job.job_id);
  const result = final.result ?? {};
  const outcome = jobOutcome(final);
  const aiCredits = typeof result.ai_credits_used === 'number' ? result.ai_credits_used : undefined;
  const projectChanged = typeof result.project_changed === 'boolean' ? result.project_changed : undefined;
  const mediaSeconds = typeof result.media_seconds_used === 'number' ? result.media_seconds_used : undefined;
  costMeter.addCredits(aiCredits);
  costMeter.addMediaSeconds(mediaSeconds);
  // nhk.5: Underlord can report success while project_changed=false — it stalled at the
  // creative-brief/plan-approval step and built nothing. Surface that as a distinct non-success.
  const stalled = outcome.status === 'success' && projectChanged === false;
  return {
    job_id: job.job_id,
    project_id: job.project_id,
    project_url: job.project_url,
    status: stalled ? 'partial' : outcome.status,
    ai_credits_used: aiCredits,
    agent_response: typeof result.agent_response === 'string' ? result.agent_response : undefined,
    project_changed: projectChanged,
    conversation_id: typeof result.conversation_id === 'string' ? result.conversation_id : job.conversation_id,
    resolved_model: typeof result.resolved_model === 'string' ? result.resolved_model : job.resolved_model,
    media_seconds_used: mediaSeconds,
    error: stalled
      ? 'Underlord returned success but project_changed=false — the edit did NOT execute (it likely stalled awaiting creative-brief/plan approval). Re-run with a more explicit, directive prompt.'
      : outcome.error,
  };
}

export const agentEdit = createTool({
  id: 'agentEdit',
  description: 'Edit a Descript project (or create a new one) using a natural language prompt. Underlord AI handles the actual editing. Use this for tasks like "remove filler words", "add captions", "create a 60-second highlight reel", etc. Polls until the edit job completes. COST: spends AI credits — this is the ONLY tool that invokes Underlord (Descript\'s AI). Credits scale with the model and the amount of work; keep prompts tight.',
  inputSchema: agentEditInput,
  outputSchema: agentEditOutput,
  execute: (context) => runAgentEdit(context),
});
