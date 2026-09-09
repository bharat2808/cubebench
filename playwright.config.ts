import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
const port = process.env.PLAYWRIGHT_PORT ?? '4310';
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL, headless: true },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: false,
    env: {
      CUBEBENCH_DB: resolve('.data/e2e/cubebench.sqlite'),
      CUBEBENCH_SIGNING_KEY: resolve('.data/e2e/signing-key.pem'),
      HOST: '127.0.0.1',
      PORT: port,
      NODE_ENV: 'test',
    },
    timeout: 60000,
  },
});
