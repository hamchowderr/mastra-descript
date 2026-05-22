# template-mastra-descript

A production-ready Mastra agent for Descript video and audio editing workflows. Automates import, AI editing via Underlord, and publishing — entirely from natural language. Includes full eval pipeline, Docker, and CI.

---

## Quickstart (5 minutes)

**Prerequisites**: Node 22+, Docker Desktop, a Supabase project, an Anthropic API key, a Descript API token.

```bash
# 1. Clone and install
git clone <repo> my-descript-agent && cd my-descript-agent
npm install

# 2. Configure environment
cp .env.example .env
# Fill in: APP_SECRET, SUPABASE_*, ANTHROPIC_API_KEY, DESCRIPT_API_TOKEN

# 3. Start local Supabase (first time only)
npx supabase start

# 4. Run
npm run dev
# → Mastra Studio at http://localhost:4111
```

Chat with the `descript` agent in Studio to verify everything works. Send:

> Import this video into a new project called Demo: https://example.com/video.mp4

Expected: agent calls `importMedia`, polls until the job completes, and returns the project ID.

---

## Quickstart — Descript API

Before running the full agent, verify your Descript API token works:

```bash
npm run descript:ping
# → ✓ Descript API is reachable and the API token is valid.
```

Get your token from Descript Settings → API tokens. It must have read/write access to projects and compositions.

---

## Reachability

Once the dev server is running (`npm run dev`), the `descript` agent is reachable through four standard protocols:

### REST API

```bash
curl -X POST http://localhost:4111/api/agents/descript/generate \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"List all my Descript projects."}]}'
```

For streaming responses, use `/stream` instead of `/generate`.

#### Working memory (persist context per user)

Agents have **working memory** enabled (resource-scoped — see `src/mastra/lib/memory.ts`). For it to persist across a user's conversations, pass `memory.resource` (a stable user ID) and `memory.thread` (the conversation ID) in the body:

```bash
curl -X POST http://localhost:4111/api/agents/descript/generate \
  -H "Content-Type: application/json" \
  -d '{
    "messages":[{"role":"user","content":"List all my Descript projects."}],
    "memory":{"resource":"user-alice-456","thread":"conversation-123"}
  }'
```

Without `memory.resource`, working memory falls back to thread-only (no cross-conversation persistence). Semantic recall is intentionally off. Storage uses the Mastra instance's Postgres (Supabase), which supports the `mastra_resources` table resource-scoping needs — no extra setup.

### A2A (Agent-to-Agent Protocol)

```bash
# Get agent card
curl http://localhost:4111/api/.well-known/descript/agent-card.json

# Send a message (JSON-RPC)
curl -X POST http://localhost:4111/api/a2a/descript \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"kind":"message","messageId":"msg-1","role":"user","parts":[{"kind":"text","text":"List all my Descript projects."}]}}}'
```

### MCP (Model Context Protocol)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "template-mastra-descript": {
      "url": "http://localhost:4111/api/mcp/descript-mcp/mcp"
    }
  }
}
```

The agent appears as a tool named `ask_descript`.

### Studio (visual UI + Editor)

Open `http://localhost:4111`. Studio provides interactive chat, trace inspection, metrics, and the Agent Editor for non-developers to tune instructions without touching code.

---

## File Structure

```
template-mastra-descript/
├── src/
│   ├── lib/
│   │   └── env.ts                  # Zod-validated env loader — crashes on bad config
│   └── mastra/
│       ├── index.ts                # Entry point: env → AIMock → Mastra instance
│       ├── agents/
│       │   └── _example.ts         # descriptAgent — the Descript automation agent
│       ├── lib/
│       │   ├── aimock.ts           # Routes LLM calls to AIMock when USE_AIMOCK=true
│       │   ├── descript-client.ts  # Typed Descript API client (all endpoints + polling)
│       │   └── supabase.ts         # Supabase client factory
│       ├── scorers/
│       │   ├── _example.scorers.ts # toolCallAccuracy + answerRelevancy scorers
│       │   └── datasets/
│       │       └── _example.json   # Eval dataset — 8 cases with expectedTool
│       └── tools/
│           ├── import-media.ts     # importMedia — async import from URL
│           ├── agent-edit.ts       # agentEdit — Underlord AI edit
│           ├── publish.ts          # publish — generate shareable link
│           ├── projects.ts         # listProjects, getProject
│           └── jobs.ts             # getJob, listJobs
├── scripts/
│   ├── eval.ts                     # CI eval gate — tool-call accuracy + answer relevancy
│   └── descript-ping.ts            # Auth check — verifies DESCRIPT_API_TOKEN works
├── fixtures/
│   └── descript-agent.json         # AIMock fixtures for all 8 eval cases
├── .github/
│   └── workflows/
│       └── ci.yml                  # typecheck → build + eval (parallel) → docker
├── Dockerfile                      # Multi-stage, node:22-slim runtime
├── docker-compose.yml              # Production compose
├── compose.dev.yml                 # Dev compose override
├── aimock.json                     # AIMock config — routes to ./fixtures/
├── .env.example                    # All required env vars with comments
└── AGENTS.md                       # Conventions for AI coding agents
```

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start Mastra Studio at localhost:4111 |
| `npm run build` | Bundle for production (output → `.mastra/output/`) |
| `npm run start` | Start production server (no Studio) |
| `npm run eval` | Run offline eval gate against all 8 dataset cases |
| `npm run descript:ping` | Verify Descript API token is valid |
| `npm run typecheck` | TypeScript type check (zero-emit) |
| `npm run score:list` | List registered scorers |

---

## Descript Workflows

The agent handles three common workflows automatically:

### 1. Import → Edit → Publish

```
importMedia({ media_url, project_name })   → project_id
agentEdit({ project_id, prompt })          → Underlord edits the project
publish({ project_id, media_type: 'Video', resolution: '1080p' }) → share_url
```

### 2. Edit an existing project

```
listProjects({ name: '...' })   → find project_id
agentEdit({ project_id, prompt })
```

### 3. New project from prompt only (no media)

```
agentEdit({ project_name: '...', prompt: 'Write a 60-second script about X' })
```

All mutations (import, edit, publish) are async job-based. Tools poll until the job completes and return the final result — callers don't need to manage polling.

---

## Running Evals

```bash
# Against live Anthropic + Descript APIs
npm run eval

# Against AIMock (deterministic, no API cost)
npx @copilotkit/aimock --config aimock.json &
USE_AIMOCK=true npm run eval

# Custom dataset
node --env-file=.env --import tsx/esm scripts/eval.ts path/to/dataset.json
```

The eval gate checks **tool selection accuracy** (did the agent call the right tool?) and **answer relevancy** (is the response useful?). Thresholds: `toolCallAccuracy ≥ 0.85`, `answerRelevancy ≥ 0.80`.

Under AIMock, tool execution is skipped (real Descript API calls can't run without credentials). The eval checks that AIMock routes correctly by verifying the fixture response mentions the expected tool name.

---

## Docker

```bash
# Build
docker build -t my-descript-agent:latest .

# Run
docker compose up -d

# Health check
curl http://localhost:4111/health
```

> **Local Supabase note**: Docker containers can't reach `127.0.0.1` on the host. Set `SUPABASE_DB_URL` to use `host.docker.internal` instead when running via Docker Desktop locally.

---

## Deployment Notes

### Docker image size

The production image is ~676MB. This is larger than typical Node.js Docker images because:

- The base is `node:22-slim` (Debian, glibc) instead of `node:22-alpine` (musl)
- DuckDB ships native binaries that segfault on musl libc, even with `gcompat`
- DuckDB is required by `@mastra/observability` for trace storage

If you need a smaller image, swap `DuckDBStore` for `LibSQLStore` in the observability domain (`src/mastra/index.ts`). Trade-off: slower trace queries in Studio under load.

---

## Common Gotchas

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid environment variables` on boot | Missing or malformed `.env` | Check each var listed in the error against `.env.example` |
| `ECONNREFUSED 127.0.0.1:54322` | Local Supabase not running | `npx supabase start` |
| `descript:ping` returns 401 | Invalid `DESCRIPT_API_TOKEN` | Get a fresh token from Descript Settings → API tokens |
| `descript:ping` returns 403 | Token lacks required scopes | Token needs read/write access to projects and compositions |
| Tool returns `status: "failed"` | Descript job failed server-side | Check the `error` field in the result; do not retry automatically |
| Tool returns `status: "partial"` | Some operations succeeded, others didn't | Surface this to the user — inspect which steps completed |
| Import job times out | Very large file or slow source server | Increase `DESCRIPT_POLL_MAX_ATTEMPTS` or use a faster CDN URL |
| Docker container crashes (SIGSEGV) | DuckDB requires glibc, not musl | Use `node:22-slim`, not `node:22-alpine` — see Deployment Notes |
| `ECONNREFUSED` inside Docker | `127.0.0.1` in DB URL | Replace with `host.docker.internal` |
| Agent not listed in Studio | Not registered in `mastra.agents` | Add to `src/mastra/index.ts` |
| PostHog telemetry noise in restricted networks | Mastra runtime phones home on startup | Set `MASTRA_TELEMETRY_DISABLED=1` in `.env` |
| DB connection errors at scale | Direct Supabase connection has limited slots | Use the **session pooler** URL from Supabase dashboard |

---

## Environment Variables

See `.env.example` for the full list with comments. Minimum required:

- `APP_SECRET` — min 32 chars, generate with `openssl rand -hex 32`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`
- At least one of: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`
- `DESCRIPT_API_TOKEN` — Bearer token from Descript Settings → API tokens

Descript-specific tunables (all have defaults):

| Variable | Default | Purpose |
|---|---|---|
| `DESCRIPT_BASE_URL` | `https://descriptapi.com/v1` | API base URL |
| `DESCRIPT_TIMEOUT_MS` | `60000` | Per-request timeout |
| `DESCRIPT_RETRIES` | `3` | Retry count on transient errors |
| `DESCRIPT_POLL_INTERVAL_MS` | `3000` | Job polling interval |
| `DESCRIPT_POLL_MAX_ATTEMPTS` | `600` | Max poll attempts before timeout |
| `DESCRIPT_HEALTHCHECK_ON_BOOT` | `false` | Verify token on every startup |

---

## For AI Coding Agents

See `AGENTS.md` for conventions, boot order, import rules, and things to never do.
