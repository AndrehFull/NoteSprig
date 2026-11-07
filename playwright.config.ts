import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4318', channel: 'chrome', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', storageState: { cookies: [], origins: ['http://127.0.0.1:4318', 'https://127.0.0.1:4319'].map((origin) => ({ origin, localStorage: [{ name: 'notesprig.language', value: 'pt-BR' }] })) } },
  webServer: { command: 'node tests/fixture-server.mjs', url: 'http://127.0.0.1:4318/api/session', reuseExistingServer: false, timeout: 15000 },
});
