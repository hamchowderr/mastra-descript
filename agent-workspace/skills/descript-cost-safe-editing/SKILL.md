---
name: descript-cost-safe-editing
description: Use before any agentEdit (Underlord) call, when the user asks about credits/cost/models, or when an edit stalled or came back partial. Covers model choice, prompt shaping, credit-cap behaviour and how to report results honestly.
---

# Cost-safe Underlord editing

`agentEdit` is the ONLY tool that spends AI credits. Imports spend media-seconds, publish spends render time, everything else is free.

## Before calling agentEdit

1. Make sure the project exists and any import finished with `status: "success"`.
2. Default model is the `claude-haiku` alias (the low-cost tier; it tracks Descript's current stable Haiku; set by `DESCRIPT_AGENT_MODEL`), so omit `model` unless you need another. Only switch models when the user asks for a complex edit or names a model. If you switch, call `listAgentModels` first and pick the lowest `cost` tier that fits; never invent a model id.
3. Write ONE explicit, executable prompt. Underlord stalls (project_changed: false) on vague prompts that need a plan/brief approval. Good prompts state the action, the scope, and that it should apply the changes now, e.g. "Remove all filler words (um, uh, like) and shorten pauses longer than 1s across the whole composition. Apply the edits directly; do not ask for confirmation."
4. For multi-step edits on one project, chain calls with the previous `conversation_id` instead of re-explaining context.
5. For bulk/batch work (several projects or several edits), state the plan and the number of agentEdit calls to the user before running them, or use the `importEditPublish` workflow, which suspends for approval before spending credits.

## After agentEdit

- `status: "success"` and `project_changed: true` -> report `credits_used` and what changed.
- `project_changed: false` -> the edit did NOT run. Say so, and suggest a more explicit prompt (see step 3). Do not retry automatically.
- `status: "partial"` -> surface which parts failed.
- Credit-cap error (DESCRIPT_CREDIT_CAP reached) -> stop; tell the user the session cap was hit. Never try to work around it.
- 402 / out of credits -> stop and tell the user to top up in Descript.

Use `getCostTotals` for "how much have I spent" - it is a session running total, not the account balance (Descript exposes no balance endpoint).

See `references/prompt-patterns.md` for tested prompt shapes.
