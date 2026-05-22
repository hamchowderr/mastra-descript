# Polish 01 — Manual Studio Test

The original verification test #4 was "click around in Studio and confirm the agent works." That can't be automated because it tests the human UX. This step does it deliberately.

## Why this matters

Mastra Studio is the development experience the owner ships to clients. If a client opens Studio and the agent feels broken (slow, missing tools, weird trace output), the template fails its purpose regardless of whether typecheck and CI pass.

## Prerequisites

The Descript agent calls the real Descript API. You need:
- A valid `DESCRIPT_API_TOKEN` in `.env` (scoped to a Drive you can read).
- For full pipeline tests, a publicly-accessible media URL to import.

Read-only calls (`listProjects`, `getProject`, `getJob`, `listJobs`) are cheap and safe; mutations (`importMedia`, `agentEdit`, `publish`) start real async jobs.

## Steps

### 1. Boot the dev server

```bash
cd C:\Users\HamCh\code\template-mastra-descript
npm run dev
```

Wait for "Mastra Studio ready" or equivalent. Should take under 5 seconds.

### 2. Open Studio

Visit `http://localhost:4111` in a browser.

**Pass criteria for the landing page:**
- Studio loads without errors
- `descript` agent appears in the agent list/sidebar
- No red error banners or warnings about missing config

### 3. Open the descript agent

Click into `descript`. You should see:

**Pass criteria:**
- Agent name and description visible
- Chat interface ready to accept input
- Tool list shows the seven Descript tools: `importMedia`, `agentEdit`, `publish`, `listProjects`, `getProject`, `getJob`, `listJobs`
- Scorer list shows two scorers: `toolCallAccuracy`, `answerRelevancy`
- Editor tab present on the agent
- Memory panel shows empty (no prior threads)

### 4. Send a read-only request

Paste this into the chat:

```
Show me all my Descript projects.
```

**Pass criteria for the response:**
- Agent responds within a few seconds
- The `listProjects` tool was invoked (verify in trace, step 6)
- Response reports the real project list from your Drive
- No fabricated projects

### 5. Send a job-status request

```
What is the current status of job xyz789?
```

**Pass criteria:**
- The `getJob` tool was invoked
- The response reports the job's `job_state` ("running" | "stopped") and nested `result.status` ("success" | "partial" | "failed")
- If the job ID doesn't exist, the agent surfaces the API error clearly rather than fabricating a status

### 6. Inspect the trace

Open the trace view for a request you just sent. You're checking that observability is working.

**Pass criteria:**
- Trace appears in the trace list
- Span hierarchy shows: agent run → LLM call → tool call (e.g. `listProjects` / `getJob`)
- The tool span shows input and output
- Total duration is reasonable
- No error spans

### 7. Test fail-mode behavior

Send a request for an operation the agent has no tool for:

```
Delete the project called "Old Draft".
```

**Pass criteria:**
- The agent does NOT fabricate a deletion or call an unrelated tool
- It explains there is no delete tool available and (optionally) suggests what it can do instead
- This is the anti-hallucination behavior — the agent refuses to invent capabilities

### 8. Test memory persistence

Send a follow-up in the same thread:

```
For that first project you listed, show me its details.
```

**Pass criteria:**
- The agent calls `getProject` using the project from the earlier `listProjects` result (memory carried context)
- Trace shows memory was loaded at the start of the run
- Database side: confirm memory persisted to Supabase Postgres (optional, if quick)

> Note: resource-scoped working memory only persists across separate conversations when the caller passes `memory: { thread, resource }`. In Studio, the thread is managed for you; cross-thread persistence per user is exercised via the REST contract documented in `README.md`.

### 9. Send a request via cURL while Studio is running

In a separate terminal:

```bash
curl -X POST http://localhost:4111/api/agents/descript/generate ^
  -H "Content-Type: application/json" ^
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"List my recent jobs\"}]}"
```

(Use `^` for line continuation on Windows cmd, or backslashes in Git Bash / PowerShell.)

**Pass criteria:**
- HTTP 200 response
- The `listJobs` tool was invoked
- The request shows up as a NEW trace in Studio (live updating)

## What to capture in PROGRESS.md

```
## Polish 01: Manual Studio Test
- Status: complete | blocked
- Steps 1-9: <pass/fail for each>
- Notes: <any quirks observed; e.g. "trace took 12s to populate", "tool list rendered as JSON not pretty">
- Issues to fix: <list, or "none">
```

## If anything fails

Don't fix it yet — just document. The owner will decide which issues are blockers vs. nice-to-haves before publishing to GitHub. Some issues might actually be Mastra bugs, not template bugs.

## Stop after this step

Wait for owner to review your PROGRESS.md entry before moving to Polish 02. If everything passed cleanly, the owner will say "continue."
