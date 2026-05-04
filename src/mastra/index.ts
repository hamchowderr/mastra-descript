// 1. Env validation FIRST — crashes process if misconfigured
import { env } from '../lib/env';

// 2. AIMock provider switch — must run before any AI SDK client constructs
import { configureAIMock } from './lib/aimock';
configureAIMock();

// 3. Mastra imports — agents/tools constructed below now see the right base URLs
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { PostgresStore } from '@mastra/pg';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, DefaultExporter, SensitiveDataFilter } from '@mastra/observability';
import { MastraEditor } from '@mastra/editor';
import { MCPServer } from '@mastra/mcp';
import { leadIntakeAgent } from './agents/_example';
import { hallucinationScorer, promptAlignmentScorer, urgencyScorer } from './scorers/_example.scorers';

const mcpServer = new MCPServer({
  id: 'base-mcp',
  name: 'template-mastra-base',
  version: '0.1.0',
  description: 'MCP server exposing template-mastra-base agents as tools',
  tools: {},
  agents: { leadIntake: leadIntakeAgent },
});

export const mastra = new Mastra({
  agents: { leadIntake: leadIntakeAgent },
  scorers: { hallucinationScorer, promptAlignmentScorer, urgencyScorer },
  mcpServers: { baseMcp: mcpServer },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new PostgresStore({ id: 'mastra-storage', connectionString: env.SUPABASE_DB_URL }),
    editor: new PostgresStore({ id: 'mastra-editor-storage', connectionString: env.SUPABASE_DB_URL }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: env.LOG_LEVEL,
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new DefaultExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
  editor: new MastraEditor(),
});
