# Prompt: Build a New Mastra Agent

Use this prompt to add a complete agent to this template (`mastra-descript`, forked from `mastra-base`).

---

## Inputs (fill these in before using the prompt)

```
AGENT_NAME:        <kebab-case name, e.g. "clip-scout">
AGENT_ID:          <camelCase id used in API routes, e.g. "clipScout">
PURPOSE:           <one sentence: what the agent does and who calls it>
TOOLS:             <which existing tools in src/mastra/tools/ it uses, and any new ones>
MODEL:             <default: AGENT_MODEL from src/mastra/lib/models.ts (vercel/anthropic/claude-sonnet-5.5)>
EVAL_CASES:        <8+ requests, each with the tool the agent should call, or null when no tool fits>
```

---

## Prompt

You are adding a new agent to the `mastra-descript` Mastra project. Follow every convention in `AGENTS.md` exactly.

**Agent to build**: `{AGENT_NAME}` (`{AGENT_ID}`)

**Purpose**: {PURPOSE}

**Tools**: {TOOLS}

**Model**: {MODEL}

---

### Deliverables

Produce these files and changes in order:

1. **`src/mastra/agents/{AGENT_NAME}.ts`**
   - Export the agent as `{camelCase}Agent` with `id: '{AGENT_ID}'`, a non-empty `description` (MCPServer fails to start without it), `model`, `instructions` and `tools`
   - Instructions are specific and grounded: which tool for which request, what each tool costs, and what to do when a job does not succeed (statuses are `success`, `partial`, `error`, `cancelled`; never retry automatically)
   - Use the shared memory factory from `../lib/memory` and the shared processors from `../lib/processors`, like `agents/_example.ts`
   - Reuse tools from `src/mastra/tools/`; new shared tools go there too, with a `COST:` note in the description

2. **`src/mastra/scorers/{AGENT_NAME}.scorers.ts`**
   - Export the scorers the eval uses: tool-call accuracy and answer relevancy, following `scorers/_example.scorers.ts`
   - Import prebuilt scorers from `@mastra/evals/scorers/prebuilt`

3. **`src/mastra/scorers/datasets/{AGENT_NAME}.json`**
   - `agentId`: `{AGENT_ID}`
   - `thresholds`: `{ "toolCallAccuracy": 0.85, "answerRelevancy": 0.80 }`
   - `cases`: at least 8, each `{ "name", "input", "expectedTool" }`, where `expectedTool` is the tool name or `null`. Include at least one `null` case (the agent must not invent a tool call)

4. **`fixtures/*.json`** — AIMock fixtures for each case, matching on a substring of the user message and mentioning the expected tool name in the response text (see `fixtures/descript-agent.json`)

5. **`src/mastra/index.ts`** — register the agent in both places:
   ```typescript
   import { {camelCase}Agent } from './agents/{AGENT_NAME}';
   // new Mastra({ agents: { ..., {AGENT_ID}: {camelCase}Agent } })        → REST, A2A, Studio
   // new MCPServer({ agents: { ..., {AGENT_ID}: {camelCase}Agent } })     → MCP, as ask_{AGENT_ID}
   ```

---

### Constraints

- Never read `process.env` directly — use `env` from `../../lib/env`; new env vars go in `env.ts` and `.env.example` together
- Never construct an AI SDK client before `configureAIMock()` runs (it is called in `index.ts` before agents are imported)
- Use relative imports only, no barrel files
- Models come from `src/mastra/lib/models.ts` (Vercel AI Gateway, `vercel/<provider>/<model>`); add a constant there rather than hardcoding a string

---

### Implementation Order

1. Agent file → `npm run typecheck`
2. Scorers file → `npm run typecheck`
3. Dataset JSON and AIMock fixtures
4. Register in `index.ts` → `npm run typecheck`
5. `npm run dev` → confirm the agent appears in Studio and answers one live message
6. `USE_AIMOCK=true npm run eval -- src/mastra/scorers/datasets/{AGENT_NAME}.json` with AIMock running → all cases pass and it exits 0 (without a path argument, `eval` runs `_example.json`)

---

### Eval Cases Guidance

```
{EVAL_CASES}
```
