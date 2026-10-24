import { defineConfig } from 'vitest/config';

// Pruebas unitarias / integración (Node). Las E2E van con Playwright (playwright.config.js).
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
});
