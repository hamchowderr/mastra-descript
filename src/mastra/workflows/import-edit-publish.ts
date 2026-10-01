import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { importMediaInput, importMediaOutput, runImportMedia } from '../tools/import-media';
import { agentEditInput, agentEditOutput, runAgentEdit } from '../tools/agent-edit';
import { publishInput, publishOutput, runPublish } from '../tools/publish';

const pipelineInput = z.object({
  media_urls: z.array(z.string().url()).min(1).describe('Public media URLs to import into one new project'),
  project_name: z.string().min(1),
  edit_prompt: z.string().min(1).describe('Explicit Underlord prompt, e.g. "Remove filler words... Apply directly."'),
  model: z.string().optional().describe('Underlord model id/alias (default: cheapest). See listAgentModels.'),
  media_type: z.enum(['Video', 'Audio']).default('Video'),
  resolution: z.enum(['480p', '720p', '1080p', '1440p', '4K']).default('1080p'),
  auto_approve: z.boolean().default(false).describe('Skip the human approval pause before the credit-spending edit'),
});

const failure = z.object({
  failed_step: z.enum(['import', 'approval', 'edit', 'publish']),
  error: z.string(),
});

const pipelineOutput = z.object({
  project_id: z.string().optional(),
  project_url: z.string().optional(),
  import: importMediaOutput.optional(),
  edit: agentEditOutput.optional(),
  publish: publishOutput.optional(),
  failure: failure.optional(),
});

type PipelineState = z.infer<typeof pipelineOutput> & { input: z.infer<typeof pipelineInput> };
const carry = pipelineOutput.extend({ input: pipelineInput });

const importStep = createStep({
  id: 'import',
  description: 'Import media into a new project and wait for it (spends media-seconds)',
  inputSchema: pipelineInput,
  outputSchema: carry,
  execute: async ({ inputData }): Promise<PipelineState> => {
    const r = await runImportMedia(
      importMediaInput.parse({
        project_name: inputData.project_name,
        media: inputData.media_urls.map((url) => ({ url })),
      }),
    );
    const base = { input: inputData, project_id: r.project_id, project_url: r.project_url, import: r };
    if (r.status !== 'success') {
      return { ...base, failure: { failed_step: 'import', error: r.error ?? `Import finished with status ${r.status ?? 'unknown'}` } };
    }
    return base;
  },
});

const approvalStep = createStep({
  id: 'approve-edit',
  description: 'Suspend for human approval before spending AI credits',
  inputSchema: carry,
  outputSchema: carry,
  suspendSchema: z.object({
    reason: z.string(),
    project_url: z.string().optional(),
    edit_prompt: z.string(),
    model: z.string(),
  }),
  resumeSchema: z.object({ approved: z.boolean() }),
  execute: async ({ inputData, resumeData, suspend }): Promise<PipelineState> => {
    if (inputData.failure || inputData.input.auto_approve) return inputData;
    if (resumeData === undefined) {
      return suspend({
        reason: 'The next step runs Underlord (agentEdit) and spends AI credits. Resume with { approved: true } to continue.',
        project_url: inputData.project_url,
        edit_prompt: inputData.input.edit_prompt,
        model: inputData.input.model ?? 'haiku-4.5-underlord',
      }) as never;
    }
    if (!resumeData.approved) {
      return { ...inputData, failure: { failed_step: 'approval', error: 'Edit rejected by reviewer — no credits spent.' } };
    }
    return inputData;
  },
});

const editStep = createStep({
  id: 'edit',
  description: 'Run the Underlord edit (spends AI credits)',
  inputSchema: carry,
  outputSchema: carry,
  execute: async ({ inputData }): Promise<PipelineState> => {
    if (inputData.failure || !inputData.project_id) return inputData;
    const r = await runAgentEdit(
      agentEditInput.parse({
        project_id: inputData.project_id,
        prompt: inputData.input.edit_prompt,
        model: inputData.input.model,
      }),
    );
    const next = { ...inputData, edit: r };
    if (r.status === 'failed' || r.project_changed === false) {
      return { ...next, failure: { failed_step: 'edit', error: r.error ?? 'Underlord did not change the project (stalled) — refine the prompt.' } };
    }
    return next;
  },
});

const publishStep = createStep({
  id: 'publish',
  description: 'Render and publish a share link (spends render time)',
  inputSchema: carry,
  outputSchema: pipelineOutput,
  execute: async ({ inputData }) => {
    const { input, ...rest } = inputData;
    if (rest.failure || !rest.project_id) return rest;
    const r = await runPublish(publishInput.parse({ project_id: rest.project_id, media_type: input.media_type, resolution: input.resolution }));
    return {
      ...rest,
      publish: r,
      failure: r.status === 'success' ? undefined : { failed_step: 'publish' as const, error: r.error ?? `Publish finished with status ${r.status ?? 'unknown'}` },
    };
  },
});

export const importEditPublishWorkflow = createWorkflow({
  id: 'importEditPublish',
  description:
    'Deterministic Descript pipeline: import media URLs into a new project -> pause for human approval -> Underlord edit -> publish. Stops at the first failed step (no automatic retries) and reports it in `failure`. Spends media-seconds, AI credits (edit) and render time.',
  inputSchema: pipelineInput,
  outputSchema: pipelineOutput,
})
  .then(importStep)
  .then(approvalStep)
  .then(editStep)
  .then(publishStep)
  .commit();
