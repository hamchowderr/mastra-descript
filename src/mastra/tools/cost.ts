import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { costMeter } from '../lib/cost-meter';

export const getCostTotals = createTool({
  id: 'getCostTotals',
  description:
    "Report this session's cumulative Descript spend so far: AI credits (from agentEdit/Underlord) and media-seconds (from imports/publish). Descript has NO credits-remaining endpoint, so this is a running total of what jobs reported this server session — NOT your account balance. COST: free.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    ai_credits_used: z.number().describe('Cumulative AI credits spent this session (agentEdit only)'),
    media_seconds_used: z.number().describe('Cumulative media-seconds transcribed this session'),
    credit_cap: z.number().optional().describe('DESCRIPT_CREDIT_CAP if set — agentEdit aborts once ai_credits_used reaches it'),
  }),
  execute: async () => costMeter.totals(),
});
