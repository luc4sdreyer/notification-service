import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Structured logs are noise when tests pass; keep them for failures.
    silent: 'passed-only',
  },
});
