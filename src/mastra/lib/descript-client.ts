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
        const message = typeof body === 'string'
          ? body
          : body.message ?? `Descript API ${res.status}`;
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

  /** Validate auth by calling GET /projects?limit=1. The documented /status endpoint is "not yet available". */
  async healthcheck(): Promise<void> {
    await this.request<unknown>('/projects?limit=1', { method: 'GET' });
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
