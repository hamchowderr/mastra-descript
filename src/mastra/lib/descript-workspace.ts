/**
 * # Descript CLI Workspace
 *
 * A sandboxed Workspace (`@mastra/core/workspace`) giving the `descript` agent a
 * shell to run the official `@descript/platform-cli` (bin: `descript-api`) via
 * the `execute_command` tool, e.g. `npx descript-api --help`.
 *
 * This is SUPPLEMENT-ONLY — for ad-hoc/manual exploration, not the agent's real
 * work. `src/mastra/lib/descript-client.ts` (used by the tools in
 * `src/mastra/tools/`) stays the path for billed operations: it has 402
 * (out-of-credits) parsing, 429/5xx retry-backoff, and `DESCRIPT_CREDIT_CAP`
 * enforcement that the raw CLI does not. Verified 2026-08-20 by inspecting the
 * actual `@descript/platform-cli@0.12.0` bundle — no match for 402/429/backoff/
 * credit-cap logic anywhere in it, and it only reimplements `import` + `agent`
 * (not even `publish`).
 */

import { LocalFilesystem, LocalSandbox, Workspace, WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { env } from '../../lib/env';

let _workspace: Workspace | null = null;

export function getDescriptWorkspace(): Workspace {
  if (!_workspace) {
    _workspace = new Workspace({
      id: 'descript-cli-workspace',
      filesystem: new LocalFilesystem({ basePath: env.WORKSPACE_ROOT }),
      sandbox: new LocalSandbox({
        workingDirectory: env.WORKSPACE_ROOT,
        // LocalSandbox only exposes PATH by default (secrets stay protected) —
        // explicitly pass what `descript-api` needs to authenticate. Its env
        // var names (DESCRIPT_API_KEY/DESCRIPT_API_URL) differ from ours
        // (DESCRIPT_API_TOKEN/DESCRIPT_BASE_URL) by design of the two clients.
        env: {
          PATH: process.env.PATH ?? '',
          DESCRIPT_API_KEY: env.DESCRIPT_API_TOKEN,
          DESCRIPT_API_URL: env.DESCRIPT_BASE_URL,
        },
      }),
      tools: {
        // Deliberate default: this surface can run arbitrary shell commands, so
        // a human confirms before the agent shells out — unlike the typed
        // tools, there's no cost-cap or 402 guard underneath it.
        [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: { requireApproval: true },
      },
    });
  }
  return _workspace;
}
