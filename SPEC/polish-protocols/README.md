# Polish Protocols — Pre-applied for this template

For base, voice, and RAG, the standard reachability stack (REST + A2A + MCP + Studio + Editor) was added in a polish pass after the initial build. Those templates have a full `polish-protocols/` folder with phased steps for installing `@mastra/editor` and `@mastra/mcp`, configuring the editor storage domain, registering the MCPServer, and documenting reachability.

**This template does not need that polish pass.**

The standard reachability stack is built in from Phase 0 of `04-build-order.md`:

- Phase 1 installs `@mastra/editor` and `@mastra/mcp`
- Phase 7 configures the MastraCompositeStore (with `editor` domain), the MCPServer instance, the `editor` field, and the `mcpServers` field in the Mastra constructor
- Phase 8 verifies all four endpoints (REST, A2A, MCP, Studio + Editor) respond
- Phase 10 documents reachability in README and AGENTS.md

The descriptAgent has a non-empty `description` from the start, so MCPServer registration won't throw at boot.

If something goes wrong during the build that requires re-running the reachability configuration, refer to `template-mastra-base/SPEC/polish-protocols/` for the polish pattern. The shape is identical.

## Why this folder exists at all

For consistency with the rest of the template family. New templates go straight to standard. Existing templates needed a polish pass because they were published before the standard was formalized.
