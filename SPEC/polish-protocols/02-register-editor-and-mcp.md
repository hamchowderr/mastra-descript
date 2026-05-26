# Base Polish 02 — Configure MCPServer and MastraEditor

Configure the two pieces that bring the template up to the family's reachability standard.

## Step 1: Verify the agent has a description

Open `src/mastra/agents/_example.ts`. Look for the `descriptAgent` constructor.

Every agent in this family must have a non-empty `description` property. MCPServer registration enforces this — without a description, the server fails to start.

If the agent has `description: '...'`, note the existing text in PROGRESS.md.

If not, add this:

```typescript
description: 'Automates Descript video and audio editing workflows via natural language. Imports media from URLs, runs AI edits via Underlord, publishes shareable links, and manages projects and jobs.'
```

## Step 2: Imports

At the top of `src/mastra/index.ts`, add:

```typescript
import { MastraEditor } from '@mastra/editor';
import { MCPServer } from '@mastra/mcp';
```

## Step 3: Construct the MCPServer

Before the `Mastra` constructor block:

```typescript
const descriptMcp = new MCPServer({
  id: 'descript-mcp',
  name: 'template-mastra-descript',
  version: '0.1.0',
  description: 'MCP server exposing the descriptAgent for Descript API workflows',
  tools: {},
  agents: { descript: descriptAgent },
});
```

## Step 4: Configure the Mastra constructor

Current state:

```typescript
export const mastra = new Mastra({
  agents: { descript: descriptAgent },
  scorers: { toolCallAccuracyScorer, answerRelevancyScorer },
  storage: new MastraCompositeStore({ ... }),
  logger: new PinoLogger({ ... }),
  observability: new Observability({ ... }),
});
```

Required state:

```typescript
export const mastra = new Mastra({
  agents: { descript: descriptAgent },
  scorers: { toolCallAccuracyScorer, answerRelevancyScorer },
  mcpServers: { descriptMcp },
  storage: new MastraCompositeStore({ ... }),  // editor store configured in Polish 01
  logger: new PinoLogger({ ... }),
  observability: new Observability({ ... }),
  editor: new MastraEditor(),
});
```

The `mcpServers` and `editor` fields are mandatory for this template family.

The MCP server will be reachable at `http://localhost:4111/api/mcp/descriptMcp/mcp` once `mastra dev` runs.

## Step 5: Verify typecheck

```bash
npm run typecheck
```

**Pass**: zero errors.

## Step 6: Verify dev boot

```bash
npm run dev
```

**Pass**:
- Studio loads at `http://localhost:4111`
- No errors in console
- The descript agent appears in Studio's agent list
- Navigate to Agents → descript → Editor tab is present

If the Editor tab is missing, the editor field wasn't configured correctly. Re-check Step 4.

## What to capture in PROGRESS.md

```
## Base Polish 02: Configure MCPServer + MastraEditor
- Status: complete
- descript description: <existing text | added: ...>
- Imports added: MastraEditor, MCPServer
- Configuration: MCPServer instance + mcpServers and editor fields in Mastra constructor
- Verification: typecheck passes; dev boots; Editor tab visible; no errors
- Notes: <anything unexpected>
```

Move on to Polish 03.
