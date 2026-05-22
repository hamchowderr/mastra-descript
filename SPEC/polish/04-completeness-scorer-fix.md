# Polish 04 — Scorer Review (not applicable to this template)

> **This step is inherited from the base template and does not apply to `template-mastra-descript`.**
>
> The base template shipped a `completenessScorer` that produced a borderline score (lexical coverage is a poor signal for structured-extraction agents). That investigation/fix is irrelevant here: the Descript template never used `completenessScorer`.

## What this template actually uses

The Descript agent (`descriptAgent`) is a **tool-calling automation agent**, not a structured-extraction agent. Its scorers, defined in `src/mastra/scorers/_example.scorers.ts`, are:

- **`toolCallAccuracyScorer`** (`descript-tool-call-accuracy`) — a custom LLM-judged scorer that verifies the agent selected the correct Descript tool (`importMedia`, `agentEdit`, `publish`, `listProjects`, `getProject`, `getJob`, `listJobs`) for a given request. This is the signal that matters for an API-orchestration agent.
- **`answerRelevancyScorer`** — `createPromptAlignmentScorerLLM`, checking the agent's response aligns with its instructions.

Both are registered on the agent and in `src/mastra/index.ts`, and both run in the CI eval gate against `src/mastra/scorers/datasets/_example.json`.

## Action for this step

None. Skip it. If you are calibrating thresholds, do it against `toolCallAccuracyScorer` / `answerRelevancyScorer` in the eval dataset (see `SPEC/05-verification.md` § Test 7), not against a completeness scorer.
