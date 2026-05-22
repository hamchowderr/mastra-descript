# AGENTS.md — Conventions for AI Coding Agents

This file is for AI coding agents (Claude Code, Cursor, Copilot, etc.) working on this codebase. It describes conventions, rules, and things to never do.

---

## Boot Order (critical)

`src/mastra/index.ts` must initialize in this exact order:

```
1. env validation   (import env from '../lib/env')
2. AIMock setup     (configureAIMock())
3. Mastra instance  (new Mastra({ ... }))
```

**Why**: The Vercel AI SDK reads provider base URLs at client instantiation and caches them. AIMock must overwrite env vars before any AI SDK client is constructed. Env must validate before AIMock so it can read `USE_AIMOCK` and `AIMOCK_URL`.

Never reorder these. Never construct an `Agent` or `@ai-sdk/*` client before `configureAIMock()` is called.

---

## Import Rules

- Use **relative imports** for everything inside `src/mastra/`
- `src/lib/env` is the only cross-boundary import allowed in `src/mastra/`
- Never import from `src/mastra/` in `src/lib/`
- Never use barrel/index files — import from the specific file

```typescript
// correct
import { env } from '../../lib/env';
import { descriptAgent } from './agents/_example';

// wrong
import { env } from '@/lib/env';           // no path aliases
import { descriptAgent } from './agents';   // no barrel imports
```

---

## Environment Variables

All env vars flow through `src/lib/env.ts`. This is the single source of truth.

Rules:
- Never read `process.env.*` directly outside of `src/lib/env.ts`
- When adding a new env var: add to the Zod schema in `env.ts` AND to `.env.example` at the same time
- Optional vars use `.optional()` in the schema; required vars have no default
- Boolish vars (`USE_AIMOCK`) use the `boolish` transform defined at the top of `env.ts`

---

## Agent Conventions

File naming: `src/mastra/agents/<kebab-name>.ts` (prefix `_` for examples/templates).

Every agent must have `id`, `name`, `description`, `model`, `instructions`, and `tools`. The `description` is required — `MCPServer` fails to start without it.

Model string format: `anthropic/claude-sonnet-4-6` (provider/model-id).

Tools used only by one agent can live inline. Shared tools go in `src/mastra/tools/`.

---

## Descript API Conventions

The Descript API is **async and job-based**. Every mutation (importMedia, agentEdit, publish) returns a job ID. The tools in `src/mastra/tools/` handle polling automatically via `DescriptClient.waitForJob()` — they do not return until the job is done.

A job has two status fields:
- Top-level `job_state`: `"running"` | `"stopped"`
- Nested `result.status`: `"success"` | `"partial"` | `"failed"`

Tools surface both. If `result.status === "partial"`, surface this to the user — it means some operations succeeded but others didn't.

**Never retry failed jobs automatically.** Report the error and let the user decide.

When chaining `importMedia → agentEdit`, always wait for `importMedia` to complete (status: "success") before calling `agentEdit`.

---

## Scorer Conventions

File naming: `src/mastra/scorers/<agent-name>.scorers.ts`.

Dataset files: `src/mastra/scorers/datasets/<agent-name>.json`.

The Descript template uses **tool-call accuracy** eval (not structured output completeness). Each dataset case has `expectedTool: string | null` — the tool the agent should call, or `null` if no tool should be called.

```json
{
  "agentId": "descript",
  "thresholds": { "toolCallAccuracy": 0.85, "answerRelevancy": 0.80 },
  "cases": [
    { "name": "list projects", "input": "Show me all my projects.", "expectedTool": "listProjects" },
    { "name": "no matching tool", "input": "Cancel job abc123.", "expectedTool": null }
  ]
}
```

Minimum 8 cases. Include at least one `null` case (agent must not hallucinate a tool call when none exists).

Correct import paths for prebuilt scorers:
```typescript
import { createHallucinationScorer, createPromptAlignmentScorerLLM } from '@mastra/evals/scorers/prebuilt';
// NOT from '@mastra/evals/scorers/llm' or '@mastra/evals/scorers/code'
```

---

## AIMock Conventions

AIMock fixtures live in `./fixtures/`. Each fixture matches on `userMessage` (substring of the last user message) and returns a static response.

For tool-call accuracy evals under AIMock:
- Real tool execution can't happen (requires live Descript credentials)
- Instead, fixture responses should **mention the expected tool name** in their text
- `eval.ts` checks `result.text.includes(expectedTool)` — this smoke-tests AIMock routing

AIMock is started locally with:
```bash
npx @copilotkit/aimock --config aimock.json
```

In CI, AIMock runs as a Docker container; the CI yml mounts `./fixtures/` and passes `-f /fixtures`.

**Never set `ANTHROPIC_BASE_URL = AIMOCK_URL` bare** — `@ai-sdk/anthropic` appends `/messages`, producing `{base}/messages`. Set it to `${AIMOCK_URL}/v1` so requests land at `/v1/messages`. The `configureAIMock()` function handles this correctly — don't override it.

---

## Storage

The Mastra instance uses a composite store:
- **default domain** → `PostgresStore` (Supabase Postgres via `SUPABASE_DB_URL`)
- **editor domain** → `PostgresStore` (same connection)
- **observability domain** → `DuckDBStore`

All stores require an explicit `id` field:
```typescript
new PostgresStore({ id: 'mastra-storage', connectionString: env.SUPABASE_DB_URL })
```

`DuckDBStore` requires glibc. Do not run it in Alpine-based containers — use `node:22-slim`.

---

## Reachability conventions

Every agent registered in `src/mastra/index.ts` is reachable through four standard protocols:

- REST: `POST /api/agents/{agentId}/generate` (and `/stream`) — automatic
- A2A agent card: `GET /api/.well-known/{agentId}/agent-card.json` — automatic
- A2A execute: `POST /api/a2a/{agentId}` (JSON-RPC, `method: "message/send"`) — automatic
- MCP: `POST /api/mcp/{serverId}/mcp` — via `MCPServer` instance (server id: `descript-mcp`)
- Studio: `localhost:4111` UI — automatic via `mastra dev`

Note: `/a2a/{agentId}` (without `/api` prefix) is caught by Studio's router and returns HTML. Always use the `/api/` prefix for A2A and MCP calls.

When adding a new agent:
1. Register it in the `agents` field of the Mastra constructor (gets REST + A2A + Studio automatically)
2. Add it to the `agents` field of the `MCPServer` instance (exposes via MCP as `ask_<agentId>`)
3. Ensure the agent has a non-empty `description` property — MCPServer fails to start without it

---

## Things to Never Do

- **Never read `process.env` directly** — use `env` from `src/lib/env.ts`
- **Never construct an AI SDK client before `configureAIMock()`** — AIMock will be bypassed silently
- **Never set `ANTHROPIC_BASE_URL = AIMOCK_URL` bare** — append `/v1` so requests land at `/v1/messages`
- **Never change the Dockerfile base to `node:22-alpine`** — DuckDB will SIGSEGV. Use `node:22-slim`.
- **Never add a new env var without updating `.env.example`** — new devs won't know it exists
- **Never skip the Zod schema for a new env var** — process will start with undefined values silently
- **Never import from `src/mastra/` in `src/lib/`** — creates circular dependency risk
- **Never register an agent before its file passes typecheck** — comment it out until types are clean
- **Never use barrel/index imports** — import from the specific file
- **Never retry a failed Descript job automatically** — report the error and let the user decide
- **Never fabricate Descript job results** — the tools poll until the job completes; trust their return value

---

## Ask Before Acting

Stop and confirm with the user before making these changes:

- Changing the boot order in `src/mastra/index.ts`
- Removing or renaming a scorer that's referenced in a dataset JSON
- Downgrading a Mastra package version
- Adding a new `domain` to the composite store
- Any Supabase schema migrations
- Modifying `DESCRIPT_POLL_MAX_ATTEMPTS` or `DESCRIPT_POLL_INTERVAL_MS` defaults

---

## Useful Commands

```bash
npm run dev             # Start Studio at localhost:4111
npm run typecheck       # Verify types before running
npm run eval            # Run all 8 eval cases; exits 0 on pass, 1 on fail
npm run descript:ping   # Verify DESCRIPT_API_TOKEN is valid
npx supabase start      # Start local Supabase (Docker required)
```

Eval runs with `USE_AIMOCK=false` hit the real Anthropic + Descript APIs and incur cost. Use `USE_AIMOCK=true` with AIMock running for free deterministic runs during development.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
