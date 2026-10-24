import { defineConfig, devices } from '@playwright/test';

// Pruebas E2E: levanta el build de producción en el puerto 4173 y abre el juego en Chromium.
const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'node server/server.js',
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
  },
});
