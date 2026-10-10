<div align="center">

# 🎬 mastra-descript

### Describe the edit. An agent imports the media, runs the AI edit, and publishes, all through Descript's API.

**mastra-descript is a Mastra agent template that turns Descript's REST API into a conversational video and audio editor.** Tell it what you want in plain English, for example _"import this clip, remove the filler words, and publish it"_. It imports the media, asks [Underlord](https://www.descript.com/underlord) (Descript's AI editor) to make the edit, publishes a share link, and manages your projects and jobs. It uses the **REST API with a bearer token**, so it runs unattended on a server. Fork it, add a Descript API token, and you have a working agent reachable over REST, MCP, and A2A.

[![License: ISC](https://img.shields.io/badge/license-ISC-blue)](#-license)
[![Status: v1](https://img.shields.io/badge/status-v1-brightgreen)]()
[![Node: 24+](https://img.shields.io/badge/node-24%2B-339933?logo=node.js&logoColor=white)](#-getting-started)
[![Built on Mastra](https://img.shields.io/badge/built%20on-Mastra-000)](https://mastra.ai)
[![Powered by Descript API](https://img.shields.io/badge/powered%20by-Descript%20API-7c3aed)](https://docs.descriptapi.com)
[![Family: mastra-base](https://img.shields.io/badge/family-mastra--base-111)](https://github.com/hamchowderr/mastra-base)

</div>

---

## ⚡ What it does

Tell the agent what you want, in plain English:

> _"Import this video and remove every filler word."_ · _"Make a shareable cut of project abc123."_ · _"Write a 60-second script about morning routines."_

The `descript` agent picks the right tool, starts the Descript job, **waits for it to finish**, and returns the real result: a `project_id`, a share URL, or the job status. Every change (import, edit, publish) is an asynchronous Descript job; the agent handles the polling.

Then keep talking:

> _"Now add captions."_ · _"Publish it unlisted instead."_ · _"What did that cost me?"_

Edits can continue over several turns: the agent passes Underlord's `conversation_id` back, so Underlord keeps the context of earlier turns. Spend is tracked: **only AI edits spend AI credits**, and the agent keeps a running total.

Inside, it is one [Mastra](https://mastra.ai/) agent over a typed client for Descript's REST API (`descriptapi.com/v1`, bearer auth). The client was checked field by field against Descript's published OpenAPI spec (v1.2) and against the live API.

---

## 🎬 What a request looks like

One message runs real jobs and returns a share link. Here is the **import → edit → publish** pipeline:

<details>
<summary><b>"Import this clip, remove the filler words, and publish it"</b> (click to expand)</summary>

**You:**

> Import https://example.com/talk.mp4 into a project called "Talk", remove all filler words, then publish it.

**The `descript` agent** runs the pipeline and waits for each job:

```
→ importMedia({ media: [{ url: "https://example.com/talk.mp4" }], project_name: "Talk" })
    status: success · media "talk.mp4" · media_seconds_used: 42 · ai_credits_used: none
    project_id: 3e27c396-…

→ agentEdit({ project_id, prompt: "Remove all filler words" })     // default model: the claude-haiku alias
    status: success · project_changed: true · ai_credits_used: 6 · resolved_model: claude-haiku-5.5
    conversation_id: 671a4425-…   ← passed back on the next edit

→ publish({ project_id })                                           // Descript picks Video, or Audio for audio-only
    status: success · media_type: Video · share_url: https://share.descript.com/view/2ZzWCyd53Vc
```

**You** continue with _"add captions"_, and the agent continues the same Underlord session with `conversation_id`.

</details>

> Illustrative. Real fields and credit costs depend on your prompt, the model, and the media. Imports spend media-seconds; only `agentEdit` spends AI credits.

---

## 🧭 What this agent adds on top of Underlord

Underlord does the editing. When this agent edits, it sends your instruction to Underlord (`POST /jobs/agent`) and Underlord decides how to cut. This agent does not edit media itself. What it adds is everything around the edit: getting media in and out, running whole pipelines without someone in the Descript app, and keeping spend visible and bounded.

| Capability | Underlord on its own | This agent |
|---|---|---|
| **Getting media in** | Works on media already in a project | Imports from public URLs or uploads local files (`file_path`, Descript's direct-upload flow), several files per call, into a new or existing project. Media keep their real file names; names that would clash with files already in the project are renamed (`talk (2).mp4`) instead of failing |
| **Synced tracks** | Edits what is in the project | Imports separately recorded tracks (two cameras, host and guest mics) as one **Multitrack Sequence** with per-track sync offsets |
| **Layout and placement** | Edits the open composition | Sets composition size on import (1080×1920 vertical, 1080×1080 square), workspace and folder for new projects |
| **End-to-end pipelines** | One request at a time, inside Descript | Runs import → edit → publish from outside Descript: chat, REST, MCP or A2A clients, or the `importEditPublish` workflow |
| **Human approval before spending** | No approval step | `importEditPublish` pauses before the AI edit until someone approves it |
| **Credit safety** | Spends credits as it works | Running session totals of AI credits and media-seconds (`getCostTotals`), an optional hard cap (`DESCRIPT_CREDIT_CAP`) checked before each AI edit, the low-cost model as the default, and checks that reject bad URLs, files and option combinations before any job is created |
| **Catching edits that did not run** | Can report `success` with `project_changed: false` when it stops at a plan or brief step | Reports that as `partial` with an explanation, never as done |
| **Clear failures** | Error results carry `error_message` and `error_code` | Surfaces them, says which file failed in a partial import, turns HTTP 402 into a clear out-of-credits message, and never retries a job-creating request after a server error (a retry could start a second paid job) |
| **Multi-turn editing** | Keeps context within a conversation | Passes `conversation_id` between turns, including when a job runs in webhook mode |
| **Model choice** | Model picker in the app | Defaults to the `claude-haiku` alias (tracks the current low-cost Haiku), lists the live catalog with cost tiers (`listAgentModels`), and reports the model that actually ran (`resolved_model`) |
| **Working across the drive** | Edits one project | Searches names and transcript content across the drive (`searchDrive`), exports transcripts in six formats without publishing (`exportTranscript`), reads existing publishes so share links are reused instead of republished |
| **Long jobs** | n/a | `webhook: true` returns at once; the built-in receiver (`POST /webhooks/descript/<secret>`) re-reads the finished job from Descript and records its spend |
| **Content workflows** | n/a | Four runtime skills the agent loads on demand: cost-safe editing, podcast polish, social clips, transcript content |
| **Memory and records** | n/a | Remembers each user's preferences across conversations (resource-scoped working memory), and offers versioned business data through Dolt tools over MCP |
| **Quality and operations** | n/a | Tool-selection evals in CI, unit tests, traces and metrics in Mastra Studio, optional JWT auth, one-command Docker deploy |

### How this relates to Descript's own integrations

- **Descript's hosted MCP server** (`api.descript.com/v2/mcp`) exposes seven tools. Its tool calls require an interactive OAuth sign-in, and it does not accept the REST bearer token (checked 2026-06-18), so a server-side agent cannot use it unattended. This agent uses the REST API instead and covers all seven of those operations, plus the ones listed above.
- **Descript's Zapier app** is public and, per Descript's changelog, "at parity with the API". It covers single-step automations well. This agent adds the parts that sit outside a single API call: conversation, approval steps, credit guardrails, stall detection, and the checks before submitting.

---

## 💸 Cost model: what spends what

Descript bills on **two separate meters**, and only one tool touches the AI.

| Operation | Calls Underlord (AI)? | What it costs |
|---|---|---|
| `agentEdit` | ✅ **yes**, the only AI tool | **AI credits** (`ai_credits_used`); scales with model and work. May also report `media_seconds_used` for generated audio/video |
| `importMedia` | ❌ no | media-seconds (`media_seconds_used`) for transcription |
| `publish` | ❌ no | render time |
| `listProjects` · `getProject` · `getJob` · `listJobs` · `cancelJob` · `getPublishedSubtitles` · `getCostTotals` · `listAgentModels` · `exportTranscript` · `searchDrive` · `createEditInDescriptUrl` | ❌ no | **free** (read or control) |

`agentEdit` defaults to the **`claude-haiku`** alias, which Descript resolves to its current low-cost Haiku model (`claude-haiku-5.5` as of 2026-10-10; `auto` is medium cost). Set `DESCRIPT_AGENT_MODEL` to change the default. `getCostTotals` returns the running session total, and `DESCRIPT_CREDIT_CAP` stops an edit before it is submitted once the cap is reached. _Measured 2026-06-18: a 10-second import cost 10 media-seconds and 0 AI credits; a simple edit on the low-cost Haiku model cost about 2 credits._

---

## 🧰 The tools

| Tool | Does | Cost |
|---|---|---|
| `importMedia` | Import public URLs **or local workspace files** (direct upload) into a new or existing project. Media keep their file names (or a `name` you give, with an optional folder path). Optional `multitrack` groups files into synced tracks. `width`/`height` for vertical or square, `workspace_name`/`folder_name` placement. Checks URLs, files and options before submitting; returns per-file `media_status` and the created compositions | media-seconds |
| `agentEdit` | Natural-language edit via Underlord; multi-turn via `conversation_id`; flags edits that changed nothing | **AI credits** |
| `publish` | Render a share link; Descript chooses Video or Audio unless you ask; returns the published `media_type` and `composition_id` | render time |
| `getPublishedSubtitles` | WEBVTT subtitles for a published project | free |
| `listProjects` / `getProject` | List (by name, folder, creator, dates) and inspect projects, including existing publishes | free |
| `getJob` / `listJobs` | Job state (`queued`, `running`, `stopped`, `cancelled`), result, error message, progress | free |
| `cancelJob` | Cancel a queued or running job (`DELETE /jobs/{id}`) | free |
| `getCostTotals` | Running session spend (AI credits and media-seconds) | free |
| `listAgentModels` | Live Underlord model ids and aliases with cost tiers (`GET /agent/models`) | free |
| `exportTranscript` | Transcript as txt, markdown, html, rtf, docx or srt, no publish needed (`POST /export/transcript`) | free |
| `searchDrive` | Search names and transcript content across the drive; `visual` search on Enterprise drives (`GET /search`) | free |
| `createEditInDescriptUrl` | Partner "Edit in Descript" one-time import link (`POST /edit_in_descript/schema`) | free |

`importMedia`, `agentEdit` and `publish` wait for the job by default. Pass `webhook: true` (built-in receiver; needs `PUBLIC_BASE_URL` and `DESCRIPT_WEBHOOK_SECRET`) or your own `callback_url` to return at once while Descript calls back when the job finishes.

### Workflows

Registered on the Mastra instance and on the agent:

| Workflow | Steps | Cost |
|---|---|---|
| `importEditPublish` | import → **pause for approval** → Underlord edit → publish; stops at the first step that does not succeed and never retries | media-seconds + AI credits + render |
| `transcriptExport` | export transcript → word count and speakers | free |

Resume the approval step with `run.resume({ step: 'approve-edit', resumeData: { approved: true } })` or from Studio. Pass `auto_approve: true` to skip it.

### Runtime skills

[Mastra workspace skills](https://mastra.ai/docs/sandbox/skills) in `agent-workspace/skills/`. The agent sees their names and descriptions and loads one when a task needs it:

`descript-cost-safe-editing` · `descript-podcast-polish` · `descript-social-clips` · `descript-transcript-content`

---

## 🚀 Getting started

**Prerequisites:** Node.js 24+ · an Anthropic API key (or OpenAI/Google) · a Descript API token (Descript → Settings → API tokens). Local development needs no Docker or external database: storage defaults to a local libSQL `file:` database.

```bash
# 1. Clone and install
git clone https://github.com/hamchowderr/mastra-descript.git && cd mastra-descript
npm install

# 2. Configure (every variable is documented inline)
cp .env.example .env
#   Fill in: APP_SECRET, ANTHROPIC_API_KEY, DESCRIPT_API_TOKEN

# 3. Check the Descript token
npm run descript:ping        # → ✓ Descript API is reachable … (api_version v1)

# 4. Run: Mastra Studio at http://localhost:4111
npm run dev
```

Then chat with the `descript` agent in Studio:

> Import this video into a new project called Demo: https://example.com/video.mp4

It calls `importMedia`, waits for the job, and returns the `project_id`.

| Command | What it does |
|---|---|
| `npm run dev` | Mastra Studio and the agent server on `:4111`, with hot reload |
| `npm run build` / `npm run start` | Production bundle in `.mastra/output/` / run it |
| `npm test` | Unit tests (Vitest), no network |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run eval` | Tool-selection accuracy and answer-relevancy eval |
| `npm run score:list` | List the registered scorers |
| `npm run descript:ping` | Check `DESCRIPT_API_TOKEN` |
| `npm run descript:verify` | Cost-ordered API verification harness (free checks unless enabled) |

---

## 🔌 Reachability

With `npm run dev` running, the `descript` agent answers on four surfaces:

```bash
# REST (use /stream for streaming)
curl -X POST http://localhost:4111/api/agents/descript/generate \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"List all my Descript projects."}]}'

# A2A: agent card + JSON-RPC message/send
curl http://localhost:4111/api/.well-known/descript/agent-card.json
curl -X POST http://localhost:4111/api/a2a/descript -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"kind":"message","messageId":"m1","role":"user","parts":[{"kind":"text","text":"List my projects."}]}}}'
```

- **MCP:** add `{"url":"http://localhost:4111/api/mcp/descript-mcp/mcp"}` to your MCP client. It exposes the agent as `ask_descript`, the `transcriptExport` workflow, and the Dolt tools (`doltQuery`, `doltWrite`, `doltHistory`).
- **Studio:** `http://localhost:4111` for chat, traces, metrics, and the Agent Editor.
- **Webhooks:** `POST /webhooks/descript/<DESCRIPT_WEBHOOK_SECRET>` receives Descript job callbacks (off unless the secret is set).

> **Working memory** is per user: pass `memory.resource` (a stable user id) and `memory.thread` (a conversation id) in the request body. See `src/mastra/lib/memory.ts`.

---

## 🧱 Architecture

Forked from [`mastra-base`](https://github.com/hamchowderr/mastra-base): a single Mastra + Hono agent server with a self-contained Docker stack. Storage is libSQL/Turso; observability uses DuckDB.

```
src/
├─ lib/env.ts                     Zod-validated env loader; the process exits on bad config
└─ mastra/
   ├─ index.ts                    Entry: env → AIMock → optional Descript healthcheck → Dolt bootstrap → Mastra (MCP, A2A, webhook route)
   ├─ agents/_example.ts          descriptAgent: instructions, 14 tools, workflows, workspace
   ├─ lib/
   │  ├─ descript-client.ts       Typed REST client: every endpoint, polling, job outcome, safe retries, 402 parsing
   │  ├─ descript-webhook.ts      Callback receiver: token check, re-read job, record spend once
   │  ├─ descript-workspace.ts    Sandboxed workspace with the descript-api CLI (ad-hoc use only)
   │  ├─ cost-meter.ts            Session AI-credit and media-second totals, credit cap
   │  ├─ memory.ts                Resource-scoped working memory + shared LibSQLStore/LibSQLVector
   │  ├─ processors.ts            Shared input/output processors
   │  ├─ dolt.ts                  Dolt connection + first-boot database bootstrap
   │  ├─ aimock.ts                AIMock routing for deterministic evals
   │  └─ *.test.ts                Unit tests (job states, defaults, retries, fields, webhook)
   ├─ tools/                      importMedia · agentEdit · publish · projects · jobs · published ·
   │                              cost · agent-models · export-transcript · search · edit-in-descript · dolt
   ├─ workflows/                  importEditPublish (approval pause) · transcriptExport
   └─ scorers/                    toolCallAccuracy + answerRelevancy + dataset (13 cases)
scripts/
├─ descript-ping.ts               Token check (GET /status)
├─ descript-verify.ts             Cost-ordered verification harness
├─ descript-mcp-probe.ts          Raw probe of Descript's hosted MCP auth layer (free)
├─ descript-mcp-mastra.ts         Same probe through Mastra's MCPClient (free)
├─ bake-studio.mjs                Docker build step: writes the served Studio's config into its index.html
└─ eval.ts                        Eval gate
fixtures/ · aimock.json           AIMock fixtures and config
agent-workspace/skills/           Runtime skills
.mcp.json · .agents/skills/mastra Dev-time Mastra docs MCP server + Mastra coding skill
Dockerfile · docker-compose.yml   node:24-slim runtime + Mastra and Dolt services
```

### Stack

| Layer | Technology |
|---|---|
| Agent framework | [Mastra](https://mastra.ai): `@mastra/core`, `memory`, `evals`, `libsql`, `duckdb`, `observability`, `auth`, `mcp`, `editor` |
| LLM | Claude Sonnet 4.6 for the agent; Underlord is multi-provider |
| API server | [Hono](https://hono.dev), mounted by Mastra |
| Database | [libSQL](https://github.com/tursodatabase/libsql)/[Turso](https://turso.tech): a local `file:` DB in development, hosted Turso in production · DuckDB for traces and metrics · [Dolt](https://www.dolthub.com/) for versioned data. Postgres/pgvector instead? See [`docs/postgres.md`](docs/postgres.md) |
| Descript CLI | [`@descript/platform-cli`](https://www.npmjs.com/package/@descript/platform-cli) in a sandboxed workspace; ad-hoc exploration only, not the cost-tracked path |
| Auth | `@mastra/auth` (HS256 JWT, enabled by `MASTRA_JWT_SECRET`) |
| Testing | [Vitest](https://vitest.dev) unit tests · [AIMock](https://aimock.copilotkit.dev) evals · the `descript:verify` harness |
| Runtime | Docker `node:24-slim` (DuckDB needs glibc; `@descript/platform-cli` needs Node 24) |

---

## 🧪 Build & test

```bash
npm test                     # unit tests, no network
npm run typecheck            # tsc --noEmit
npm run build                # mastra build → .mastra/output/

# API verification harness: free read-only checks by default
npm run descript:verify
DESCRIPT_VERIFY_WRITES=1 npm run descript:verify   # + write checks that spend nothing
DESCRIPT_VERIFY_SPEND=1  npm run descript:verify   # + checks that may spend (owner approval)

# Eval: tool-selection accuracy + answer relevancy
npm run eval                                 # live (Anthropic + Descript)
npx @copilotkit/aimock --config aimock.json &
USE_AIMOCK=true npm run eval                 # deterministic, no API cost

# Docker (docker-compose.yml only exposes 4111 on the internal network for Coolify;
# create a local docker-compose.override.yml with  ports: ["4111:4111"]  to reach it from the host)
docker build -t mastra-descript:test . && docker compose up -d
curl http://localhost:4111/health
```

For development inside Docker, `compose.dev.yml` runs `mastra dev` from the build stage with `./src` mounted read-only: `docker compose -f docker-compose.yml -f compose.dev.yml up`.

CI runs typecheck, then unit tests, build and the AIMock eval in parallel on every pull request; the Docker image build runs on pushes to `main`. The eval gate requires tool-call accuracy ≥ 0.85 and answer relevancy ≥ 0.80.

---

## 🔭 Inspect & tune the agent (Mastra Studio)

```bash
npm run dev           # agent server + Studio → http://localhost:4111
```

- 💬 **Chat** with the `descript` agent (uses your `ANTHROPIC_API_KEY`)
- ✏️ **Edit and version the system prompt** in the Agent Editor
- 🧠 **Memory and threads**, stored in the local libSQL database
- 🔭 **Traces and metrics** for each run (agent, tool, and LLM spans)
- 🗂️ **Tools**: the 14 Descript tools and their `COST:` notes
- ✅ **Scorers**: tool-call accuracy and answer relevancy

---

## ✅ Verified against ground truth

Behavior was checked in three passes. Spending runs used a small budget approved by the owner.

**June 2026, community claims** (`descript:verify` harness, ~9 AI credits and ~30 media-seconds in total):

- **Confirmed:** bearer auth on REST · the two-meter cost split · `GET /status` · several files in one import assemble into one composition · `conversation_id` continues an Underlord session · there is no credits-remaining endpoint.
- **Refuted:** _"can't put multiple files in one project"_, _"agent responses are truncated"_, _"the API can't cancel jobs"_.
- **Reproduced:** the plan-approval stall (an ambiguous edit returns `success` with `project_changed: false` and builds nothing), which `agentEdit` reports as a non-success.

**October 2026, spec audit:** every tool was compared field by field with Descript's OpenAPI spec v1.2, the live model catalog, and the supported-file-types page. Fixes: failed jobs (`status: "error"` with `error_message`) and queued jobs were misread · media got placeholder names and a forced English transcription language · publish forced Video, which Descript rejects for audio-only compositions · the default model id had been retired · the upload allow-list missed about 15 supported file types · job-creating requests were retried after server errors.

**October 2026, live check** (0 AI credits, about 15 media-seconds): file import with real names · re-import into the same project renamed (`host (2).mp3`) instead of rejected · a Multitrack Sequence with a 0.5 s offset · publish of an audio-only composition chose Audio · the webhook receiver recorded a real finished job once and ignored the replay.

**Where the live API differs from the spec (v1.2):**

- Job ids are not bare UUIDs as documented: imports return `project-media-import-<uuid>` and publishes `project-media-publish-<project_id>-<uuid>`.
- Each import creates a new composition; there is no way to add clips to an existing composition, so the agent names repeat imports uniquely (`Main (2)`).
- Multitrack Sequences are stored as media named `Sequences/<name>`.
- `GET /jobs` results include `publish` jobs, though the `type` filter accepts only `import/project_media` and `agent`.

---

## 🗺️ Roadmap

- 📝 **More workflows**: highlight reels and batch repurposing built on the existing skills.
- 🔗 **`n8n-nodes-descript`** and a **Make custom app** that reuse this verified API contract.

---

## ❓ FAQ

- **Does it use Descript's MCP server?** No. It uses the REST API (`descriptapi.com/v1`) with a bearer token. The hosted MCP (`/v2/mcp`) requires an interactive OAuth sign-in for tool calls, which a server-side agent cannot complete unattended.
- **Will an API call spend AI credits?** Only `agentEdit` (Underlord) spends AI credits. Imports spend media-seconds, publishes spend render time, and reads and `cancelJob` are free. `getCostTotals` shows the running total.
- **How do I cap spend?** Set `DESCRIPT_CREDIT_CAP`. `agentEdit` stops before submitting once the session total reaches it. There is no balance endpoint, so the cap counts spend in this session.
- **Which model does Underlord use?** The `claude-haiku` alias by default (`DESCRIPT_AGENT_MODEL`), which follows Descript's current low-cost Haiku. The catalog spans Claude, Gemini, GPT and more and changes over time; `listAgentModels` (`GET /agent/models`) is the source of truth. Each edit reports the model that ran as `resolved_model`.
- **Can I iterate on an edit?** Yes. Pass the `conversation_id` from the previous `agentEdit`, with the same `project_id`.
- **Can I import camera angles or separate mics as synced tracks?** Yes. Group them with `importMedia`'s `multitrack` option and set an `offset` in seconds for any track that started later.
- **Does it run on Windows?** Yes: Node 24 and `npm run dev`. Docker uses `node:24-slim`.
- **What if my token is rejected?** Run `npm run descript:ping`. A `401 "Could not find token"` means the token is stale or revoked; create a new one in Descript → Settings → API tokens.

---

## 🤝 Contributing

Developer docs (conventions, boot order, import rules, the cost model, and things never to do) are in [`AGENTS.md`](AGENTS.md). **The README is for orientation; `AGENTS.md` is for working in the code.**

Issue tracking uses **bd (beads)** with a Dolt-backed database: `bd ready` finds work, `bd create` files it. No markdown TODO lists.

---

## 🙏 Acknowledgments

- **[Descript](https://www.descript.com/)**: the editor, the API, and Underlord.
- **[Mastra](https://mastra.ai/)**: the agent framework (agents, memory, evals, observability, MCP, A2A).
- **[`mastra-base`](https://github.com/hamchowderr/mastra-base)**: the template this forks from.
- **[Turso](https://turso.tech/)**, **[Hono](https://hono.dev/)**, and **[Anthropic](https://www.anthropic.com/)**: database, server, and models.

---

## 📜 License

**ISC.** Part of the `mastra-base` template family. © 2026 Otaku Solutions.
