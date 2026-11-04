import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { STORE: 'memory', LOG_LEVEL: 'silent', NODE_ENV: 'test' },
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
