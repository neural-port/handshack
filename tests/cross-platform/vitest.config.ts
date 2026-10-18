import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'cross-platform',
    environment: 'node',
    include: ['*.test.ts'],
    testTimeout: 300_000,
  },
});
