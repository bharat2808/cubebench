import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://127.0.0.1:4310', headless: true },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4310',
    reuseExistingServer: false,
    env: {
      CUBEBENCH_DB: resolve('.data/e2e/cubebench.sqlite'),
      CUBEBENCH_SIGNING_KEY: resolve('.data/e2e/signing-key.pem'),
      HOST: '127.0.0.1',
      PORT: '4310',
      NODE_ENV: 'test',
    },
    timeout: 60000,
  },
});
