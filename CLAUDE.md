# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

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


## Build & Test

```bash
npm install
npm test            # Vitest unit tests (fake fetch, no network)
npm run typecheck   # tsc --noEmit
npm run build       # mastra build
npm run eval        # tool-selection eval (USE_AIMOCK=true with AIMock running = free)
npm run dev         # Studio + agent on :4111
```

## Architecture Overview

One Mastra agent (`descript`, in `src/mastra/agents/_example.ts`) over a typed client for Descript's REST API (`src/mastra/lib/descript-client.ts`, spec v1.2). Underlord does the editing; the agent imports media, runs edits, publishes, tracks spend, and checks input before any job is created. Storage is libSQL/Turso, observability DuckDB, versioned data Dolt. Job callbacks arrive at `POST /webhooks/descript/:token`. The README explains what the agent adds on top of Underlord; `AGENTS.md` has the full conventions.

## Conventions & Patterns

Follow `AGENTS.md`: boot order, env rules (all env through `src/lib/env.ts`), job-state model (`jobOutcome()`), never retrying job-creating POSTs, never validating job ids with `.uuid()`, and import naming. Check Descript behavior against the spec and the live API before documenting it.
