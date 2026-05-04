import { createPromptAlignmentScorerLLM } from '@mastra/evals/scorers/prebuilt';
import { createScorer } from '@mastra/core/evals';
import { getUserMessageFromRunInput, getAssistantMessageFromRunOutput } from '@mastra/evals/scorers/utils';
import { z } from 'zod';

/**
 * Checks whether the agent invoked the expected Descript tool for a given request.
 * The judge receives the user message and agent response, then verifies the tool call matches
 * what would be expected for that workflow step.
 */
export const toolCallAccuracyScorer = createScorer({
  id: 'descript-tool-call-accuracy',
  name: 'Tool Call Accuracy',
  description: 'Verifies the agent called the correct Descript tool for the given request',
  type: 'agent',
  judge: {
    model: 'anthropic/claude-sonnet-4-6',
    instructions:
      'You evaluate whether an AI agent correctly selected the right Descript API tool for a given user request. ' +
      'Available tools: importMedia (import media from URL), agentEdit (AI edit with prompt), publish (render + share), ' +
      'listProjects (list projects), getProject (get project details), getJob (get job status), listJobs (list recent jobs). ' +
      'Match: the agent called the expected tool. Mismatch: wrong tool, no tool call when one was needed, or tool called with wrong parameters.',
  },
})
  .preprocess(({ run }) => {
    const userText = getUserMessageFromRunInput(run.input) ?? '';
    const assistantText = getAssistantMessageFromRunOutput(run.output) ?? '';
    return { userText, assistantText };
  })
  .analyze({
    description: 'Determine if the agent called the correct Descript tool',
    outputSchema: z.object({
      expectedTool: z.string(),
      calledTool: z.string(),
      match: z.boolean(),
      explanation: z.string(),
    }),
    createPrompt: ({ results }) => `
Evaluate tool selection accuracy for a Descript API agent.

User request:
"""
${results.preprocessStepResult.userText}
"""

Agent response (includes tool call info):
"""
${results.preprocessStepResult.assistantText}
"""

Tasks:
1. Determine which Descript tool SHOULD have been called given the user request.
2. Identify which tool the agent actually called (if any).
3. Set match=true only if they agree.

Return JSON: { expectedTool, calledTool, match, explanation }
`,
  })
  .generateScore(({ results }) => {
    return results.analyzeStepResult?.match ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const r = results.analyzeStepResult;
    return `Expected: ${r?.expectedTool ?? '?'}, Called: ${r?.calledTool ?? '?'}. Score=${score}. ${r?.explanation ?? ''}`;
  });

/**
 * Checks whether the agent's answer is relevant and appropriate for the user's Descript request.
 * Uses prompt alignment: the agent's response should align with its instructions.
 */
export const answerRelevancyScorer = createPromptAlignmentScorerLLM({
  model: 'anthropic/claude-sonnet-4-6',
});
