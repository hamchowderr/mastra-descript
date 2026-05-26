# 02 — Architecture

## Final file layout

```
template-mastra-descript/
├── .env.example                          # All env vars, grouped & commented
├── .dockerignore
├── .github/
│   └── workflows/
│       └── ci.yml                        # typecheck → build → eval → docker
├── AGENTS.md                             # Project conventions for AI coding agents
├── CLAUDE.md                             # Optional: Claude-Code-specific tweaks (can be a symlink to AGENTS.md initially)
├── Dockerfile                            # Multi-stage Mastra build
├── README.md                             # Human onboarding
├── compose.dev.yml                       # Dev override with hot reload
├── docker-compose.yml                    # Production-like local run
├── package.json                          # Updated scripts (adds descript:ping)
├── prompts/
│   ├── README.md                         # Index of prompts
│   └── build-agent.md                    # Reusable agent-build prompt
├── scripts/
│   ├── descript-ping.ts                  # Connectivity check against the Descript API
│   └── eval.ts                           # CI gate runner — runs scorers against canonical dataset
├── src/
│   ├── lib/
│   │   └── env.ts                        # Zod-validated env loader (extended with Descript vars)
│   └── mastra/
│       ├── agents/
│       │   └── _example.ts               # Canonical Descript automation agent
│       ├── index.ts                      # Mastra entry point with strict boot order
│       ├── lib/
│       │   ├── aimock.ts                 # AIMock provider switch
│       │   ├── descript-client.ts        # Descript HTTP client (auth, retry, timeout, pollJob)
│       │   ├── memory.ts                 # createDefaultMemory() — working memory baseline
│       │   ├── processors.ts             # Shared default input/output processors
│       │   └── supabase.ts               # Anon / service-role / per-user clients
│       ├── scorers/
│       │   ├── _example.scorers.ts       # Tool-call accuracy + answer relevancy scorers
│       │   └── datasets/
│       │       └── _example.json         # Canonical Descript requests + expected tools for CI gate
│       ├── tools/
│       │   ├── import-media.ts           # importMedia
│       │   ├── agent-edit.ts             # agentEdit (Underlord)
│       │   ├── publish.ts                # publish
│       │   ├── projects.ts               # listProjects, getProject
│       │   └── jobs.ts                   # getJob, listJobs
│       └── workflows/                    # (empty; not used by this template)
└── tsconfig.json                         # Mastra's required TS config
```

## Files to remove when forking base

This template forks `template-mastra-base` via degit, then strips the base lead-intake example:

- `src/mastra/agents/_example.ts` (lead-intake) — **replaced** by the Descript automation agent
- `src/mastra/scorers/_example.scorers.ts` (lead scorers) — **replaced** by tool-call accuracy + answer relevancy
- `src/mastra/scorers/datasets/_example.json` (lead dataset) — **replaced** by the Descript request dataset

Keep everything else base ships (env loader, AIMock, Supabase factory, memory/processor baselines, index boot order, Docker, CI).

## Final dependency list

### Already installed by scaffold
- `@mastra/core`
- `@mastra/duckdb`
- `@mastra/evals`
- `@mastra/libsql` *(will be replaced by @mastra/pg — keep installed for now, can remove after migration)*
- `@mastra/loggers`
- `@mastra/memory`
- `@mastra/observability`
- `zod`

### To add as dependencies (production)
- `@mastra/pg` — Postgres storage adapter (for default domain memory)
- `@supabase/supabase-js` — Supabase client (for tools that read/write Supabase data)

### To add as devDependencies
- `tsx` — TypeScript runner for the eval script (`scripts/eval.ts`)

### NOT to install
- `pino` / `pino-pretty` — already provided via `@mastra/loggers`
- `@sentry/node` — Sentry not in this template
- `@t3-oss/env-core` — using Zod directly
- `winston` / `bunyan` / etc. — Mastra ships a logger
- Any other "standard Node project" dependencies — the scaffold has them or doesn't need them

## Final env vars

### Required to boot
- `APP_SECRET` — min 32 chars; HMAC signing, session tokens. `openssl rand -hex 32`
- `SUPABASE_URL` — project URL (must be valid URL)
- `SUPABASE_ANON_KEY` — RLS-respecting client key
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS; service-only
- `SUPABASE_DB_URL` — direct Postgres connection string for `@mastra/pg` (must start with `postgres`)
- `DESCRIPT_API_TOKEN` — Bearer token from Descript Settings → API tokens (scoped to a single Drive)
- At least one of: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`

### Optional (Descript — sensible defaults applied)
- `DESCRIPT_BASE_URL` — default `https://descriptapi.com/v1`
- `DESCRIPT_TIMEOUT_MS` — default `60000`
- `DESCRIPT_RETRIES` — default `3`
- `DESCRIPT_POLL_INTERVAL_MS` — default `3000`
- `DESCRIPT_POLL_MAX_ATTEMPTS` — default `600`
- `DESCRIPT_HEALTHCHECK_ON_BOOT` — default `false` (pings the Descript API at startup when `true`)

### Optional (inherited from base)
- `NODE_ENV` — `development` | `test` | `production` (default: `development`)
- `LOG_LEVEL` — `debug` | `info` | `warn` | `error` (default: `info`)
- `USE_AIMOCK` — `true` | `false` (default: `false`)
- `AIMOCK_URL` — default `http://localhost:4010`
- `E2E_BASE_URL` — only used during e2e runs
- `MASTRA_TELEMETRY_DISABLED` — set to `1` to silence Mastra's PostHog telemetry (recommended for locked-down networks)
- `MASTRA_CLOUD_ACCESS_TOKEN` — only if using hosted Mastra Studio

## Component map (what each file's job is)

| Component | File | Job |
|---|---|---|
| Env loader | `src/lib/env.ts` | Zod schema. Crashes on misconfig. |
| Mastra entry point | `src/mastra/index.ts` | Strict boot: env → AIMock switch → Mastra (with logger, observability, composite store, agents, scorers) |
| AIMock switch | `src/mastra/lib/aimock.ts` | When `USE_AIMOCK=true`, rewrite LLM provider base URLs before any client constructs |
| Descript client | `src/mastra/lib/descript-client.ts` | `DescriptClient` — Bearer auth, retry, timeout, and `pollJob()` for async operations |
| Memory baseline | `src/mastra/lib/memory.ts` | `createDefaultMemory()` factory: working memory ON (resource-scoped), semantic recall OFF |
| Processor baseline | `src/mastra/lib/processors.ts` | `defaultInputProcessors` (UnicodeNormalizer) + `defaultOutputProcessors` (TokenLimiter); model-backed safety processors present-but-commented (opt-in) |
| Supabase factory | `src/mastra/lib/supabase.ts` | Three named functions: `getSupabaseAnon`, `getSupabaseService`, `getSupabaseForUser` |
| Example agent | `src/mastra/agents/_example.ts` | Canonical `descript` automation agent (7 tools). Uses `createDefaultMemory()` + the shared processors. Registers scorers with `sampling: { type: 'ratio', rate: 1 }` |
| Tool wrappers | `src/mastra/tools/*.ts` | importMedia, agentEdit, publish, listProjects, getProject, getJob, listJobs — each calls `DescriptClient` and polls async jobs to completion |
| Scorer registrations | `src/mastra/scorers/_example.scorers.ts` | `toolCallAccuracyScorer` (custom) + `answerRelevancyScorer` (prebuilt prompt-alignment) |
| CI dataset | `src/mastra/scorers/datasets/_example.json` | Canonical Descript requests + expected tool per case + thresholds for offline eval |
| Eval runner | `scripts/eval.ts` | Loads dataset, invokes agent, runs scorers, asserts thresholds, exit 0/1 |
| Docker | `Dockerfile`, `docker-compose.yml`, `compose.dev.yml`, `.dockerignore` | Self-contained Mastra build, non-root, healthcheck on `/api/health` |
| CI | `.github/workflows/ci.yml` | typecheck → build → eval (against AIMock) → docker (main only) |
| Convention docs | `AGENTS.md`, `README.md`, `prompts/build-agent.md` | What to read before writing code (agents AND humans) |

## Boot order in `src/mastra/index.ts`

The order is load-bearing. Reordering breaks AIMock or env validation.

```typescript
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

import { descriptAgent } from './agents/_example';
import { toolCallAccuracyScorer, answerRelevancyScorer } from './scorers/_example.scorers';

export const mastra = new Mastra({
  agents: { descript: descriptAgent },
  scorers: { toolCallAccuracyScorer, answerRelevancyScorer },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new PostgresStore({ connectionString: env.SUPABASE_DB_URL }),
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
});
```

Note: top-level `await` is used in `MastraCompositeStore` initialization. This requires `"module": "ES2022"` (or higher) in `tsconfig.json` — already set by the scaffold.
