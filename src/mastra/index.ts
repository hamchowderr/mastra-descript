// 1. Env validation FIRST — crashes process if misconfigured
import { env } from '../lib/env';

// 2. AIMock provider switch — must run before any AI SDK client constructs
import { configureAIMock } from './lib/aimock';
configureAIMock();

// 3. Optional: Descript health check — validates token on every boot
import { DescriptClient } from './lib/descript-client';
if (env.DESCRIPT_HEALTHCHECK_ON_BOOT) {
  const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
  await client.healthcheck();
}

// 4. Mastra imports — agents/tools constructed below now see the right base URLs
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, DefaultExporter, SensitiveDataFilter, MastraPlatformExporter } from '@mastra/observability';
import { MastraEditor } from '@mastra/editor';
import { MCPServer } from '@mastra/mcp';
import { MastraJwtAuth } from '@mastra/auth';
import { descriptAgent } from './agents/_example';
import { importEditPublishWorkflow } from './workflows/import-edit-publish';
import { transcriptExportWorkflow } from './workflows/transcript-export';
import { toolCallAccuracyScorer, answerRelevancyScorer } from './scorers/_example.scorers';
import { doltTools } from './tools/dolt';
import { ensureDatabase, doltConfigured } from './lib/dolt';
import { getSharedStore } from './lib/memory';

// Bootstrap the versioned Dolt database on first boot (no-op if Dolt isn't configured).
if (doltConfigured) {
  await ensureDatabase();
}

const descriptMcp = new MCPServer({
  id: 'descript-mcp',
  name: 'template-mastra-descript',
  version: '0.1.0',
  description: 'MCP server exposing the descriptAgent for Descript API workflows + Dolt tools',
  // Dolt versioned-data tools exposed over MCP. To let the example agent call
  // them directly, spread `...doltTools` into the agent's own `tools`.
  tools: { ...doltTools },
  agents: { descript: descriptAgent },
  workflows: { transcriptExport: transcriptExportWorkflow },
});

// JWT auth: when MASTRA_JWT_SECRET is set, gate all /api/* routes AND Studio
// behind a Bearer JWT signed with the shared secret. `/health` and `/api/auth/*`
// stay public (so healthchecks and the Studio login screen still work). Leave
// the secret unset for open local dev. Shared-secret only — no external provider.
const serverConfig = env.MASTRA_JWT_SECRET
  ? { auth: new MastraJwtAuth({ secret: env.MASTRA_JWT_SECRET }) }
  : undefined;

export const mastra = new Mastra({
  ...(serverConfig ? { server: serverConfig } : {}),
  agents: { descript: descriptAgent },
  workflows: { importEditPublish: importEditPublishWorkflow, transcriptExport: transcriptExportWorkflow },
  scorers: { toolCallAccuracyScorer, answerRelevancyScorer },
  mcpServers: { descriptMcp },
  // libSQL is the primary store (default/editor/memory domains + vectors). Local
  // dev uses a file: DB — no server, no Docker; prod points TURSO_DATABASE_URL at
  // a libsql:// Turso URL with TURSO_AUTH_TOKEN. Only the observability (OLAP)
  // domain uses DuckDB, same as before — Studio's Metrics/Logs views need it
  // specifically. To switch back to Postgres/pgvector (Supabase), see docs/postgres.md.
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: getSharedStore(),
    editor: getSharedStore(),
    domains: {
      observability: await new DuckDBStore({ path: env.DUCKDB_PATH }).getStore('observability'),
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
        // Local traces always; also ship to hosted Mastra Observe when creds are set
        // (MASTRA_PLATFORM_ACCESS_TOKEN + MASTRA_PROJECT_ID) — no-op otherwise.
        exporters: [
          new DefaultExporter(),
          ...(process.env.MASTRA_PLATFORM_ACCESS_TOKEN && process.env.MASTRA_PROJECT_ID
            ? [new MastraPlatformExporter()]
            : []),
        ],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
  editor: new MastraEditor(),
});
