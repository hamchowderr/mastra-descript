<div align="center">

# 🎬 mastra-descript

### Describe the edit. An agent imports it, runs the AI edit, and publishes — straight through Descript.

**mastra-descript is a Mastra agent template that turns Descript's REST API into a conversational video & audio editor.** Tell it what you want in plain English — _"import this clip, strip the filler words, and publish a 1080p cut"_ — and it imports the media, drives [Underlord](https://www.descript.com/underlord) (Descript's AI editor), publishes a shareable link, and manages your projects and jobs. It talks to the **REST API with a bearer token** — the headless surface — not the flaky OAuth MCP most people fight. Fork it, drop in a Descript token, and you have a working agent reachable over REST, MCP, and A2A.

[![License: ISC](https://img.shields.io/badge/license-ISC-blue)](#-license)
[![Status: v1](https://img.shields.io/badge/status-v1-brightgreen)]()
[![Node: 22+](https://img.shields.io/badge/node-22%2B-339933?logo=node.js&logoColor=white)](#-getting-started)
[![Built on Mastra](https://img.shields.io/badge/built%20on-Mastra-000)](https://mastra.ai)
[![Powered by Descript API](https://img.shields.io/badge/powered%20by-Descript%20API-7c3aed)](https://docs.descriptapi.com)
[![Family: mastra-base](https://img.shields.io/badge/family-mastra--base-111)](https://github.com/hamchowderr/mastra-base)

</div>

![mastra-descript Screenshot](docs/screenshot.png)

> _Screenshot placeholder — to be added._

---

## ⚡ What it does

Tell the agent what you want, in plain English:

> _"Import this video and remove every filler word."_ · _"Make a 1080p shareable cut of project abc123."_ · _"Write a 60-second script about morning routines."_

The `descript` agent figures out which tool fits, runs the async Descript job, **polls it to completion for you**, and hands back the real result — `project_id`, a share URL, or the job status. Every mutation (import, edit, publish) is a job; you never manage polling.

Then just keep talking:

> _"Now add captions."_ · _"Publish it unlisted instead."_ · _"What did that cost me?"_

Multi-turn is real — pass the `conversation_id` back and Underlord remembers the prior turns. And the agent is honest about money: **only AI edits spend AI credits**, and it tracks a running total so spend is never invisible.

Under the hood it isn't a single mega-prompt. It's one focused [Mastra](https://mastra.ai/) agent over a typed Descript client that wraps the **REST surface** (`descriptapi.com/v1`, bearer auth) — built and verified against the API that **actually exists**, not a hallucinated guess or the disconnect-prone hosted MCP.

---

## 🎬 What a request looks like

One message → real jobs run → a shareable result. Here's the **import → edit → publish** pipeline:

<details>
<summary><b>"Import this clip, remove the filler words, and publish a 1080p video"</b> — click to expand</summary>

**You:**

> Import https://example.com/talk.mp4 into a project called "Talk", remove all filler words, then publish a 1080p video.

**The `descript` agent** runs the pipeline, polling each job to completion:

```
→ importMedia({ media: [{ url: "https://example.com/talk.mp4" }], project_name: "Talk" })
    status: success · media_seconds_used: 42 · ai_credits_used: none
    project_id: 3e27c396-…

→ agentEdit({ project_id, prompt: "Remove all filler words", model: "haiku-4.5-underlord" })
    status: success · project_changed: true · ai_credits_used: 6
    conversation_id: 671a4425-…   ← pass back to keep iterating

→ publish({ project_id, media_type: "Video", resolution: "1080p" })
    status: success · share_url: https://share.descript.com/view/2ZzWCyd53Vc
```

**You** keep going — _"add captions"_ — and the agent continues the same Underlord session via `conversation_id`.

</details>

> Illustrative — real fields and credit costs vary with your prompt, the chosen model, and the media. Imports spend media-seconds; only `agentEdit` spends AI credits.

---

## 🎯 Why mastra-descript?

- **🎯 REST, not the MCP everyone fights.** It wraps `descriptapi.com/v1` with a bearer token — the headless, scriptable surface. The 401s, disconnects, and allowlist errors people hit are the **hosted MCP** (`api.descript.com/v2/mcp`), a different surface. We sidestep that whole class of pain by construction.
- **💸 Cost-transparent by design.** Only `agentEdit` invokes Underlord and spends AI credits. Every tool's description carries an explicit `COST:` tag, `getCostTotals` reports a running session total (there's no balance endpoint), and `DESCRIPT_CREDIT_CAP` aborts a run before it spends past your ceiling.
- **✅ Verified against ground truth.** Behavior was checked with a cost-ordered harness against the live API ([`npm run descript:verify`](#-build--test)) — confirming the cost model, refuting false community claims (multi-file works, cancel works, responses aren't truncated), and reproducing the real one (the plan-approval stall — and handling it).
- **🧩 Built for real workflows.** Multi-file import (N clips → one composition), multi-turn editing (`conversation_id`), webhooks (`callback_url`), pre-flight URL validation, a cheap default model, and a `cancelJob` tool.
- **🔌 Reachable four ways.** REST, MCP, A2A, and Mastra Studio — out of the box.
- **🏠 Self-contained stack.** Mastra + Hono + Postgres/pgvector (Supabase) + Dolt, one `docker compose up`. Forked from [`mastra-base`](https://github.com/hamchowderr/mastra-base).
- **🤖 Model choice.** `agentEdit` defaults to the cheap `haiku-4.5-underlord`; Underlord is multi-provider (Claude / Fable / Gemini / GPT) — swap per call.

---

## 🧠 How it works

```
        "Import this clip, remove filler words, publish 1080p"
                            │
                            ▼
            ┌──────────────────────────────────┐
            │         descript agent           │   Claude Sonnet 4.6
            │   Mastra agent · 10 typed tools  │
            └────────────────┬─────────────────┘
                             │ picks tool, fills params
                             ▼
            ┌──────────────────────────────────┐
            │      DescriptClient (REST)        │   descriptapi.com/v1
            │   POST /jobs/* · bearer token     │   returns a job_id
            └────────────────┬─────────────────┘
                             │ poll GET /jobs/{id} until stopped
                             ▼
            ┌──────────────────────────────────┐
            │   result.status + cost meters     │   ai_credits_used /
            │   share_url · project_changed     │   media_seconds_used
            └──────────────────────────────────┘
```

A request hits the **`descript` agent**, which selects a tool and calls the typed `DescriptClient`. Mutations return a `job_id`; the client **polls to completion** (with 429-`Retry-After` + 5xx backoff) and returns the final result, surfacing both `job_state` and `result.status`. Imports/publishes report `media_seconds_used`; `agentEdit` reports `ai_credits_used`. A session cost-meter accumulates both.

---

## 💸 Cost model — what spends what

Descript bills on **two separate meters**, and only one tool touches the AI. Conflating them is the #1 source of "where did my credits go?" — so the template makes it explicit.

| Operation | Hits Underlord (AI)? | What it costs |
|---|---|---|
| `agentEdit` | ✅ **yes** — the only AI tool | **AI credits** (`ai_credits_used`) · scales with model + work |
| `importMedia` | ❌ no | media-seconds (`media_seconds_used`) — transcription |
| `publish` | ❌ no | render / encode time |
| `listProjects` · `getProject` · `getJob` · `listJobs` · `cancelJob` · `getPublishedSubtitles` · `getCostTotals` | ❌ no | **free** (read / control) |

`agentEdit` defaults to **`haiku-4.5-underlord`** (≈2 credits for a trivial edit; `automatic` is the priciest). `getCostTotals` returns the running session total, and `DESCRIPT_CREDIT_CAP` is a hard backstop. _Measured: a 10-second import = 10 media-seconds, 0 AI credits; a haiku edit = ~2 credits._

---

## 🧰 The tools

| Tool | Does | Cost |
|---|---|---|
| `importMedia` | Import one or more URLs into a project (N clips → one composition); pre-validates URLs | media-seconds |
| `agentEdit` | Natural-language edit via Underlord; multi-turn via `conversation_id` | **AI credits** |
| `publish` | Render a shareable video/audio link | render time |
| `getPublishedSubtitles` | Fetch WEBVTT subtitles for a published project | free |
| `listProjects` / `getProject` | List & inspect projects | free |
| `getJob` / `listJobs` | Poll / list jobs | free |
| `cancelJob` | Cancel a running job (`DELETE /jobs/{id}`) | free |
| `getCostTotals` | Running session spend (AI credits + media-seconds) | free |

All async tools accept an optional `callback_url` — set it and the tool returns immediately while Descript webhooks the result (best for long jobs); omit it and the tool polls (default).

---

## 🚀 Getting started

**Prerequisites:** Node.js 22+ · Docker Desktop (for local Supabase) · a Supabase project · an Anthropic API key (or OpenAI/Google) · a Descript API token ([Settings → API tokens](https://www.descript.com/)).

```bash
# 1. Clone + install
git clone https://github.com/hamchowderr/mastra-descript.git && cd mastra-descript
npm install

# 2. Configure — every var is documented inline
cp .env.example .env
#   Fill in: APP_SECRET, SUPABASE_*, ANTHROPIC_API_KEY, DESCRIPT_API_TOKEN

# 3. Verify your Descript token BEFORE anything else
npm run descript:ping        # → ✓ Descript API is reachable … (api_version v1)

# 4. Boot local Supabase (first run only)
npx supabase start

# 5. Run — Mastra Studio at http://localhost:4111
npm run dev
```

Then chat with the `descript` agent in Studio:

> Import this video into a new project called Demo: https://example.com/video.mp4

It calls `importMedia`, polls to completion, and returns the `project_id`.

| Command | What it does |
|---|---|
| `npm run dev` | Mastra Studio + agent server → `:4111` (hot reload) |
| `npm run build` / `npm run start` | Production bundle → `.mastra/output/` / run it |
| `npm run descript:ping` | Auth canary — verify `DESCRIPT_API_TOKEN` |
| `npm run descript:verify` | Cost-ordered API verification harness (safe by default) |
| `npm run eval` | Tool-selection accuracy + answer-relevancy gate |
| `npm run typecheck` | `tsc --noEmit` |

---

## 🔌 Reachability

Once `npm run dev` is up, the `descript` agent answers on four surfaces:

```bash
# REST (use /stream for streaming)
curl -X POST http://localhost:4111/api/agents/descript/generate \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"List all my Descript projects."}]}'

# A2A — agent card + JSON-RPC message/send
curl http://localhost:4111/api/.well-known/descript/agent-card.json
curl -X POST http://localhost:4111/api/a2a/descript -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"kind":"message","messageId":"m1","role":"user","parts":[{"kind":"text","text":"List my projects."}]}}}'
```

- **MCP** — add `{"url":"http://localhost:4111/api/mcp/descript-mcp/mcp"}` to `claude_desktop_config.json`; the agent appears as `ask_descript`.
- **Studio** — `http://localhost:4111`: chat, traces, metrics, and the Agent Editor for tuning instructions without code.

> **Working memory** is resource-scoped — pass `memory.resource` (stable user ID) + `memory.thread` (conversation ID) in the request body to persist context across conversations. See `src/mastra/lib/memory.ts`.

---

## 🧱 Architecture

Forked from [`mastra-base`](https://github.com/hamchowderr/mastra-base): a single Mastra + Hono agent server on Postgres, with a self-contained Docker stack.

```
src/
├─ lib/env.ts                     Zod-validated env loader — crashes on bad config
└─ mastra/
   ├─ index.ts                    Entry: env → AIMock → Mastra instance (+ MCP/A2A)
   ├─ agents/_example.ts          descriptAgent — the Descript automation agent
   ├─ lib/
   │  ├─ descript-client.ts       Typed REST client — all endpoints + polling + 402 parsing
   │  ├─ cost-meter.ts            Session-cumulative AI-credit + media-second meter
   │  ├─ memory.ts                Resource-scoped working memory
   │  └─ aimock.ts · supabase.ts  Mock routing · Supabase client
   ├─ tools/                      importMedia · agentEdit · publish · projects ·
   │                              jobs (get/list/cancel) · published · cost
   └─ scorers/                    toolCallAccuracy + answerRelevancy + dataset
scripts/
├─ descript-ping.ts               Auth canary (GET /status)
├─ descript-verify.ts             Cost-ordered verification harness
└─ eval.ts                        Tool-call-accuracy eval gate
fixtures/ · aimock.json           AIMock fixtures + config (deterministic eval)
Dockerfile · docker-compose.yml   node:22-slim runtime + self-contained stack
```

### Stack

| Layer | Technology |
|---|---|
| Agent framework | [Mastra](https://mastra.ai) — `@mastra/core`, `memory`, `evals`, `duckdb`, `observability`, `auth`, `mcp`, `editor`, `pg` |
| LLM | Claude (Anthropic) — Sonnet 4.6 agent default; Underlord is multi-provider |
| API server | [Hono](https://hono.dev) (mounted via Mastra) |
| Database | Postgres + [pgvector](https://github.com/pgvector/pgvector) (local via [Supabase CLI](https://supabase.com/docs/guides/cli)) · [Dolt](https://www.dolthub.com/) for versioned data |
| Auth | `@mastra/auth` (HS256 JWT, opt-in via `MASTRA_JWT_SECRET`) |
| Testing | [Vitest](https://vitest.dev) · [AIMock](https://aimock.copilotkit.dev) · the `descript:verify` harness |
| Runtime | Docker (`node:22-slim` — DuckDB needs glibc, not musl) |

---

## 🧪 Build & test

```bash
npm run typecheck            # tsc --noEmit
npm run build                # mastra build → .mastra/output/

# API verification harness — safe by default (free reads only)
npm run descript:verify                      # Phase 1: auth, shapes, /status, no-cost probes
DESCRIPT_VERIFY_WRITES=1 npm run descript:verify   # + write-safe checks (zero credits/minutes)
DESCRIPT_VERIFY_SPEND=1  npm run descript:verify   # + checks that may spend (owner-gated)

# Eval gate — tool-selection accuracy + answer relevancy
npm run eval                                 # live (Anthropic + Descript)
npx @copilotkit/aimock --config aimock.json &
USE_AIMOCK=true npm run eval                 # deterministic, no API cost

# Docker
docker build -t mastra-descript:test . && docker compose up -d
curl http://localhost:4111/health
```

The **verification harness** (`descript:verify`) is cost-ordered and safe-by-default: free read-only checks always run; write-safe and credit-spending phases are gated behind env flags. The **eval gate** checks tool selection (`toolCallAccuracy ≥ 0.85`) and answer relevancy (`≥ 0.80`); under AIMock it verifies routing deterministically with zero API cost. CI runs typecheck → build + eval → docker on every push.

---

## 🔭 Inspect & tune the agent (Mastra Studio)

```bash
npx supabase start    # local Supabase — backs memory + traces
npm run dev           # agent server + Studio → http://localhost:4111
```

- 💬 **Chat** with the `descript` agent directly (uses your `ANTHROPIC_API_KEY`)
- ✏️ **Edit & version the system prompt** live via the Agent Editor
- 🧠 **Memory & threads** — every conversation, persisted to local Supabase
- 🔭 **Traces** — per-run agent / tool / LLM spans
- 🗂️ **Tools** — browse the 10 Descript tools and their `COST:` tags
- ✅ **Scorers** — tool-call accuracy + answer relevancy in the Scores view

---

## ✅ Verified against ground truth

This template was built **after** verifying the Descript API against the community's claims — with the `descript:verify` harness, against the live REST API, on a tiny owner-approved budget (~9 AI credits + ~30 media-seconds total).

- **Confirmed:** bearer auth on REST · the two-meter cost split · `GET /status` is live · multi-file `add_media` assembles N clips into one composition · `conversation_id` threads a stateful Underlord session · no credits-remaining endpoint exists.
- **Refuted:** _"can't put multiple files in one project"_, _"agent responses are truncated"_, _"the API can't cancel jobs"_ — all false on the REST surface.
- **Reproduced:** the plan-approval stall (a complex/ambiguous edit returns `success` + `project_changed: false`, builds nothing) — so `agentEdit` flags it as a non-success instead of a false "done."

---

## 🗺️ Roadmap

- 🪝 **Webhook receiver route** — `callback_url` is wired on every async tool; ship a reference receiver endpoint to verify delivery end-to-end.
- 🎚️ **Multitrack** — the documented import schema is sequential-clip only; track parallel-track support as Descript's API grows.
- 📝 **Recipes** — named workflows (podcast assembly, filler removal, highlight reel) on top of the raw tools.

---

## ❓ FAQ

- **Does it use the Descript MCP?** No — it wraps the **REST API** (`descriptapi.com/v1`) with a bearer token. The MCP (`/v2/mcp`) is OAuth-only and where most disconnect/401 complaints come from; the REST surface is the headless one.
- **Will an API call burn AI credits?** Only `agentEdit` (Underlord) spends AI credits. Imports cost media-seconds; publishes cost render time; reads and `cancelJob` are free. `getCostTotals` shows the running total.
- **How do I cap spend?** Set `DESCRIPT_CREDIT_CAP` — `agentEdit` aborts before submit once the session hits it (there's no balance endpoint, so it's cumulative).
- **Which model does Underlord use?** Defaults to the cheap `haiku-4.5-underlord`. The full enum spans Claude, Fable, Gemini, and GPT — override per `agentEdit` call.
- **Can I iterate on an edit?** Yes — pass the `conversation_id` from the previous `agentEdit` (with the same `project_id`); Underlord retains the prior turns.
- **Does it run on Windows?** Yes — Node 22, `npm run dev`. Docker uses `node:22-slim` (DuckDB needs glibc).
- **What if my token is rejected?** `npm run descript:ping` is the canary — a `401 "Could not find token"` means the token is stale/revoked; mint a fresh one in Descript Settings → API tokens.

---

## 🤝 Contributing

Developer docs — conventions, boot order, import rules, the cost model, and things never to do — live in [`AGENTS.md`](AGENTS.md), with build/spec detail in [`CLAUDE.md`](CLAUDE.md) and `SPEC/`. **The README is for orientation; `AGENTS.md` is for working in the code.**

Issue tracking runs on **bd (beads)** with Dolt-backed sync — `bd ready` to find work, `bd create` to file it. No markdown TODO lists.

---

## 🙏 Acknowledgments

- **[Descript](https://www.descript.com/)** — the editor and the API/Underlord this template drives.
- **[Mastra](https://mastra.ai/)** — the agent framework: agents, memory, evals, observability, MCP, A2A.
- **[`mastra-base`](https://github.com/hamchowderr/mastra-base)** — the canonical template this forks from.
- **[Supabase](https://supabase.com/)**, **[Hono](https://hono.dev/)**, and **[Anthropic](https://www.anthropic.com/)** — database, server, and models.

---

## 📜 License

**ISC.** Part of the `mastra-base` template family. © 2026 Otaku Solutions.
