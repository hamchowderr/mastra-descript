# Use Postgres instead of libSQL/Turso

mastra-descript ships on **libSQL/Turso** by default: the `default` + `editor`
storage domains and semantic-recall vectors all run on a single `LibSQLStore` +
`LibSQLVector`, from a local `file:` DB with no server and no Docker. That's the
zero-friction path. (The `observability` domain stays on `DuckDBStore` either
way — see `AGENTS.md`.)

If you'd rather run **Postgres + pgvector** (e.g. you already operate Supabase/
Neon/RDS, or want Postgres tooling), it's a small, self-contained swap. Nothing
else in the template depends on the storage backend — the Descript tools, the
CLI workspace, and Dolt are all unaffected.

## 1. Install the Postgres packages

```bash
npm install @mastra/pg @supabase/supabase-js
```

(`@supabase/supabase-js` is optional — only add it if you also want the
Supabase Auth/Storage JS client. This template's own storage doesn't need it;
it only ever used the Postgres connection string.)

## 2. Point storage at Postgres — `src/mastra/index.ts`

Replace the shared libSQL store with a Postgres one. Drop the `getSharedStore()`
import from `./lib/memory` and construct a `PostgresStore` directly:

```diff
-import { getSharedStore } from './lib/memory';
+import { PostgresStore } from '@mastra/pg';

+// One shared Postgres store for both default + editor slots. Two separate
+// instances on the same DB race on first boot creating shared types
+// (mastra_ai_spans) -> 23505. Sharing one instance avoids it.
+const pgStore = new PostgresStore({ id: 'mastra-storage', connectionString: env.SUPABASE_DB_URL });
```

```diff
   storage: new MastraCompositeStore({
     id: 'composite-storage',
-    default: getSharedStore(),
-    editor: getSharedStore(),
+    default: pgStore,
+    editor: pgStore,
     domains: {
       observability: await new DuckDBStore().getStore('observability'),
     },
   }),
```

## 3. Point vectors at pgvector — `src/mastra/lib/memory.ts`

```diff
-import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
+import { PgVector } from '@mastra/pg';

-let _store: LibSQLStore | null = null;
-export function getSharedStore(): LibSQLStore {
-  if (!_store) {
-    _store = new LibSQLStore({
-      id: 'mastra-storage',
-      url: env.TURSO_DATABASE_URL,
-      ...(env.TURSO_AUTH_TOKEN ? { authToken: env.TURSO_AUTH_TOKEN } : {}),
-    });
-  }
-  return _store;
-}
-
-let _vector: LibSQLVector | null = null;
-function getSharedVector(): LibSQLVector {
-  if (!_vector) {
-    _vector = new LibSQLVector({
-      id: 'memory-vector',
-      url: env.TURSO_DATABASE_URL,
-      ...(env.TURSO_AUTH_TOKEN ? { authToken: env.TURSO_AUTH_TOKEN } : {}),
-    });
-  }
-  return _vector;
-}
+let _vector: PgVector | null = null;
+function getSharedVector(): PgVector {
+  if (!_vector) {
+    _vector = new PgVector({ id: 'memory-vector', connectionString: env.SUPABASE_DB_URL });
+  }
+  return _vector;
+}
```

And in `createDefaultMemory()`, drop the explicit `storage: getSharedStore()` —
with `PostgresStore` there's no split-DB-file risk, so Memory can inherit the
Mastra instance's store the way it originally did:

```diff
   return new Memory({
-    storage: getSharedStore(),
     vector: getSharedVector(),
     embedder: fastembed,
```

Semantic recall (fastembed `bge-small`, 384-dim) is unchanged — only the vector
store swaps. pgvector needs the `vector` extension — the init script for it is
still shipped at `docker/postgres-init/01-pgvector.sql` (unused by the default
compose stack, kept for exactly this swap).

## 4. Swap the env vars — `src/lib/env.ts`

```diff
-    TURSO_DATABASE_URL: z.string().default('file:./mastra.db').transform(absoluteFileUrl),
-    TURSO_AUTH_TOKEN: z.string().optional(),
+    SUPABASE_URL: z.string().url(),
+    SUPABASE_ANON_KEY: z.string().min(1),
+    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
+    SUPABASE_DB_URL: z
+      .string()
+      .url()
+      .refine((v) => v.startsWith('postgres'), 'Must be a postgres:// connection string'),
```

(You can also delete the now-unused `absoluteFileUrl()` helper and its `node:path`
import at the top of `env.ts` — it exists only to pin a relative libSQL `file:`
URL to an absolute path.)

Then set the Supabase vars in `.env`:

```bash
# Local (via `npx supabase start`):
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
# Hosted: Supabase dashboard > Project Settings > Database > Connection string > URI (session pooler).
```

## 5. Local Postgres for dev

Use the Supabase CLI — this repo shipped one before the libSQL migration, so
re-initialize it:

```bash
npm install -D supabase
npx supabase init    # writes supabase/config.toml (defaults are fine)
npx supabase start   # Postgres + pgvector in Docker, on 54322
```

…or bring your own `pgvector/pgvector:pg16` container and point
`SUPABASE_DB_URL` at it — nothing here depends on the Supabase CLI specifically.

## 6. Docker Compose deploy (optional)

The default `docker-compose.yml` runs storage on libSQL (a `libsqldata` volume,
no separate service), so it has no `postgres` service. If you've switched the
code to Postgres and deploy via Compose, add the service back:

```yaml
services:
  mastra:
    environment:
      # replaces TURSO_DATABASE_URL for a Postgres build
      - SUPABASE_DB_URL=postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/postgres
    depends_on:
      postgres:
        condition: service_healthy
      dolt:
        condition: service_healthy

  postgres:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=postgres
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres-init:/docker-entrypoint-initdb.d:ro # enables `vector`
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 10
    # no published port → reachable only as `postgres` on the internal network

volumes:
  pgdata: {}
```

Drop the `libsqldata` volume + its mount and the `TURSO_DATABASE_URL` env from
the `mastra` service — a Postgres build no longer reads them. Set
`POSTGRES_PASSWORD` in `.env`.

That's the whole switch. `npm run typecheck` and `npm run build` should stay
green.
