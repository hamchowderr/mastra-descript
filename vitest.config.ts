import { defineConfig } from 'vitest/config';

// Unit tests never touch the network: every test stubs global fetch.
// env.ts validates process.env at import time, so the required vars get stub values here.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: {
      APP_SECRET: 'test-secret-test-secret-test-secret-00',
      AI_GATEWAY_API_KEY: 'stub',
      DESCRIPT_API_TOKEN: 'test-descript-token',
      DESCRIPT_BASE_URL: 'https://descript.test/v1',
      DESCRIPT_RETRIES: '0',
      DESCRIPT_POLL_INTERVAL_MS: '1',
      MASTRA_TELEMETRY_DISABLED: '1',
    },
  },
});
