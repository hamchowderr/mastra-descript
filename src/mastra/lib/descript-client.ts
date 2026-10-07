import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { env } from '../../lib/env';

export type DescriptJob = {
  job_id: string;
  job_type: string;
  job_state: 'running' | 'stopped';
  created_at: string;
  stopped_at?: string;
  drive_id: string;
  project_id?: string;
  project_url?: string;
  progress?: { label: string; last_update_at: string };
  result?: {
    status?: 'success' | 'partial' | 'failed';
    [key: string]: unknown;
  };
};

export type AgentModelCost = 'low' | 'medium' | 'high';

export type TranscriptFormat = 'txt' | 'markdown' | 'html' | 'rtf' | 'docx' | 'srt';

export type SearchResultType = 'project' | 'video' | 'image' | 'audio' | 'project_folder' | 'media_library_folder' | 'layout_pack';

export type SearchResult = {
  type: SearchResultType;
  name: string;
  url: string;
  updated_at: string;
  project_id?: string;
  asset_id?: string;
  folder_id?: string;
  brand_studio_id?: string;
  location?: 'media_library' | 'project' | 'brand_studio';
  thumbnail_url?: string;
  duration?: number;
  owner?: { id: string; name?: string };
};

export type DescriptError = {
  status: number;
  code?: string;
  message: string;
  retryAfter?: number;
};

class DescriptApiError extends Error {
  status: number;
  retryAfter?: number;
  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.name = 'DescriptApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Format a 402 body into a clear "out of credits (need X, have Y)" message (shape unconfirmed — parse defensively). */
function formatPaymentRequired(body: unknown, fallback: string): string {
  const b = (body ?? {}) as Record<string, unknown>;
  const num = (...keys: string[]) => {
    for (const k of keys) {
      const v = b[k];
      if (typeof v === 'number') return v;
    }
    return undefined;
  };
  const required = num('required', 'credits_required', 'ai_credits_required', 'cost');
  const available = num('available', 'credits_available', 'ai_credits_available', 'balance');
  if (required != null || available != null) {
    return `Out of AI credits — need ${required ?? '?'}, have ${available ?? '?'} (HTTP 402).`;
  }
  const m = typeof fallback === 'string' ? fallback.match(/(\d+)\D+required\D+(\d+)\D+available/i) : null;
  if (m) return `Out of AI credits — need ${m[1]}, have ${m[2]} (HTTP 402).`;
  return `Out of AI credits (HTTP 402): ${fallback}`;
}

/**
 * PUT a local file to a Descript signed upload URL (from `upload_urls` on an import job).
 * Deliberately NOT routed through DescriptClient.request: the signed URL carries its own
 * auth, so the bearer token must never be sent there. Streams the file (no full buffering).
 * Mirrors the official CLI: Content-Type application/octet-stream + explicit Content-Length.
 */
export async function uploadToSignedUrl(uploadUrl: string, filePath: string, fileSize: number, timeoutMs = 60 * 60_000): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(fileSize) },
      body: Readable.toWeb(createReadStream(filePath)) as ReadableStream,
      // Node requires half-duplex for streamed request bodies.
      duplex: 'half',
      signal: controller.signal,
    } as RequestInit & { duplex: 'half' });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Upload failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export class DescriptClient {
  private headers: Record<string, string>;
  private baseUrl: string;
  private timeoutMs: number;
  private retries: number;
  private pollIntervalMs: number;
  private pollMaxAttempts: number;

  constructor(token: string, options?: {
    baseUrl?: string;
    timeoutMs?: number;
    retries?: number;
    pollIntervalMs?: number;
    pollMaxAttempts?: number;
  }) {
    this.headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    this.baseUrl = options?.baseUrl ?? env.DESCRIPT_BASE_URL;
    this.timeoutMs = options?.timeoutMs ?? env.DESCRIPT_TIMEOUT_MS;
    this.retries = options?.retries ?? env.DESCRIPT_RETRIES;
    this.pollIntervalMs = options?.pollIntervalMs ?? env.DESCRIPT_POLL_INTERVAL_MS;
    this.pollMaxAttempts = options?.pollMaxAttempts ?? env.DESCRIPT_POLL_MAX_ATTEMPTS;
  }

  private async request<T>(
    path: string,
    init?: RequestInit & { retriesLeft?: number; raw?: boolean },
  ): Promise<T> {
    const retriesLeft = init?.retriesLeft ?? this.retries;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.headers, ...(init?.headers ?? {}) },
        signal: controller.signal,
      });

      // 429 — respect Retry-After
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') ?? 5);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        return this.request<T>(path, init);  // 429s don't count against retries
      }

      // 5xx — retry with exponential backoff
      if (res.status >= 500 && retriesLeft > 0) {
        const wait = (this.retries - retriesLeft + 1) * 1000;
        await new Promise((r) => setTimeout(r, wait));
        return this.request<T>(path, { ...init, retriesLeft: retriesLeft - 1 });
      }

      if (!res.ok) {
        let body: { message?: string; code?: string; details?: Array<{ message?: string }> } | string;
        try {
          body = await res.json();
        } catch {
          body = await res.text().catch(() => res.statusText);
        }
        let message = typeof body === 'string'
          ? body
          : body.message ?? `Descript API ${res.status}`;
        // 400 validation errors (Hapi/Joi) carry the specifics in details[] — e.g. a retired `model` id.
        if (typeof body !== 'string' && Array.isArray(body.details)) {
          const details = body.details.map((d) => d?.message).filter((m): m is string => typeof m === 'string');
          if (details.length > 0) message = `${message}: ${details.join('; ')}`;
        }
        // 402 = out of AI credits. Ian Gray reported the body carries "X required, Y available";
        // exact shape is unconfirmed, so parse defensively into a clear, actionable message.
        if (res.status === 402) message = formatPaymentRequired(body, message);
        throw new DescriptApiError(res.status, message);
      }

      // 204 No Content
      if (res.status === 204) return undefined as T;

      if (init?.raw) return res as T;

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Poll a job until job_state !== "running". Throws if max attempts exceeded. */
  async pollJob(jobId: string): Promise<DescriptJob> {
    for (let attempt = 0; attempt < this.pollMaxAttempts; attempt++) {
      const job = await this.getJob(jobId);
      if (job.job_state !== 'running') return job;
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
    throw new Error(
      `Descript job ${jobId} did not complete within ${this.pollMaxAttempts} polls (${(this.pollMaxAttempts * this.pollIntervalMs) / 60_000} min)`,
    );
  }

  /** Validate auth + connectivity via GET /status (live since 2026-06-18; returns the token's drive_id + api_version). */
  async healthcheck(): Promise<{ drive_id?: string; api_version?: string }> {
    return this.request<{ drive_id?: string; api_version?: string }>('/status', { method: 'GET' });
  }

  // ---------------------------------------------------------------------------
  // Endpoints
  // ---------------------------------------------------------------------------

  async importMedia(payload: {
    project_id?: string;
    project_name?: string;
    team_access?: 'edit' | 'comment' | 'view' | 'none';
    folder_name?: string;
    /** New projects only. `Personal`, `General`, or a custom workspace name (case-insensitive; unknown → 404). */
    workspace_name?: string;
    add_media: Record<string, { url?: string; content_type?: string; file_size?: number; language?: string }>;
    add_compositions?: Array<{
      name?: string;
      /** Pixels; Descript defaults to 1920×1080. */
      width?: number;
      height?: number;
      clips: Array<{ media: string; mute?: boolean }>;
    }>;
    callback_url?: string;
  }): Promise<{ job_id: string; drive_id: string; project_id: string; project_url: string; upload_urls?: Record<string, { upload_url: string; asset_id: string; artifact_id: string }> }> {
    return this.request('/jobs/import/project_media', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async agentEdit(payload: {
    prompt: string;
    project_id?: string;
    project_name?: string;
    composition_id?: string;
    model?: string;
    team_access?: 'edit' | 'comment' | 'view' | 'none';
    callback_url?: string;
    /** Continue a prior Underlord session (multi-turn — retains context). Pass the conversation_id from a previous agent job. */
    conversation_id?: string;
  }): Promise<{ job_id: string; drive_id: string; project_id: string; project_url: string }> {
    return this.request('/jobs/agent', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async publish(payload: {
    project_id: string;
    composition_id?: string;
    media_type?: 'Video' | 'Audio';
    resolution?: '480p' | '720p' | '1080p' | '1440p' | '4K';
    access_level?: 'public' | 'unlisted' | 'drive' | 'private';
    callback_url?: string;
  }): Promise<{ job_id: string; drive_id: string; project_id: string; project_url: string }> {
    return this.request('/jobs/publish', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async listProjects(params?: {
    name?: string;
    /** Only projects directly inside this folder, e.g. "Clients/Acme/Videos". */
    folder_path?: string;
    created_by?: string;
    created_after?: string;
    created_before?: string;
    updated_after?: string;
    updated_before?: string;
    sort?: 'name' | 'created_at' | 'updated_at' | 'last_viewed_at';
    direction?: 'asc' | 'desc';
    cursor?: string;
    limit?: number;
  }): Promise<{ data: Array<{ id: string; name: string; created_at: string; updated_at: string }>; pagination: { next_cursor?: string } }> {
    const qs = params ? '?' + new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])
    ).toString() : '';
    return this.request(`/projects${qs}`, { method: 'GET' });
  }

  async getProject(projectId: string): Promise<{
    id: string;
    name: string;
    drive_id: string;
    created_at: string;
    updated_at: string;
    media_files: Record<string, { type: string; duration: number }>;
    compositions: Array<{ id: string; name: string; duration: number; media_type: string }>;
  }> {
    return this.request(`/projects/${projectId}`, { method: 'GET' });
  }

  /**
   * Partner API: fetch a published project by its URL slug, including WEBVTT `subtitles`.
   * Read-only (free). This is the ONLY documented subtitle/transcript path — and it is
   * post-publish only (the slug comes from a published share URL). Rate limit 1000/hr.
   */
  async getPublishedProject(slug: string): Promise<{
    download_url?: string;
    download_url_expires_at?: string;
    project_id?: string;
    publish_type?: 'video' | 'audio';
    privacy?: string;
    metadata?: { title?: string; duration_seconds?: number; duration_formatted?: string; published_at?: string };
    subtitles?: string;
  }> {
    return this.request(`/published_projects/${encodeURIComponent(slug)}`, { method: 'GET' });
  }

  /** List Underlord models (canonical ids + aliases) accepted by `POST /jobs/agent` `model`, each with a coarse cost tier. */
  async listAgentModels(): Promise<{
    availableModels: Array<{ id: string; cost: AgentModelCost }>;
    aliases: Array<{ id: string; resolvesTo: string; description: string; cost: AgentModelCost }>;
  }> {
    return this.request('/agent/models', { method: 'GET' });
  }

  /**
   * Export a composition's transcript. Synchronous (not a job) and read-only. The body is the
   * raw file — text for txt/markdown/html/rtf/srt, binary for docx (returned base64-encoded).
   */
  async exportTranscript(payload: {
    project_id: string;
    composition_id?: string;
    format: TranscriptFormat;
    include_speaker_labels?: 'off' | 'changes' | 'every_paragraph';
    include_markers?: boolean;
    timecodes?: {
      frequency_seconds?: number;
      on_paragraphs?: boolean;
      on_speakers?: boolean;
      on_markers?: boolean;
      offset_seconds?: number;
    };
  }): Promise<{ content: string; encoding: 'utf8' | 'base64'; composition_id?: string; filename?: string }> {
    const res = await this.request<Response>('/export/transcript', {
      method: 'POST',
      body: JSON.stringify(payload),
      raw: true,
    });
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const filename = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
    const composition_id = res.headers.get('X-Composition-Id') ?? undefined;
    if (payload.format === 'docx') {
      const buf = Buffer.from(await res.arrayBuffer());
      return { content: buf.toString('base64'), encoding: 'base64', composition_id, filename };
    }
    return { content: await res.text(), encoding: 'utf8', composition_id, filename };
  }

  /** Search the token's drive: project/folder/media/layout-pack names plus transcripts and composition text. */
  async search(params: {
    query: string;
    type?: SearchResultType[];
    match?: Array<'name' | 'content'>;
    owner?: string[];
    updated_after?: string;
    updated_before?: string;
    sort?: 'relevance' | 'newest' | 'oldest';
    limit?: number;
  }): Promise<{ results: SearchResult[] }> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((item) => qs.append(k, String(item)));
      else qs.append(k, String(v));
    }
    return this.request(`/search?${qs.toString()}`, { method: 'GET' });
  }

  /** Partner API: create a one-time "Edit in Descript" import URL (expires after 3 hours). */
  async createEditInDescriptUrl(payload: {
    partner_drive_id: string;
    project_schema: {
      schema_version: string;
      source_id?: string;
      files: Array<{ uri: string; name?: string; start_offset?: { seconds: number } }>;
    };
  }): Promise<{ url: string }> {
    return this.request('/edit_in_descript/schema', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async listJobs(params?: {
    project_id?: string;
    type?: string;
    cursor?: string;
    limit?: number;
    created_after?: string;
    created_before?: string;
  }): Promise<{ data: DescriptJob[]; pagination: { next_cursor?: string } }> {
    const qs = params ? '?' + new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])
    ).toString() : '';
    return this.request(`/jobs${qs}`, { method: 'GET' });
  }

  async getJob(jobId: string): Promise<DescriptJob> {
    return this.request(`/jobs/${jobId}`, { method: 'GET' });
  }

  async cancelJob(jobId: string): Promise<void> {
    return this.request(`/jobs/${jobId}`, { method: 'DELETE' });
  }
}
