/**
 * # Shared Memory Baseline (working memory + semantic recall enabled)
 *
 * Use this factory instead of `new Memory()` so every agent shares one memory
 * policy:
 *
 *   import { createDefaultMemory } from '../lib/memory';
 *
 *   export const myAgent = new Agent({ ..., memory: createDefaultMemory() });
 *
 * ## What's configured
 *
 *   - Message history     — ON (Mastra default). Recent turns are prepended.
 *   - Working memory      — ON, resource-scoped. A persistent Markdown scratchpad
 *                           the agent updates over time (user profile + session
 *                           state). "resource-scoped" = it persists across ALL of
 *                           a user's threads, not just one conversation.
 *   - Semantic recall     — ON, resource-scoped. Past messages are embedded and
 *                           the most relevant ones are recalled each turn. The
 *                           embedder is **fastembed** — a local ONNX model
 *                           (bge-small-en-v1.5, 384-dim), so recall needs no API
 *                           key and no external embedding spend. Vectors live in
 *                           the same libSQL/Turso DB via LibSQLVector (native
 *                           vector search — no extension or extra service).
 *
 * ## Two things to know when calling agents
 *
 * 1. Storage: this factory passes an explicit `storage: getSharedStore()` — the
 *    SAME LibSQLStore instance the Mastra instance itself uses (see
 *    `src/mastra/index.ts`) — rather than relying on Memory's relative-path
 *    default. That keeps every agent's threads/messages and the main storage
 *    domain on one DB file instead of splitting across two. To switch the whole
 *    template to Postgres/pgvector (Supabase) instead, see docs/postgres.md.
 *
 * 2. resourceId is REQUIRED for resource-scoped memory to actually persist per user:
 *
 *      await agent.generate('Hello', {
 *        memory: { thread: 'conversation-123', resource: 'user-alice-456' },
 *      });
 *
 *    Without `resource`, working memory falls back to thread-only behavior.
 *
 * Pass a custom `template` for agents that should track different fields (e.g. a
 * voice agent wants a leaner profile). See https://mastra.ai/docs/memory/working-memory
 * and https://mastra.ai/docs/memory/semantic-recall
 */

import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { fastembed } from '@mastra/fastembed';
import { env } from '../../lib/env';

/** Default working-memory scratchpad. Short, focused labels per Mastra's guidance. */
export const DEFAULT_WORKING_MEMORY_TEMPLATE = `# User Profile

## Identity
- Name:
- Role / Company:

## Preferences
- Communication style: [e.g., concise, detailed]
- Constraints / things to avoid:

## Session State
- Current goal:
- Open items:
`;

/**
 * ONE shared libSQL store instance for the whole server — the Mastra instance
 * (src/mastra/index.ts) and every agent's Memory use THIS so threads/messages
 * land in a single DB rather than splitting across separate store instances.
 */
let _store: LibSQLStore | null = null;
export function getSharedStore(): LibSQLStore {
  if (!_store) {
    _store = new LibSQLStore({
      id: 'mastra-storage',
      url: env.TURSO_DATABASE_URL,
      ...(env.TURSO_AUTH_TOKEN ? { authToken: env.TURSO_AUTH_TOKEN } : {}),
    });
  }
  return _store;
}

/**
 * One shared libSQL vector index across all agents' semantic recall (same DB as
 * the main store — libSQL has native vector search, no separate extension).
 */
let _vector: LibSQLVector | null = null;
function getSharedVector(): LibSQLVector {
  if (!_vector) {
    _vector = new LibSQLVector({
      id: 'memory-vector',
      url: env.TURSO_DATABASE_URL,
      ...(env.TURSO_AUTH_TOKEN ? { authToken: env.TURSO_AUTH_TOKEN } : {}),
    });
  }
  return _vector;
}

/**
 * Build a Memory instance with the shared baseline. Each agent gets its own
 * instance (sharing the vector pool). Override `template` to track agent-specific
 * fields. The embedding dimension is probed from fastembed automatically — no
 * hard-coded dimension to keep in sync.
 */
export function createDefaultMemory(
  template: string = DEFAULT_WORKING_MEMORY_TEMPLATE,
): Memory {
  return new Memory({
    storage: getSharedStore(),
    vector: getSharedVector(),
    embedder: fastembed,
    options: {
      workingMemory: {
        enabled: true,
        scope: 'resource',
        template,
      },
      semanticRecall: {
        topK: 3,
        messageRange: 2,
        scope: 'resource',
      },
    },
  });
}
