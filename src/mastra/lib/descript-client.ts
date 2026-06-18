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
    init?: RequestInit & { retriesLeft?: number },
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
        let body: { message?: string; code?: string } | string;
        try {
          body = await res.json();
        } catch {
          body = await res.text().catch(() => res.statusText);
        }
        let message = typeof body === 'string'
          ? body
          : body.message ?? `Descript API ${res.status}`;
        // 402 = out of AI credits. Ian Gray reported the body carries "X required, Y available";
        // exact shape is unconfirmed, so parse defensively into a clear, actionable message.
        if (res.status === 402) message = formatPaymentRequired(body, message);
        throw new DescriptApiError(res.status, message);
      }

      // 204 No Content
      if (res.status === 204) return undefined as T;

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
    add_media: Record<string, { url?: string; content_type?: string; file_size?: number; language?: string }>;
    add_compositions?: Array<{ name: string; clips: Array<{ media: string }> }>;
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
