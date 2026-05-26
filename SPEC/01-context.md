# 01 — Context

## What this template is

`template-mastra-descript` is the Descript automation child template in Otaku Solutions' Mastra template family. It forks from `template-mastra-base` and adds:

- Typed Mastra tool wrappers around the Descript API (import, AI edit via Underlord, publish, project + job inspection)
- An example automation agent that uses the wrappers to run end-to-end Descript workflows
- A reusable HTTP client helper for the Descript API (auth, retry, timeout, async job polling)

## Relationship to base

| Layer | Source |
|---|---|
| Env loader (`src/lib/env.ts`) | Inherited, extended with Descript vars |
| AIMock provider switch | Inherited, unchanged |
| Supabase client factory | Inherited, unchanged |
| Mastra entry (`src/mastra/index.ts`) | Inherited, agent registration updated |
| Composite store, memory, observability | Inherited, unchanged |
| Memory baseline (`lib/memory.ts`), processor baseline (`lib/processors.ts`) | Inherited, unchanged |
| Docker, CI | Inherited |
| Lead-intake agent | **Removed** — replaced by the Descript automation agent |
| Lead-intake scorers | **Removed** — replaced by tool-call accuracy + answer relevancy |
| Descript HTTP client | **New** |
| Descript tool wrappers (7 tools across 5 files) | **New** |
| Descript automation agent | **New** |

## Scope decisions (do not relitigate)

| Decision | Choice | Why |
|---|---|---|
| Endpoint coverage | importMedia, agentEdit, publish, listProjects, getProject, getJob, listJobs | Covers the full import → edit → publish pipeline plus project/job inspection. Clients add more; the client helper makes new wrappers small. |
| Async ops | Tools poll internally via the client's `pollJob` — they don't return until the underlying job finishes | The agent never has to manage polling; a tool call is a complete operation |
| Job status model | Tools surface BOTH `job_state` ("running"/"stopped") and nested `result.status` ("success"/"partial"/"failed") | Descript's two-field status is a real gotcha; exposing both prevents the agent from misreporting partial results |
| Default agent model | `anthropic/claude-sonnet-4-6` | Owner default; strong at multi-step tool orchestration |
| Auth | `DESCRIPT_API_TOKEN` Bearer token, scoped to a single Drive | Matches Descript's API token model |
| Health check | `DESCRIPT_HEALTHCHECK_ON_BOOT=true` pings the API at startup | Optional; catches a bad token early at the cost of boot latency |
| Retry / timeout | 3 retries (5xx + network), 60s timeout, 3s poll interval, 600 max polls | Defaults via env; tuned for Descript's async render times |

## What this template ships with that clients keep

- The Descript HTTP client (`src/mastra/lib/descript-client.ts`) — auth, retry, timeout, and the `pollJob` helper
- 7 working tool wrappers across 5 files — use as-is or copy-and-adapt for other Descript endpoints
- The async job-polling pattern baked into every mutating tool
- A working automation agent that demonstrates the import → edit → publish pipeline

## Quality bar

Same as base, plus:

- **Connectivity passes** — `npm run descript:ping` authenticates against the Descript API with the configured token
- **Tool calls succeed** — a text-mode test in Studio runs a real Descript operation (e.g. list projects, or import → edit) and returns a result
- **Eval gate passes** — tool-call accuracy + answer relevancy scorers clear thresholds against canonical Descript requests
- **Polling works** — for a long-running render, the agent calls the tool once and gets the final result without timing out

## What this template does NOT include

- A Descript account / Drive (clients bring their own API token)
- Every Descript API endpoint (focused subset in v1)
- A webhook receiver (polling only)
- File upload (callers pass a public media URL to `importMedia`)
- Frontend (Next.js), VAPI/LiveKit webhooks, PM2/systemd, or reverse-proxy configs (deployment-time)
