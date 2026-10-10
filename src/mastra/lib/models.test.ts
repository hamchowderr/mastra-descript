import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('models', () => {
  it('routes through the Vercel AI Gateway by default', async () => {
    const { AGENT_MODEL, JUDGE_MODEL } = await import('./models');
    expect(AGENT_MODEL).toBe('vercel/anthropic/claude-sonnet-5.5');
    expect(JUDGE_MODEL).toBe('vercel/anthropic/claude-sonnet-5.5');
  });

  it('uses the direct Anthropic id under AIMock, which fakes Anthropic not the gateway', async () => {
    vi.stubEnv('USE_AIMOCK', 'true');
    const { AGENT_MODEL } = await import('./models');
    expect(AGENT_MODEL).toBe('anthropic/claude-sonnet-5-5');
  });
});

describe('env', () => {
  it('requires AI_GATEWAY_API_KEY outside AIMock mode', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(import('../../lib/env')).rejects.toThrow('exit');
    expect(err.mock.calls.flat().join(' ')).toMatch(/AI_GATEWAY_API_KEY is required/);
    exit.mockRestore();
    err.mockRestore();
  });
});
