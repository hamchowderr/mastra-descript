# Prompts

Parameterized prompts for AI coding agents working on this template. Pass one of these to Claude Code (or any capable coding agent) to generate complete, convention-compliant output.

## Available

| Prompt | Purpose |
|---|---|
| [build-agent.md](./build-agent.md) | Add a new Mastra agent: tools, scorers, eval dataset, AIMock fixtures, registration |

## Planned

| Prompt | Purpose |
|---|---|
| `build-tool.md` | Add a standalone shared tool in `src/mastra/tools/` |
| `build-scorer.md` | Add a custom scorer with dataset cases |
| `build-workflow.md` | Add a Mastra workflow with steps and triggers |
| `deploy-coolify.md` | Deploy the Docker Compose stack to Coolify |
| `client-kickoff.md` | Spin up a new client project from this template |
| `debug-agent.md` | Diagnose and fix a failing agent or eval case |

## Usage

Copy the prompt content, fill in the `## Inputs` section at the top, then paste it into your AI coding agent session. The prompt summarizes the relevant rules and tells the agent to follow `AGENTS.md` for the rest.
