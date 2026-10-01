import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient } from '../lib/descript-client';
import { env } from '../../lib/env';

const costTier = z.enum(['low', 'medium', 'high']);

export const listAgentModels = createTool({
  id: 'listAgentModels',
  description:
    'List the Underlord models (canonical ids + friendly aliases) that agentEdit accepts as `model`, each with a coarse cost tier (low/medium/high). The catalog changes as models launch and retire — call this before picking a non-default model or when the user asks which models exist or which is cheapest. COST: free — read-only.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    models: z.array(z.object({ id: z.string(), cost: costTier })),
    aliases: z.array(z.object({ id: z.string(), resolves_to: z.string(), description: z.string(), cost: costTier })),
  }),
  execute: async () => {
    const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
    const r = await client.listAgentModels();
    return {
      models: r.availableModels,
      aliases: r.aliases.map((a) => ({ id: a.id, resolves_to: a.resolvesTo, description: a.description, cost: a.cost })),
    };
  },
});
