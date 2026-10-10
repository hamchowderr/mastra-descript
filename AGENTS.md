# AGENTS.md — Conventions for AI Coding Agents

This file is for AI coding agents (Claude Code, Cursor, Copilot, etc.) working on this codebase. It describes conventions, rules, and things to never do.

---

## Boot Order (critical)

`src/mastra/index.ts` must initialize in this exact order:

```
1. env validation       (import env from '../lib/env')
2. AIMock setup         (configureAIMock())
3. Descript healthcheck (only when DESCRIPT_HEALTHCHECK_ON_BOOT=true)
4. Mastra imports       (agents, tools, stores constructed after AIMock)
5. Mastra instance      (new Mastra({ ... }), including the webhook route)
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
- Never read `process.env.*` directly outside of `src/lib/env.ts`. Two deliberate exceptions: `lib/aimock.ts` *writes* provider base URLs into `process.env` for the AI SDK, and `lib/descript-workspace.ts` passes the OS `PATH` to the CLI sandbox
- When adding a new env var: add to the Zod schema in `env.ts` AND to `.env.example` at the same time
- Optional vars use `.optional()` in the schema; required vars have no default
- Boolean vars use the `boolish` transform defined at the top of `env.ts` (`"true"`/`"1"` → true, `"false"`/`"0"` → false). Never `z.coerce.boolean()`: it turns the string `"false"` into `true`
- File paths (`TURSO_DATABASE_URL` file: URLs, `WORKSPACE_ROOT`, `DUCKDB_PATH`) are resolved to absolute paths above `.mastra`, because `mastra dev` runs the bundle from a different working directory

---

## Agent Conventions

File naming: `src/mastra/agents/<kebab-name>.ts`. The `descript` agent lives in `_example.ts` (with `scorers/_example.scorers.ts` and `datasets/_example.json`) because this repo is a template: the `_` marks the files a fork replaces with its own agent.

Every agent must have `id`, `name`, `description`, `model`, `instructions`, and `tools`. The `description` is required — `MCPServer` fails to start without it.

Model strings live in `src/mastra/lib/models.ts`. LLM calls go through the Vercel AI Gateway: `vercel/<gateway model id>` (e.g. `vercel/anthropic/claude-sonnet-5.5`, gateway ids use dots), authenticated with `AI_GATEWAY_API_KEY`. Under `USE_AIMOCK=true` the direct Anthropic id (`anthropic/claude-sonnet-5-5`, dashes) is used, because AIMock fakes Anthropic's API, not the gateway. Never add direct provider keys for production use; one gateway key covers every provider.

Tools used only by one agent can live inline. Shared tools go in `src/mastra/tools/`.

---

## Descript API Conventions

The Descript API is **async and job-based**. Every mutation (importMedia, agentEdit, publish) returns a job ID. The tools in `src/mastra/tools/` poll automatically via `DescriptClient.pollJob()` and do not return until the job is done, unless `webhook: true` (built-in receiver) or a `callback_url` is set, in which case they return immediately.

Cost model: **only `agentEdit` spends AI credits** (it invokes Underlord). `importMedia` spends media-seconds (transcription); `publish` spends render time; reads/`cancelJob` are free. Each tool's description carries a `COST:` tag, and `getCostTotals` reports the running session total. `agentEdit` defaults to `DESCRIPT_AGENT_MODEL` (the `claude-haiku` alias, low-cost tier) and accepts `conversation_id` for multi-turn editing. Model ids change as Descript launches and retires models (`claude-haiku-4.5` was retired by 2026-10-09). `GET /agent/models` (`listAgentModels`) is the source of truth; prefer aliases for defaults and never hardcode a model enum.

A job has two status fields (spec v1.2):
- Top-level `job_state`: `"queued"` | `"running"` | `"stopped"` | `"cancelled"`. Only `stopped` and `cancelled` are final; `pollJob` keeps polling through `queued`.
- Nested `result.status` once stopped: `"success"` | `"partial"` (some imported files failed) | `"error"` (with `error_message` and `error_code`).

`jobOutcome()` in `descript-client.ts` folds these into one status (`success` | `partial` | `error` | `cancelled`) plus an error message; job tools use it rather than reading `result` themselves. `agentEdit` reports `success` with `project_changed: false` (Underlord stopped at a plan or brief step) as `partial`.

Job ids are prefixed (`project-media-import-<uuid>`), not bare UUIDs as the spec says, so never validate a job id with `.uuid()`.

Import naming: `add_media` keys are the media names users see in Descript. `importMedia` uses the file or URL name (or the item's `name`), and when adding to an existing project reads the project first so media, multitrack (`Sequences/<name>`) and composition names don't clash. Every import creates a new composition; Descript cannot append to an existing one.

Never retry a job-creating POST: `DescriptClient` retries 5xx only for GET/DELETE, because a POST that failed with 5xx may already have created a paid job. 429 retries are capped.

Webhooks: `POST /webhooks/descript/:token` (`lib/descript-webhook.ts`) is registered with `registerApiRoute` and `requiresAuth: false`. Descript doesn't sign callbacks, so the token must match `DESCRIPT_WEBHOOK_SECRET`, the payload is never trusted (the job is re-read with `GET /jobs/{id}`), and spend is recorded once per job. Tools build the callback URL server-side (`webhook: true`) so the secret never enters the agent's context.

**Never retry failed jobs automatically.** Report the error and let the user decide.

When chaining `importMedia → agentEdit`, always wait for `importMedia` to complete (status: "success") before calling `agentEdit`.

Endpoint coverage follows the official OpenAPI spec (`https://help.descript.com/developers/openapi.json`, v1.2); all 14 operations are wrapped. Free/sync endpoints: `GET /agent/models` (`listAgentModels`), `POST /export/transcript` (`exportTranscript` — raw file body; docx returned base64), `GET /search` (`searchDrive`), `POST /edit_in_descript/schema` (`createEditInDescriptUrl`, partner drives only).

Workflows live in `src/mastra/workflows/` and reuse the tools' exported `run*` functions + Zod schemas (e.g. `runImportMedia`, `importMediaInput`) — don't duplicate client logic in steps. Any workflow that spends AI credits must suspend for approval before the `agentEdit` step unless the caller opts out. Register new workflows in `src/mastra/index.ts` (and on the agent if it should run them).

Runtime skills are `agent-workspace/skills/<name>/SKILL.md` (Agent Skills spec; `name` must equal the directory). `agent-workspace/` is otherwise gitignored scratch. These are for the **descript agent at runtime**; `.agents/skills/mastra` + `.mcp.json` (`@mastra/mcp-docs-server`) are for coding agents working on this repo.

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
    { "name": "no matching tool", "input": "Delete project abc123.", "expectedTool": null }
  ]
}
```

The dataset currently has 13 cases. Keep at least 8, including at least one `null` case (agent must not hallucinate a tool call when none exists).

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
- **default domain** → `LibSQLStore` (libSQL/Turso via `TURSO_DATABASE_URL` + optional `TURSO_AUTH_TOKEN`) — the shared instance from `src/mastra/lib/memory.ts`'s `getSharedStore()`
- **editor domain** → the same `LibSQLStore` instance
- **observability domain** → `DuckDBStore` at `DUCKDB_PATH` (default `./mastra.duckdb`, resolved absolute; Docker sets `/app/data/mastra.duckdb` on the persistent volume)

All stores require an explicit `id` field:
```typescript
new LibSQLStore({ id: 'mastra-storage', url: env.TURSO_DATABASE_URL })
```

Prefer Postgres/pgvector (Supabase) instead? See `docs/postgres.md` for the full swap.

`DuckDBStore` requires glibc. Do not run it in Alpine-based containers — use `node:24-slim`.

---

## Reachability conventions

Every agent registered in `src/mastra/index.ts` is reachable through four standard protocols:

- REST: `POST /api/agents/{agentId}/generate` (and `/stream`) — automatic
- A2A agent card: `GET /api/.well-known/{agentId}/agent-card.json` — automatic
- A2A execute: `POST /api/a2a/{agentId}` (JSON-RPC, `method: "message/send"`) — automatic
- MCP: `POST /api/mcp/{serverId}/mcp` — via `MCPServer` instance (server id: `descript-mcp`; exposes `ask_descript` and the `transcriptExport` workflow)
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
- **Never change the Dockerfile base to `node:24-alpine`** — DuckDB will SIGSEGV. Use `node:24-slim`.
- **Never add a new env var without updating `.env.example`** — new devs won't know it exists
- **Never skip the Zod schema for a new env var** — process will start with undefined values silently
- **Never import from `src/mastra/` in `src/lib/`** — creates circular dependency risk
- **Never register an agent before its file passes typecheck** — comment it out until types are clean
- **Never use barrel/index imports** — import from the specific file
- **Never retry a failed Descript job automatically** — report the error and let the user decide
- **Never retry a job-creating Descript POST after a 5xx** — the job may exist; check `listJobs`
- **Never validate a Descript job id with `.uuid()`** — live ids are prefixed
- **Never pass the webhook secret through the agent** — use `webhook: true` so the tool builds the URL
- **Never fabricate Descript job results** — the tools poll until the job completes; trust their return value

---

## Ask Before Acting

Stop and confirm with the user before making these changes:

- Changing the boot order in `src/mastra/index.ts`
- Removing or renaming a scorer that's referenced in a dataset JSON
- Downgrading a Mastra package version
- Adding a new `domain` to the composite store
- Any storage backend migrations (libSQL/Turso ↔ Postgres/Supabase)
- Modifying `DESCRIPT_POLL_MAX_ATTEMPTS` or `DESCRIPT_POLL_INTERVAL_MS` defaults

---

## Useful Commands

```bash
npm run dev             # Start Studio at localhost:4111 — no Docker needed, storage defaults to a local file: DB
npm test                # Unit tests (Vitest), fake fetch, no network
npm run typecheck       # Verify types before running
npm run eval            # Run all 13 eval cases; exits 0 on pass, 1 on fail
npm run descript:ping   # Verify DESCRIPT_API_TOKEN is valid
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
