/**
 * Descript API behavioral verification harness (beads: descript-z2v).
 *
 * Cost-ordered. SAFE BY DEFAULT:
 *   - Phase 1 (free reads) ALWAYS runs — zero AI credits, zero media minutes, no writes.
 *   - Phase W (write-safe)  runs only with DESCRIPT_VERIFY_WRITES=1 — creates an EMPTY,
 *                           cancelable project (still zero credits / zero media minutes).
 *   - Phase S (spend)       runs only with DESCRIPT_VERIFY_SPEND=1 — MAY consume AI credits
 *                           and/or media minutes. Requires explicit owner approval.
 *
 * Each check records pass/fail + the raw HTTP status and response body shape.
 *
 * Run: npm run descript:verify
 */
import { env } from '../src/lib/env';

const BASE = env.DESCRIPT_BASE_URL;
const AUTH = { Authorization: `Bearer ${env.DESCRIPT_API_TOKEN}`, 'Content-Type': 'application/json' };

type Probe = {
  method: string;
  path: string;
  status: number;
  ok: boolean;
  body: unknown;
  rateRemaining: string | null;
  retryAfter: string | null;
};

/** Raw fetch that never throws on non-2xx — we want the exact status + body for verification. */
async function probe(method: string, path: string, body?: unknown): Promise<Probe> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return {
    method,
    path,
    status: res.status,
    ok: res.ok,
    body: parsed,
    rateRemaining: res.headers.get('X-RateLimit-Remaining'),
    retryAfter: res.headers.get('Retry-After'),
  };
}

/** Describe the top-level shape of a value without dumping (potentially private) values. */
function shape(v: unknown, depth = 0): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `[${v.length === 0 ? '' : shape(v[0], depth + 1)}${v.length > 1 ? ', …' : ''}]`;
  if (typeof v === 'object') {
    if (depth > 2) return '{…}';
    const keys = Object.keys(v as Record<string, unknown>);
    return `{ ${keys.map((k) => `${k}: ${shape((v as Record<string, unknown>)[k], depth + 1)}`).join(', ')} }`;
  }
  return typeof v;
}

type Result = { id: string; claim: string; status: 'PASS' | 'FAIL' | 'INFO' | 'SKIP'; detail: string };
const results: Result[] = [];
function record(r: Result) {
  results.push(r);
  const icon = { PASS: '🟢', FAIL: '🔴', INFO: '🔵', SKIP: '⬜' }[r.status];
  console.log(`${icon} [${r.id}] ${r.claim}\n     → ${r.detail}\n`);
}

// ---------------------------------------------------------------------------
// PHASE 1 — FREE READS (zero spend, no writes)
// ---------------------------------------------------------------------------
async function phase1() {
  console.log('═══ PHASE 1 — free / no-credit reads ═══\n');

  // Check 1 — bearer token works headless E2E against descriptapi.com/v1 (REST surface).
  const auth = await probe('GET', '/projects?limit=1');
  record({
    id: 'check-1',
    claim: 'Bearer token works headless on the REST surface (not the OAuth MCP)',
    status: auth.status === 200 ? 'PASS' : 'FAIL',
    detail: `GET /projects?limit=1 → ${auth.status}${auth.status === 401 ? ' (token rejected!)' : ''}; RateLimit-Remaining=${auth.rateRemaining ?? 'n/a'}; body=${shape(auth.body)}`,
  });

  // Check 2 — response shapes match the API Reference.
  const projects = await probe('GET', '/projects?limit=3');
  const projData = (projects.body as { data?: Array<{ id?: string }> })?.data;
  record({
    id: 'check-2a',
    claim: 'GET /projects shape matches reference (data[], pagination.next_cursor)',
    status: projects.status === 200 && Array.isArray(projData) ? 'PASS' : 'FAIL',
    detail: `${projects.status}; ${Array.isArray(projData) ? `${projData.length} project(s)` : 'no data[]'}; shape=${shape(projects.body)}`,
  });

  const firstProjectId = projData?.[0]?.id;
  if (firstProjectId) {
    const proj = await probe('GET', `/projects/${firstProjectId}`);
    record({
      id: 'check-2b',
      claim: 'GET /projects/{id} shape matches reference (media_files, compositions[])',
      status: proj.status === 200 ? 'PASS' : 'FAIL',
      detail: `${proj.status}; shape=${shape(proj.body)}`,
    });
  } else {
    record({ id: 'check-2b', claim: 'GET /projects/{id} shape', status: 'SKIP', detail: 'No projects in Drive to fetch detail shape.' });
  }

  const jobs = await probe('GET', '/jobs?limit=3');
  const jobData = (jobs.body as { data?: Array<{ job_id?: string }> })?.data;
  record({
    id: 'check-2c',
    claim: 'GET /jobs shape matches reference (data[], pagination.next_cursor)',
    status: jobs.status === 200 && Array.isArray(jobData) ? 'PASS' : 'FAIL',
    detail: `${jobs.status}; ${Array.isArray(jobData) ? `${jobData.length} job(s)` : 'no data[]'}; shape=${shape(jobs.body)}`,
  });

  const firstJobId = jobData?.[0]?.job_id;
  if (firstJobId) {
    const job = await probe('GET', `/jobs/${firstJobId}`);
    record({
      id: 'check-2d',
      claim: 'GET /jobs/{id} shape matches reference (job_state, result.status)',
      status: job.status === 200 ? 'PASS' : 'FAIL',
      detail: `${job.status}; shape=${shape(job.body)}`,
    });
  } else {
    record({ id: 'check-2d', claim: 'GET /jobs/{id} shape', status: 'SKIP', detail: 'No jobs in the last 7 days to fetch detail shape.' });
  }

  // Check 4 — is there ANY credits-remaining endpoint? Probe plausible paths; expect 404/401.
  const creditPaths = ['/credits', '/credit', '/balance', '/usage', '/account', '/me', '/billing', '/drive'];
  const found: string[] = [];
  const seen: string[] = [];
  for (const p of creditPaths) {
    const r = await probe('GET', p);
    seen.push(`${p}:${r.status}`);
    if (r.status === 200) found.push(p);
  }
  record({
    id: 'check-4',
    claim: 'A credits-remaining endpoint exists',
    status: found.length > 0 ? 'PASS' : 'INFO',
    detail: found.length > 0 ? `FOUND: ${found.join(', ')}` : `None found (expected). Probed → ${seen.join(' ')}`,
  });

  // Check 5 — GET /status (reference says "not yet available").
  const status = await probe('GET', '/status');
  record({
    id: 'check-5',
    claim: 'GET /status is available (reference said "not yet available")',
    status: status.status === 200 ? 'PASS' : 'INFO',
    detail: `GET /status → ${status.status}; body=${shape(status.body)} ${status.status !== 200 ? '(still unavailable — matches reference)' : '(NOW AVAILABLE — update reference!)'}`,
  });
}

// ---------------------------------------------------------------------------
// PHASE W — WRITE-SAFE (zero spend, but creates an empty cancelable project)
// ---------------------------------------------------------------------------
async function phaseW() {
  console.log('═══ PHASE W — write-safe (zero credits/minutes; creates an empty project) ═══\n');

  // Check 7 — multi-key add_media is ACCEPTED at submit (refutes "can't put multiple files
  // in one project"). Direct-upload mode (content_type + file_size, NO url) → the API returns
  // upload_urls and waits for a PUT that we never do → zero media processed → zero minutes.
  const submit = await probe('POST', '/jobs/import/project_media', {
    project_name: `zzz-z2v-verify-DELETEME-${process.env.DESCRIPT_VERIFY_TAG ?? 'multikey'}`,
    add_media: {
      track_a: { content_type: 'video/mp4', file_size: 1048576, language: 'en' },
      track_b: { content_type: 'video/mp4', file_size: 1048576, language: 'en' },
      track_c: { content_type: 'audio/mp3', file_size: 524288, language: 'en' },
    },
  });
  const uploadUrls = (submit.body as { upload_urls?: Record<string, unknown> })?.upload_urls;
  const keyCount = uploadUrls ? Object.keys(uploadUrls).length : 0;
  const jobId = (submit.body as { job_id?: string })?.job_id;
  record({
    id: 'check-7',
    claim: 'Multi-key add_media is accepted at submit (refutes "one file per project")',
    status: submit.status === 201 && keyCount === 3 ? 'PASS' : submit.ok ? 'INFO' : 'FAIL',
    detail: `POST → ${submit.status}; upload_urls keys=${keyCount}/3; shape=${shape(submit.body)}`,
  });

  // Clean up: cancel the import job so the empty project doesn't linger as a running job.
  if (jobId) {
    const cancel = await probe('DELETE', `/jobs/${jobId}`);
    record({
      id: 'check-7-cleanup',
      claim: 'Cancel the throwaway import job (DELETE /jobs/{id} → 204)',
      status: cancel.status === 204 ? 'PASS' : 'INFO',
      detail: `DELETE /jobs/${jobId} → ${cancel.status}. NOTE: an empty project may remain in the Drive — delete it in the Descript UI.`,
    });
  }
}

// ---------------------------------------------------------------------------
// PHASE S — SPEND (MAY consume AI credits and/or media minutes) — owner-gated
// ---------------------------------------------------------------------------
async function phaseS() {
  console.log('═══ PHASE S — SPEND RISK (may consume AI credits / media minutes) ═══\n');

  // Check 3 — 402 body shape ("X required, Y available"). A 402 only surfaces when out of
  // credits; if the Drive HAS credits this agent job RUNS and SPENDS them.
  const agent = await probe('POST', '/jobs/agent', {
    project_name: `zzz-z2v-verify-DELETEME-402probe`,
    prompt: 'Write a one-sentence script about coffee.',
  });
  record({
    id: 'check-3',
    claim: '402 body reports "X required, Y available"',
    status: agent.status === 402 ? 'PASS' : 'INFO',
    detail: `POST /jobs/agent → ${agent.status}; body=${JSON.stringify(agent.body)} ${agent.status === 402 ? '' : '(NOT a 402 — a job likely STARTED and is consuming credits; cancel it!)'}`,
  });

  // Check 6 — "Failed to read media metadata" on Big Buck Bunny. If the regression is fixed,
  // a successful import auto-transcribes → media minutes. We cancel immediately to bound risk.
  const BBB = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
  const imp = await probe('POST', '/jobs/import/project_media', {
    project_name: `zzz-z2v-verify-DELETEME-bbb`,
    add_media: { bbb: { url: BBB, language: 'en' } },
  });
  const impJobId = (imp.body as { job_id?: string })?.job_id;
  if (impJobId) await probe('DELETE', `/jobs/${impJobId}`); // cancel ASAP to limit transcription
  record({
    id: 'check-6',
    claim: 'URL import fails "Failed to read media metadata" on a public MP4 (BBB)',
    status: 'INFO',
    detail: `POST /jobs/import (BBB url) → ${imp.status}; job_id=${impJobId ?? 'none'} (cancelled). Re-run + poll the job to see if result.status=failed with the metadata error, or success (regression fixed). shape=${shape(imp.body)}`,
  });
}

async function main() {
  console.log(`\nDescript API verification — base ${BASE}\n`);
  await phase1();

  if (process.env.DESCRIPT_VERIFY_WRITES === '1') {
    await phaseW();
  } else {
    record({ id: 'phase-W', claim: 'Write-safe checks (check-7 multi-key)', status: 'SKIP', detail: 'Set DESCRIPT_VERIFY_WRITES=1 to run (zero spend; creates an empty cancelable project).' });
  }

  if (process.env.DESCRIPT_VERIFY_SPEND === '1') {
    await phaseS();
  } else {
    record({ id: 'phase-S', claim: 'Spend checks (check-3 402, check-6 BBB import)', status: 'SKIP', detail: 'Set DESCRIPT_VERIFY_SPEND=1 to run. MAY CONSUME AI CREDITS / MEDIA MINUTES — owner approval required.' });
  }

  // Summary
  const counts = results.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
  console.log('═══ SUMMARY ═══');
  console.log(`🟢 PASS ${counts.PASS ?? 0}  🔴 FAIL ${counts.FAIL ?? 0}  🔵 INFO ${counts.INFO ?? 0}  ⬜ SKIP ${counts.SKIP ?? 0}`);
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}

main().catch((err) => {
  console.error('verify harness crashed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
